-- Paquete E: A&F (decisiones del usuario, 2026-11-12).
--
-- 1. Un pago sin cuenta bancaria no pasa a liquidación (salvo PSE, que no lleva
--    cuenta): enviar_pagos_a_liquidar los salta y
--    enviar_pagos_a_liquidar_detalle dice cuántos quedaron por eso.
--    pago_es_pse(pagos) (campo calculado para la API): PSE de la requisición
--    administrativa (ítem o cuadro), de la OC o del contrato del acta.
-- 2. Pagos por PSE (o por otro medio) en Realizar Pagos: "Marcar como pagado"
--    con la cuenta desde la que se pagó; queda dispersado con la fecha de ese
--    día y, si se adjunta, el comprobante (bucket dispersores, carpeta pse/).
--    "Rebotó en el banco" también los devuelve.
-- 3. RUT del tercero (terceros.rut_*): obligatorio al crear (con la cuenta y su
--    certificación bancaria, también obligatorias); en Preparación del
--    Consolidado y en la ficha se sube o se cambia (guardar_rut_tercero).
--
-- Solo agrega; los ajustes a funciones vivas son parches por texto exacto
-- (fallan si no encuentran el texto, no hacen nada si ya están). Se puede correr
-- dos veces. Reversa en supabase/reversa/20270101000300_paquete_e_ayf.sql.

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

-- 1. PSE y pagos sin cuenta ------------------------------------------------------
create or replace function public.pago_es_pse(p public.pagos)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select coalesce(i.metodo, r.metodo) = 'pse'
                     from public.requisiciones_admin r
                     left join public.requisicion_admin_items i on i.id = p.requisicion_admin_item_id
                    where r.id = p.requisicion_admin_id), false)
      or exists (select 1 from public.ordenes_compra oc where oc.id = p.orden_compra_id and oc.metodo_pago = 'pse')
      or exists (select 1 from public.actas a join public.contratos c on c.id = a.contrato_id
                  where a.id = p.acta_id and c.metodo_pago = 'pse')
$$;
revoke all on function public.pago_es_pse(public.pagos) from public, anon;
grant execute on function public.pago_es_pse(public.pagos) to authenticated;

select pg_temp._parche('public.enviar_pagos_a_liquidar(uuid[])'::regprocedure,
  $a$         and g.estado = 'aprobado' and g.liquidacion_estado is null and g.semana is not null
$a$,
  $b$         and g.estado = 'aprobado' and g.liquidacion_estado is null and g.semana is not null
         and (g.cuenta_tercero_id is not null or public.pago_es_pse(g))
$b$);

