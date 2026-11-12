-- Reversa de 20270101000400_pse_en_consolidado.sql: vuelve el conteo, la
-- política de cuentas a debitar y marcar_pagos_pagados a como quedaron en
-- 20270101000300; quita deshacer_pago_pse, las políticas de comprobantes y la
-- acción pagar_pse.

begin;

create or replace function pg_temp._deshacer(p_fn regprocedure, p_nuevo text, p_viejo text)
returns void
language plpgsql
as $$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  if position(p_nuevo in d) = 0 then
    return;
  end if;
  execute replace(d, p_nuevo, p_viejo);
end;
$$;

select pg_temp._deshacer(
  'public.conteo_etapas_consolidado(uuid,integer[],integer[],timestamp with time zone[],timestamp with time zone[])'::regprocedure,
  $b$    'liquidado', count(*) filter (where liquidacion_estado = 'liquidado' and estado = 'aprobado' and not public.pago_es_pse(g)),
    'pse', count(*) filter (where liquidacion_estado = 'liquidado' and estado = 'aprobado' and public.pago_es_pse(g)),$b$,
  $a$    'liquidado', count(*) filter (where liquidacion_estado = 'liquidado' and estado = 'aprobado'),$a$);

drop policy if exists cuentas_empresa_select on public.cuentas_empresa;
create policy cuentas_empresa_select on public.cuentas_empresa for select to authenticated
  using ((select public.es_admin((select auth.uid())))
         or (select public.tiene_pestana((select auth.uid()), 'ayf.realizar_pagos')));

drop policy if exists dispersores_comprobante_pse_insert on storage.objects;
drop policy if exists dispersores_comprobante_pse_delete on storage.objects;
drop function if exists public.deshacer_pago_pse(uuid[], text);
delete from public.rol_permisos where permiso = 'accion.pagar_pse';

-- marcar_pagos_pagados como en 20270101000300 (solo generar_dispersores).
create or replace function public.marcar_pagos_pagados(p_ids uuid[], p_cuenta_id uuid, p_comprobante jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ruta text := nullif(btrim(coalesce(p_comprobante ->> 'ruta', '')), '');
  v_mime text := p_comprobante ->> 'mime';
  v_nombre text := left(coalesce(nullif(btrim(p_comprobante ->> 'nombre'), ''), 'comprobante'), 200);
  v_cuenta record;
  v_ids uuid[];
begin
  if not public.tiene_accion(auth.uid(), 'generar_dispersores') then
    raise exception 'No autorizado -- no tienes permiso para realizar pagos.';
  end if;
  select c.id, c.apodo, c.numero_cuenta into v_cuenta
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
  with marcados as (
    update public.pagos g
       set estado = 'dispersado', dispersado_en = now(), cuenta_debitar_id = v_cuenta.id,
           pagado_manual_por = auth.uid(),
           pago_comprobante_ruta = v_ruta,
           pago_comprobante_nombre = case when v_ruta is null then null else v_nombre end,
           pago_comprobante_mime = case when v_ruta is null then null else v_mime end
      from public._pagos_por_dispersar(p_ids) x
     where g.id = x.id and x.dispersion_id is null and x.referencia is not null
       and (x.fuera_dispersor or public.pago_es_pse(x))
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

commit;
