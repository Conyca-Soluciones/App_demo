-- Pagos por PSE en el Consolidado (decisiones del usuario, 2026-11-12). Va
-- después de 20270101000300_paquete_e_ayf.sql.
--
-- 1. Los pagos PSE ya no van a Realizar Pagos: después de liquidados salen en
--    la pestaña "PSE" del Consolidado (Liquidados queda solo con los que van por
--    dispersor). conteo_etapas_consolidado trae 'pse'.
-- 2. Acción nueva "Pagar PSE" (pagar_pse; por omisión Financiera, para dársela a
--    quien haga de tesorería en la matriz de Roles): escoger la cuenta a debitar
--    (las mismas cuentas de empresa de Realizar Pagos) y marcar el pago como
--    pagado con la fecha de hoy y el comprobante opcional
--    (marcar_pagos_pagados). "El pago no salió" (deshacer_pago_pse) lo devuelve.
--    Los pagos por "otro medio" (no PSE) siguen en Realizar Pagos con
--    generar_dispersores.
--
-- Solo agrega; los ajustes a funciones vivas son parches por texto exacto. Se
-- puede correr dos veces. Reversa en supabase/reversa/20270101000400_pse_en_consolidado.sql.

begin;

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  p_a := replace(p_a, E'\r\n', E'\n');
  p_b := replace(p_b, E'\r\n', E'\n');
  if position(p_b in d) > 0 then
    return;
  end if;
  if position(p_a in d) = 0 then
    raise exception '% no tiene el texto esperado: %', p_fn, left(p_a, 120);
  end if;
  execute replace(d, p_a, p_b);
end;
$$;

-- 1. Acción ---------------------------------------------------------------------
insert into public.rol_permisos (rol_id, permiso)
select r.id, 'accion.pagar_pse' from public.roles r where r.clave = 'financiera'
on conflict do nothing;

-- 2. Conteo de etapas: Liquidados sin PSE, y PSE aparte --------------------------
select pg_temp._parche(
  'public.conteo_etapas_consolidado(uuid,integer[],integer[],timestamp with time zone[],timestamp with time zone[])'::regprocedure,
  $a$    'liquidado', count(*) filter (where liquidacion_estado = 'liquidado' and estado = 'aprobado'),$a$,
  $b$    'liquidado', count(*) filter (where liquidacion_estado = 'liquidado' and estado = 'aprobado' and not public.pago_es_pse(g)),
    'pse', count(*) filter (where liquidacion_estado = 'liquidado' and estado = 'aprobado' and public.pago_es_pse(g)),$b$);

-- 3. Cuentas a debitar: también quien paga PSE -----------------------------------
drop policy if exists cuentas_empresa_select on public.cuentas_empresa;
create policy cuentas_empresa_select on public.cuentas_empresa for select to authenticated
  using ((select public.es_admin((select auth.uid())))
         or (select public.tiene_pestana((select auth.uid()), 'ayf.realizar_pagos'))
         or (select public.tiene_accion((select auth.uid()), 'pagar_pse')));

-- Comprobantes PSE (dispersores/pse/...): subir y, si falla, borrar.
drop policy if exists dispersores_comprobante_pse_insert on storage.objects;
create policy dispersores_comprobante_pse_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'dispersores' and (storage.foldername(name))[1] = 'pse'
              and (select public.tiene_accion((select auth.uid()), 'pagar_pse')));
drop policy if exists dispersores_comprobante_pse_delete on storage.objects;
create policy dispersores_comprobante_pse_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dispersores' and (storage.foldername(name))[1] = 'pse'
         and (select public.tiene_accion((select auth.uid()), 'pagar_pse'))
         and name not in (select p.pago_comprobante_ruta from public.pagos p where p.pago_comprobante_ruta is not null));