-- Lo mismo, diciendo cuántos de los elegidos se quedaron por no tener cuenta.
create or replace function public.enviar_pagos_a_liquidar_detalle(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sin_cuenta integer;
  v_n integer;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para gestionar pagos.';
  end if;
  select count(*) into v_sin_cuenta
    from public.pagos g
   where g.id = any (coalesce(p_ids, '{}'))
     and g.estado = 'aprobado' and g.liquidacion_estado is null and g.semana is not null
     and g.cuenta_tercero_id is null and not public.pago_es_pse(g)
     and (public.tiene_pestana(auth.uid(), 'ayf.aprobacion_pagos')
          or g.consolidado_id in (select public._consolidados_visibles(auth.uid())));
  v_n := public.enviar_pagos_a_liquidar(p_ids);
  return jsonb_build_object('enviados', v_n, 'sin_cuenta', v_sin_cuenta);
end;
$$;
revoke all on function public.enviar_pagos_a_liquidar_detalle(uuid[]) from public, anon;
grant execute on function public.enviar_pagos_a_liquidar_detalle(uuid[]) to authenticated;

-- 2. Pagos por PSE u otro medio: marcar como pagados -----------------------------
alter table public.pagos add column if not exists pagado_manual_por uuid references public.perfiles(id);
alter table public.pagos add column if not exists pago_comprobante_ruta text;
alter table public.pagos add column if not exists pago_comprobante_nombre text;
alter table public.pagos add column if not exists pago_comprobante_mime text;
create index if not exists pagos_comprobante_ruta_idx on public.pagos (pago_comprobante_ruta)
  where pago_comprobante_ruta is not null;

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

  -- _pagos_por_dispersar revisa el permiso, el consolidado y los bloquea.
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
revoke all on function public.marcar_pagos_pagados(uuid[], uuid, jsonb) from public, anon;
grant execute on function public.marcar_pagos_pagados(uuid[], uuid, jsonb) to authenticated;

-- Rebotó en el banco: también quita lo de "pagado por otro medio".
select pg_temp._parche('public.redispersar_pagos(uuid[],text)'::regprocedure,
  $a$     set estado = 'aprobado', dispersion_id = null, dispersado_en = null, cuenta_debitar_id = null
$a$,
  $b$     set estado = 'aprobado', dispersion_id = null, dispersado_en = null, cuenta_debitar_id = null,
         pagado_manual_por = null, pago_comprobante_ruta = null, pago_comprobante_nombre = null, pago_comprobante_mime = null
$b$);

-- El comprobante lo ve quien ve el pago (Consolidado › Dispersados).
drop policy if exists dispersores_comprobante_pse_select on storage.objects;
create policy dispersores_comprobante_pse_select on storage.objects for select to authenticated
  using (bucket_id = 'dispersores' and (storage.foldername(name))[1] = 'pse'
         and name in (select p.pago_comprobante_ruta from public.pagos p where p.pago_comprobante_ruta is not null));

-- 3. RUT del tercero -------------------------------------------------------------
alter table public.terceros add column if not exists rut_ruta text;
alter table public.terceros add column if not exists rut_nombre text;
alter table public.terceros add column if not exists rut_mime text;
alter table public.terceros add column if not exists rut_subido_en timestamptz;
alter table public.terceros add column if not exists rut_subido_por uuid;
create index if not exists terceros_rut_ruta_idx on public.terceros (rut_ruta) where rut_ruta is not null;

create or replace function public._puede_ver_rut(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._puede_revisar_cuentas(p_uid)
      or public.tiene_accion(p_uid, 'gestionar_pagos')
      or public._ve_algun_consolidado(p_uid)
      or public.tiene_pestana(p_uid, 'ayf.terceros')
      or public.tiene_pestana(p_uid, 'ayf.aprobacion_pagos')
$$;
revoke all on function public._puede_ver_rut(uuid) from public, anon, authenticated;

-- Al crear: el navegador lo sube a terceros/nuevo/<uid>/ (como la certificación).
create or replace function public._rut_tercero_nuevo(p_tercero_id uuid, p_rut jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ruta text := p_rut ->> 'ruta';
  v_mime text := p_rut ->> 'mime';
begin
  if v_ruta is null or v_ruta not like 'nuevo/' || auth.uid()::text || '/%' then
    raise exception 'El RUT no se subió bien: vuelve a adjuntarlo.';
  end if;
  if coalesce(v_mime, '') not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'El RUT debe ser PDF, JPG o PNG.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'terceros' and o.name = v_ruta) then
    raise exception 'No se encontró el RUT subido: vuelve a adjuntarlo.';
  end if;
  update public.terceros
     set rut_ruta = v_ruta, rut_nombre = left(coalesce(nullif(trim(p_rut ->> 'nombre'), ''), 'rut'), 200),
         rut_mime = v_mime, rut_subido_en = now(), rut_subido_por = auth.uid()
   where id = p_tercero_id;
end;
$$;
revoke all on function public._rut_tercero_nuevo(uuid, jsonb) from public, anon, authenticated;

-- crear_tercero: cuenta, certificación y RUT obligatorios.
select pg_temp._parche('public.crear_tercero(jsonb,jsonb)'::regprocedure,
  $a$  if p_cuenta is not null then
    v_banco := nullif(p_cuenta ->> 'banco_id', '')::uuid;$a$,
  $b$  if p_cuenta is null then
    raise exception 'Agrega la cuenta bancaria del tercero.';
  end if;
  if jsonb_typeof(p_cuenta -> 'certificacion') is distinct from 'object' then
    raise exception 'Adjunta la certificación bancaria.';
  end if;
  if jsonb_typeof(p_datos -> 'rut') is distinct from 'object' then
    raise exception 'Adjunta el RUT.';
  end if;

  if p_cuenta is not null then
    v_banco := nullif(p_cuenta ->> 'banco_id', '')::uuid;$b$);

select pg_temp._parche('public.crear_tercero(jsonb,jsonb)'::regprocedure,
  $a$  returning id into v_id;
$a$,
  $b$  returning id into v_id;
  perform public._rut_tercero_nuevo(v_id, p_datos -> 'rut');
$b$);

-- Subir o cambiar el RUT de un tercero que ya existe (ficha y Preparación).
create or replace function public.guardar_rut_tercero(p_tercero_id uuid, p_ruta text, p_nombre text, p_mime text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.tiene_accion(auth.uid(), 'editar_terceros')
          or public.tiene_accion(auth.uid(), 'verificar_terceros')
          or public.tiene_accion(auth.uid(), 'gestionar_pagos')) then
    raise exception 'No tienes permiso para subir el RUT.';
  end if;
  if p_ruta is null or p_ruta not like 'rut/' || p_tercero_id::text || '/%' then
    raise exception 'La ruta del archivo no es de este tercero.';
  end if;
  if coalesce(p_mime, '') not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'El RUT debe ser PDF, JPG o PNG.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'terceros' and o.name = p_ruta) then
    raise exception 'No se encontró el archivo subido.';
  end if;
  update public.terceros
     set rut_ruta = p_ruta, rut_nombre = left(coalesce(nullif(trim(p_nombre), ''), 'rut'), 200),
         rut_mime = p_mime, rut_subido_en = now(), rut_subido_por = auth.uid()
   where id = p_tercero_id;
  if not found then
    raise exception 'El tercero no existe.';
  end if;
end;
$$;
revoke all on function public.guardar_rut_tercero(uuid, text, text, text) from public, anon;
grant execute on function public.guardar_rut_tercero(uuid, text, text, text) to authenticated;

-- Archivos del RUT en el bucket terceros.
drop policy if exists terceros_rut_insert on storage.objects;
create policy terceros_rut_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'terceros' and (storage.foldername(name))[1] = 'rut'
              and (select public.tiene_accion((select auth.uid()), 'gestionar_pagos')));

drop policy if exists terceros_rut_delete on storage.objects;
create policy terceros_rut_delete on storage.objects for delete to authenticated
  using (bucket_id = 'terceros' and (storage.foldername(name))[1] = 'rut'
         and (select public.tiene_accion((select auth.uid()), 'gestionar_pagos'))
         and name not in (select t.rut_ruta from public.terceros t where t.rut_ruta is not null));

drop policy if exists terceros_rut_select on storage.objects;
create policy terceros_rut_select on storage.objects for select to authenticated
  using (bucket_id = 'terceros' and (select public._puede_ver_rut((select auth.uid())))
         and name in (select t.rut_ruta from public.terceros t where t.rut_ruta is not null));

commit;