-- 4. Marcar como pagados: PSE con pagar_pse; "otro medio" con generar_dispersores.
create or replace function public.marcar_pagos_pagados(p_ids uuid[], p_cuenta_id uuid, p_comprobante jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pse boolean := public.tiene_accion(auth.uid(), 'pagar_pse');
  v_otro boolean := public.tiene_accion(auth.uid(), 'generar_dispersores');
  v_ruta text := nullif(btrim(coalesce(p_comprobante ->> 'ruta', '')), '');
  v_mime text := p_comprobante ->> 'mime';
  v_nombre text := left(coalesce(nullif(btrim(p_comprobante ->> 'nombre'), ''), 'comprobante'), 200);
  v_cuenta record;
  v_ids uuid[];
begin
  if not (v_pse or v_otro) then
    raise exception 'No autorizado -- no tienes permiso para pagar estos pagos.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 3000 then
    raise exception 'Como mucho 3000 pagos a la vez.';
  end if;
  select c.id, c.apodo into v_cuenta
    from public.cuentas_empresa c where c.id = p_cuenta_id and c.estado = 'ACTIVA';
  if not found then
    raise exception 'Escoge la cuenta desde la que se pagó.';
  end if;
  if v_ruta is not null then
    if v_ruta not like 'pse/%' then
      raise exception 'El comprobante no se subió bien: vuelve a adjuntarlo.';
    end if;
    if coalesce(v_mime, '') not in ('application/pdf', 'image/jpeg', 'image/png') then
      raise exception 'El comprobante debe ser PDF, JPG o PNG.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'dispersores' and o.name = v_ruta) then
      raise exception 'No se encontró el comprobante subido: vuelve a adjuntarlo.';
    end if;
  end if;

  with elegibles as (
    select g.id from public.pagos g
     where g.id = any (coalesce(p_ids, '{}'))
       and g.estado = 'aprobado' and g.liquidacion_estado = 'liquidado'
       and g.dispersion_id is null and g.referencia is not null
       and g.consolidado_id in (select public._consolidados_visibles(auth.uid()))
       and case when public.pago_es_pse(g) then v_pse else v_otro and g.fuera_dispersor end
     for update of g
  ), marcados as (
    update public.pagos g
       set estado = 'dispersado', dispersado_en = now(), cuenta_debitar_id = v_cuenta.id,
           pagado_manual_por = auth.uid(),
           pago_comprobante_ruta = v_ruta,
           pago_comprobante_nombre = case when v_ruta is null then null else v_nombre end,
           pago_comprobante_mime = case when v_ruta is null then null else v_mime end
      from elegibles e
     where g.id = e.id
    returning g.id
  )
  select array_agg(id) into v_ids from marcados;

  if v_ids is not null then
    perform public._anotar_historial('pago', i, 'pagado_otro_medio',
              jsonb_build_object('cuenta', v_cuenta.apodo, 'fecha', (now() at time zone 'America/Bogota')::date,
                                 'comprobante', case when v_ruta is null then null else v_nombre end), null)
       from unnest(v_ids) i;
  end if;
  return coalesce(array_length(v_ids, 1), 0);
end;
$$;
revoke all on function public.marcar_pagos_pagados(uuid[], uuid, jsonb) from public, anon;
grant execute on function public.marcar_pagos_pagados(uuid[], uuid, jsonb) to authenticated;

-- 5. "El pago no salió": un PSE marcado como pagado vuelve a la pestaña PSE.
create or replace function public.deshacer_pago_pse(p_ids uuid[], p_motivo text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_n integer;
begin
  if not public.tiene_accion(auth.uid(), 'pagar_pse') then
    raise exception 'No autorizado -- no tienes permiso para pagar PSE.';
  end if;
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'Escribe por qué no salió el pago.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 3000 then
    raise exception 'Como mucho 3000 pagos a la vez.';
  end if;
  perform set_config('app.redispersando', 'on', true);
  perform set_config('app.motivo_rebote', v_motivo, true);
  update public.pagos g
     set estado = 'aprobado', dispersado_en = null, cuenta_debitar_id = null,
         pagado_manual_por = null, pago_comprobante_ruta = null, pago_comprobante_nombre = null, pago_comprobante_mime = null
   where g.id = any (coalesce(p_ids, '{}'))
     and g.estado = 'dispersado' and g.dispersion_id is null and g.pagado_manual_por is not null
     and public.pago_es_pse(g)
     and g.consolidado_id in (select public._consolidados_visibles(auth.uid()));
  get diagnostics v_n = row_count;
  perform set_config('app.redispersando', '', true);
  perform set_config('app.motivo_rebote', '', true);
  return v_n;
end;
$$;
revoke all on function public.deshacer_pago_pse(uuid[], text) from public, anon;
grant execute on function public.deshacer_pago_pse(uuid[], text) to authenticated;

commit;
