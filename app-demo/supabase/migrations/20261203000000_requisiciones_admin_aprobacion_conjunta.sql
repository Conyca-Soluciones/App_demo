-- ---------------------------------------------------------------------------
-- Requisiciones administrativas: se aprueban en Aprobación de pagos COMO UNA
-- ORDEN DE COMPRA, el cuadro completo (corrige 20261202000000; decisiones del
-- usuario 2026-10-22: "no hay aprobación de la requisición sola" y "deben ser
-- aprobadas como las órdenes de compra, porque es un cuadro junto").
--
--   * Al enviarla, cada ítem es un pago "por aprobar" (solicitado): el
--     consolidado necesita una fila por ítem (cada uno con su titular y
--     cuenta). En Aprobación de pagos la requisición sale en UNA fila (el pago
--     "principal" del lote, con el total y el número de ítems por
--     `lote_requisicion_admin`) y se aprueba o rechaza completa
--     (aprobar_requisicion_admin / rechazar_requisicion_admin). aprobar_pago y
--     rechazar_pago no aceptan un ítem suelto.
--   * Estados: por_aprobar | aprobada | rechazada | cancelada.
--   * Quien la hizo la modifica o la corrige mientras no esté aprobada: los
--     pagos por aprobar se anulan y se crean los nuevos (un lote nuevo); los
--     rechazados quedan como registro. Igual para cancelar.
--   * Se borra resolver_requisicion_admin.
-- ---------------------------------------------------------------------------

alter table public.requisiciones_admin drop constraint if exists requisiciones_admin_estado_check;
alter table public.requisiciones_admin add constraint requisiciones_admin_estado_check
  check (estado in ('por_aprobar', 'aprobada', 'rechazada', 'cancelada'));

-- Al modificar se reemplazan los ítems: los pagos viejos (rechazados o
-- anulados) se quedan con su requisición pero sin ítem.
alter table public.pagos drop constraint if exists pagos_requisicion_admin_item_id_fkey;
alter table public.pagos add constraint pagos_requisicion_admin_item_id_fkey
  foreign key (requisicion_admin_item_id) references public.requisicion_admin_items(id) on delete set null;
alter table public.pagos drop constraint if exists pagos_fuente_coherente;
alter table public.pagos add constraint pagos_fuente_coherente check (
  ((fuente = 'orden_compra') = (orden_compra_id is not null))
  and ((fuente = 'acta') = (acta_id is not null))
  and ((fuente = 'requisicion_admin') = (requisicion_admin_id is not null))
);

alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo in (
  'pedido_rechazado', 'pedido_aprobado', 'orden_compra_rechazada', 'orden_compra_aprobada',
  'insumo_sobre_presupuesto', 'orden_compra_precio_sobre_efectivo', 'contrato_por_revisar', 'contrato_aprobado',
  'contrato_devuelto', 'contrato_rechazado', 'acta_aprobada', 'acta_rechazada', 'minuta_por_revisar',
  'minuta_aprobada', 'minuta_devuelta', 'contrato_vencido', 'contrato_vencido_juridica', 'insumo_rechazado',
  'otrosi_por_revisar', 'otrosi_por_aprobar', 'otrosi_devuelto', 'otrosi_rechazado', 'otrosi_aprobado',
  'otrosi_devuelto_subgerencia', 'poliza_pendiente', 'poliza_por_revisar', 'poliza_aprobada', 'poliza_devuelta',
  'requisicion_admin_aprobada', 'requisicion_admin_rechazada')) not valid;

drop function if exists public.resolver_requisicion_admin(uuid, text, text);

-- Lote = los pagos de UN envío de la requisición; el principal (ítem 1) es la
-- fila que sale en Aprobación de pagos.
alter table public.pagos add column if not exists requisicion_admin_lote uuid;
alter table public.pagos add column if not exists requisicion_admin_principal boolean not null default false;
create index if not exists idx_pagos_requisicion_admin_lote on public.pagos(requisicion_admin_lote);

-- ------------------------------------------------------ guardar (corrección)
-- La versión de 20261202000000 leía v_fac.id / v_tit.id también en PSE, donde
-- esos registros no se llenan: la primera requisición PSE de una conexión
-- fallaba ("record v_fac is not assigned yet"). Ahora van en variables uuid.
create or replace function public._guardar_requisicion_admin(p_id uuid, p_metodo text, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_it jsonb;
  v_n integer := 0;
  v_total numeric := 0;
  v_valor numeric;
  v_empresa uuid;
  v_proyecto uuid;
  v_fac record;
  v_tit record;
  v_cuenta uuid;
  v_fac_id uuid;
  v_tit_id uuid;
  v_fac_nombre text;
  v_fac_nit text;
  v_tit_nombre text;
  v_tit_tipo text;
  v_tit_doc text;
  v_fila text;
begin
  if p_metodo not in ('transferencia', 'pse') then
    raise exception 'Elige el método de pago: transferencia o PSE.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un ítem.';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Una requisición tiene como máximo 50 ítems.';
  end if;

  delete from public.requisicion_admin_items where requisicion_id = p_id;

  for v_it in select value from jsonb_array_elements(p_items)
  loop
    v_n := v_n + 1;
    v_fila := 'Ítem ' || v_n || ': ';

    v_empresa := nullif(v_it ->> 'empresa_id', '')::uuid;
    if v_empresa is null or not exists (select 1 from public.empresas where id = v_empresa) then
      raise exception '%elige el grupo empresarial.', v_fila;
    end if;
    v_proyecto := nullif(v_it ->> 'proyecto_id', '')::uuid;
    if v_proyecto is null or not exists (select 1 from public.proyectos where id = v_proyecto) then
      raise exception '%elige el código de proyecto.', v_fila;
    end if;
    if btrim(coalesce(v_it ->> 'concepto', '')) = '' then
      raise exception '%escribe el concepto de la factura.', v_fila;
    end if;
    begin
      v_valor := round((v_it ->> 'valor')::numeric, 2);
    exception when others then
      v_valor := null;
    end;
    if v_valor is null or v_valor <= 0 then
      raise exception '%el valor debe ser mayor que cero.', v_fila;
    end if;

    v_cuenta := null;
    v_fac_id := null;
    v_tit_id := null;
    if p_metodo = 'transferencia' then
      select t.id, t.razon_social, t.tipo_documento, t.numero_documento, t.dv into v_fac
        from public.terceros t where t.id = nullif(v_it ->> 'tercero_factura_id', '')::uuid;
      if v_fac.id is null then
        raise exception '%la empresa que factura tiene que estar inscrita en Terceros.', v_fila;
      end if;
      select t.id, t.razon_social, t.tipo_documento, t.numero_documento into v_tit
        from public.terceros t
       where t.id = coalesce(nullif(v_it ->> 'titular_tercero_id', '')::uuid, v_fac.id);
      if v_tit.id is null then
        raise exception '%el titular de la cuenta tiene que estar inscrito en Terceros.', v_fila;
      end if;
      select c.id into v_cuenta
        from public.terceros_cuentas c
       where c.id = nullif(v_it ->> 'cuenta_tercero_id', '')::uuid
         and c.tercero_id = v_tit.id and c.estado <> 'INACTIVO';
      if v_cuenta is null then
        raise exception '%elige una cuenta del titular (registrada en Terceros).', v_fila;
      end if;
      v_fac_id := v_fac.id;
      v_tit_id := v_tit.id;
      v_fac_nombre := v_fac.razon_social;
      v_fac_nit := v_fac.numero_documento || coalesce('-' || v_fac.dv, '');
      v_tit_nombre := v_tit.razon_social;
      v_tit_tipo := v_tit.tipo_documento;
      v_tit_doc := v_tit.numero_documento;
    else
      v_fac_nombre := btrim(coalesce(v_it ->> 'factura_nombre', ''));
      v_fac_nit := regexp_replace(btrim(coalesce(v_it ->> 'factura_nit', '')), '[^0-9-]', '', 'g');
      v_tit_nombre := btrim(coalesce(v_it ->> 'titular_nombre', ''));
      v_tit_tipo := upper(btrim(coalesce(v_it ->> 'titular_tipo_documento', '')));
      v_tit_doc := regexp_replace(coalesce(v_it ->> 'titular_documento', ''), '[^0-9]', '', 'g');
      if v_fac_nombre = '' then
        raise exception '%escribe la empresa que factura.', v_fila;
      end if;
      if v_fac_nit !~ '^[0-9]+(-[0-9])?$' then
        raise exception '%el NIT de la empresa que factura solo lleva números (y el dígito de verificación después de un guion).', v_fila;
      end if;
      if v_tit_nombre = '' then
        raise exception '%escribe el titular de la cuenta.', v_fila;
      end if;
      if v_tit_tipo not in ('CC', 'NIT', 'CE', 'PPT') then
        raise exception '%el tipo de documento del titular debe ser CC, NIT, PPT o CE.', v_fila;
      end if;
      if v_tit_doc = '' then
        raise exception '%escribe el NIT o CC del titular.', v_fila;
      end if;
    end if;

    insert into public.requisicion_admin_items (
      requisicion_id, orden, empresa_id, tercero_factura_id, factura_nombre, factura_nit,
      titular_tercero_id, titular_nombre, titular_tipo_documento, titular_documento, cuenta_tercero_id,
      concepto, proyecto_id, valor, observaciones)
    values (
      p_id, v_n, v_empresa,
      v_fac_id, v_fac_nombre, v_fac_nit,
      v_tit_id, v_tit_nombre, v_tit_tipo, v_tit_doc, v_cuenta,
      btrim(v_it ->> 'concepto'), v_proyecto, v_valor, nullif(btrim(coalesce(v_it ->> 'observaciones', '')), ''));

    v_total := v_total + v_valor;
  end loop;

  update public.requisiciones_admin
     set metodo = p_metodo, n_items = v_n, valor_total = v_total, enviada_en = now()
   where id = p_id;
end;
$$;
revoke all on function public._guardar_requisicion_admin(uuid, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------ pagos de la requisición
-- Un pago por aprobar por ítem, todos del mismo lote. La empresa y el consolidado salen del grupo
-- empresarial del ítem.
create or replace function public._crear_pagos_requisicion_admin(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
  v_it record;
  v_pago uuid;
  v_lote uuid := gen_random_uuid();
  v_primero boolean := true;
begin
  select * into v_r from public.requisiciones_admin where id = p_id;
  for v_it in
    select i.*, e.consolidado_id
      from public.requisicion_admin_items i
      join public.empresas e on e.id = i.empresa_id
     where i.requisicion_id = p_id
     order by i.orden
  loop
    insert into public.pagos (fuente, requisicion_admin_id, requisicion_admin_item_id, requisicion_admin_lote,
                              requisicion_admin_principal, tipo, proyecto_id, empresa_id,
                              consolidado_id, tercero_id, cuenta_tercero_id, concepto, valor, estado, solicitado_en)
    values ('requisicion_admin', p_id, v_it.id, v_lote, v_primero, 'unico', v_it.proyecto_id, v_it.empresa_id, v_it.consolidado_id,
            v_it.titular_tercero_id, v_it.cuenta_tercero_id,
            upper('Req. administrativa N° ' || v_r.numero || case when v_r.metodo = 'pse' then ' (PSE)' else '' end
                  || ' - ' || v_it.concepto || ' - ' || v_it.factura_nombre),
            v_it.valor, 'solicitado', now())
    returning id into v_pago;
    perform public._pago_actualizar_novedad(v_pago);
    v_primero := false;
  end loop;
end;
$$;
revoke all on function public._crear_pagos_requisicion_admin(uuid) from public, anon, authenticated;

-- Se puede modificar o cancelar mientras ningún pago esté aprobado (ni más
-- allá: liquidado, en dispersión, pagado).
create or replace function public._req_admin_sin_pagos_aprobados(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.pagos g
                      where g.requisicion_admin_id = p_id
                        and g.estado not in ('solicitado', 'rechazado', 'anulado'))
$$;
revoke all on function public._req_admin_sin_pagos_aprobados(uuid) from public, anon, authenticated;

create or replace function public._anular_pagos_requisicion_admin(p_id uuid, p_motivo text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.pagos
     set estado = 'anulado', anulado_en = now(), motivo_anulacion = p_motivo
   where requisicion_admin_id = p_id and estado = 'solicitado'
$$;
revoke all on function public._anular_pagos_requisicion_admin(uuid, text) from public, anon, authenticated;

-- ------------------------------------------------------- crear / modificar
create or replace function public.crear_requisicion_admin(p_metodo text, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión.';
  end if;
  insert into public.requisiciones_admin (metodo, n_items, valor_total, creado_por)
  values (case when p_metodo in ('transferencia', 'pse') then p_metodo else 'transferencia' end, 1, 1, auth.uid())
  returning id into v_id;
  perform public._guardar_requisicion_admin(v_id, p_metodo, p_items);
  update public.requisiciones_admin set numero = nextval('public.requisiciones_admin_numero_seq') where id = v_id;
  perform public._crear_pagos_requisicion_admin(v_id);
  insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  select 'requisicion_admin', v_id, 'creada', auth.uid(),
         jsonb_build_object('metodo', r.metodo, 'items', r.n_items, 'valor', r.valor_total)
    from public.requisiciones_admin r where r.id = v_id;
  return v_id;
end;
$$;

create or replace function public.modificar_requisicion_admin(p_id uuid, p_metodo text, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
begin
  select * into v_r from public.requisiciones_admin where id = p_id for update;
  if v_r.id is null or v_r.creado_por is distinct from auth.uid() then
    raise exception 'La requisición no existe o no la hiciste tú.';
  end if;
  if v_r.estado not in ('por_aprobar', 'rechazada') or not public._req_admin_sin_pagos_aprobados(p_id) then
    raise exception 'Ya no se puede modificar: A&F aprobó pagos de esta requisición.';
  end if;
  perform public._anular_pagos_requisicion_admin(p_id, 'Requisición administrativa modificada.');
  perform public._guardar_requisicion_admin(p_id, p_metodo, p_items);
  perform public._crear_pagos_requisicion_admin(p_id);
  update public.requisiciones_admin
     set estado = 'por_aprobar', resuelta_por = null, resuelta_en = null, motivo_rechazo = null
   where id = p_id;
  insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  select 'requisicion_admin', p_id, case when v_r.estado = 'rechazada' then 'reenviada' else 'modificada' end, auth.uid(),
         jsonb_build_object('metodo', r.metodo, 'items', r.n_items, 'valor', r.valor_total)
    from public.requisiciones_admin r where r.id = p_id;
end;
$$;

create or replace function public.cancelar_requisicion_admin(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
begin
  if btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'El motivo es obligatorio.';
  end if;
  select * into v_r from public.requisiciones_admin where id = p_id for update;
  if v_r.id is null or v_r.creado_por is distinct from auth.uid() then
    raise exception 'La requisición no existe o no la hiciste tú.';
  end if;
  if v_r.estado not in ('por_aprobar', 'rechazada') or not public._req_admin_sin_pagos_aprobados(p_id) then
    raise exception 'Ya no se puede cancelar: A&F aprobó pagos de esta requisición.';
  end if;
  update public.requisiciones_admin
     set estado = 'cancelada', cancelada_en = now(), motivo_cancelacion = btrim(p_motivo)
   where id = p_id;
  perform public._anular_pagos_requisicion_admin(p_id, 'Requisición administrativa cancelada: ' || btrim(p_motivo));
  insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo)
  values ('requisicion_admin', p_id, 'cancelada', auth.uid(), btrim(p_motivo));
end;
$$;

-- ------------------------------------------------ aprobar / rechazar (A&F)
-- El cuadro completo, como una orden de compra: todos los pagos por aprobar de
-- la requisición a la vez (acción aprobar_pagos). Aprobar da el ITEM del
-- consolidado a cada uno, en el orden de los ítems.
drop trigger if exists trg_req_admin_sigue_pagos on public.pagos;
drop function if exists public._req_admin_sigue_pagos();

create or replace function public.aprobar_requisicion_admin(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
  v_pago record;
  v_n integer := 0;
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para aprobar pagos.';
  end if;
  select * into v_r from public.requisiciones_admin where id = p_id for update;
  if v_r.id is null or v_r.estado <> 'por_aprobar' then
    raise exception 'La requisición no existe o ya no está por aprobar.';
  end if;
  for v_pago in
    select g.id from public.pagos g
      join public.requisicion_admin_items i on i.id = g.requisicion_admin_item_id
     where g.requisicion_admin_id = p_id and g.estado = 'solicitado'
     order by i.orden
     for update of g
  loop
    update public.pagos set estado = 'aprobado', aprobado_por = auth.uid(), aprobado_en = now() where id = v_pago.id;
    perform public._pago_asignar_item(v_pago.id);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'La requisición no tiene pagos por aprobar.';
  end if;
  update public.requisiciones_admin
     set estado = 'aprobada', resuelta_por = auth.uid(), resuelta_en = now(), motivo_rechazo = null
   where id = p_id;
  insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('requisicion_admin', p_id, 'aprobada', auth.uid(), jsonb_build_object('pagos', v_n, 'valor', v_r.valor_total));
  if v_r.creado_por is distinct from auth.uid() then
    insert into public.notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    values (v_r.creado_por, 'requisicion_admin_aprobada', 'requisicion_admin', p_id,
            'Requisición administrativa N° ' || v_r.numero || ' aprobada',
            'A&F aprobó la requisición: sus ' || v_n || ' pago(s) pasan al consolidado.');
  end if;
end;
$$;

create or replace function public.rechazar_requisicion_admin(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para rechazar pagos.';
  end if;
  if btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'El motivo de rechazo es obligatorio.';
  end if;
  select * into v_r from public.requisiciones_admin where id = p_id for update;
  if v_r.id is null or v_r.estado <> 'por_aprobar' then
    raise exception 'La requisición no existe o ya no está por aprobar.';
  end if;
  update public.pagos
     set estado = 'rechazado', rechazado_por = auth.uid(), rechazado_en = now(), motivo_rechazo = btrim(p_motivo)
   where requisicion_admin_id = p_id and estado = 'solicitado';
  update public.requisiciones_admin
     set estado = 'rechazada', resuelta_por = auth.uid(), resuelta_en = now(), motivo_rechazo = btrim(p_motivo)
   where id = p_id;
  insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo)
  values ('requisicion_admin', p_id, 'rechazada', auth.uid(), btrim(p_motivo));
  if v_r.creado_por is distinct from auth.uid() then
    insert into public.notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    values (v_r.creado_por, 'requisicion_admin_rechazada', 'requisicion_admin', p_id,
            'Requisición administrativa N° ' || v_r.numero || ' rechazada',
            'A&F la rechazó: ' || btrim(p_motivo) || '. Corrígela y envíala otra vez.');
  end if;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['aprobar_requisicion_admin(uuid)', 'rechazar_requisicion_admin(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Un ítem suelto no se aprueba ni se rechaza: va con su requisición.
create or replace function public.aprobar_pago(p_pago_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para aprobar pagos.';
  end if;
  if exists (select 1 from public.pagos where id = p_pago_id and requisicion_admin_id is not null) then
    raise exception 'Este pago es de una requisición administrativa: se aprueba con la requisición completa.';
  end if;

  update public.pagos
     set estado = 'aprobado', aprobado_por = auth.uid(), aprobado_en = now()
   where id = p_pago_id and estado = 'solicitado';
  if not found then
    raise exception 'El pago no existe o ya no está pendiente de aprobación.';
  end if;

  perform public._pago_asignar_item(p_pago_id);
end;
$function$;

create or replace function public.rechazar_pago(p_pago_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para rechazar pagos.';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo de rechazo es obligatorio.';
  end if;
  if exists (select 1 from public.pagos where id = p_pago_id and requisicion_admin_id is not null) then
    raise exception 'Este pago es de una requisición administrativa: se rechaza con la requisición completa.';
  end if;

  update public.pagos
     set estado = 'rechazado', rechazado_por = auth.uid(), rechazado_en = now(),
         motivo_rechazo = btrim(p_motivo)
   where id = p_pago_id and estado = 'solicitado';
  if not found then
    raise exception 'El pago no existe o ya no está pendiente de aprobación.';
  end if;
end;
$function$;

-- Total e ítems del lote, para la fila de la requisición en Aprobación de
-- pagos (columna calculada de PostgREST: `lote_requisicion_admin` en el
-- select). Con la sesión de quien consulta: la RLS de pagos aplica.
create or replace function public.lote_requisicion_admin(p public.pagos)
returns jsonb
language sql
stable
set search_path = public
as $$
  select case when p.requisicion_admin_lote is null then null else
    (select jsonb_build_object('items', count(*), 'total', coalesce(sum(g.valor), 0))
       from public.pagos g where g.requisicion_admin_lote = p.requisicion_admin_lote) end
$$;
revoke all on function public.lote_requisicion_admin(public.pagos) from public, anon;
grant execute on function public.lote_requisicion_admin(public.pagos) to authenticated;

-- ------------------------------------------------------- detalle
-- Con el pago de cada ítem (estado, ITEM del consolidado y motivo de rechazo)
-- y si todavía se puede modificar.
create or replace function public.detalle_requisicion_admin(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_r record;
  v_ve_ayf boolean;
begin
  select * into v_r from public.requisiciones_admin where id = p_id;
  v_ve_ayf := public._ve_requisiciones_admin(v_uid);
  if v_r.id is null or (v_r.creado_por is distinct from v_uid and not v_ve_ayf) then
    raise exception 'La requisición no existe o no tienes acceso.';
  end if;
  return jsonb_build_object(
    'id', v_r.id, 'numero', v_r.numero, 'metodo', v_r.metodo, 'estado', v_r.estado,
    'n_items', v_r.n_items, 'valor_total', v_r.valor_total,
    'creado_por', v_r.creado_por, 'es_mia', v_r.creado_por = v_uid,
    'editable', v_r.estado in ('por_aprobar', 'rechazada') and public._req_admin_sin_pagos_aprobados(p_id),
    'creado_por_nombre', (select nombre from public.perfiles where id = v_r.creado_por),
    'creado_en', v_r.creado_en, 'enviada_en', v_r.enviada_en,
    'resuelta_en', v_r.resuelta_en,
    'resuelta_por_nombre', (select nombre from public.perfiles where id = v_r.resuelta_por),
    'motivo_rechazo', v_r.motivo_rechazo, 'motivo_cancelacion', v_r.motivo_cancelacion,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'orden', i.orden,
               'empresa_id', i.empresa_id, 'empresa_nombre', e.razon_social,
               'tercero_factura_id', i.tercero_factura_id, 'factura_nombre', i.factura_nombre,
               'factura_nit', i.factura_nit,
               'titular_tercero_id', i.titular_tercero_id, 'titular_nombre', i.titular_nombre,
               'titular_tipo_documento', i.titular_tipo_documento, 'titular_documento', i.titular_documento,
               'cuenta_tercero_id', i.cuenta_tercero_id,
               'banco', b.nombre, 'tipo_cuenta', c.tipo_cuenta,
               -- Número completo solo para A&F; a los demás, enmascarado.
               'numero_cuenta', case when c.id is null then null
                                     when v_ve_ayf then c.numero_cuenta
                                     else repeat('•', greatest(length(c.numero_cuenta) - 4, 0)) || right(c.numero_cuenta, 4) end,
               'cuenta_verificada', c.estado = 'ACTIVO',
               'concepto', i.concepto, 'proyecto_id', i.proyecto_id,
               'proyecto_codigo', p.codigo, 'proyecto_nombre', p.nombre,
               'valor', i.valor, 'observaciones', i.observaciones,
               'pago_item', g.item, 'pago_semana', g.semana, 'pago_anio', g.anio, 'pago_estado', g.estado,
               'pago_motivo_rechazo', g.motivo_rechazo
             ) order by i.orden)
        from public.requisicion_admin_items i
        join public.empresas e on e.id = i.empresa_id
        join public.proyectos p on p.id = i.proyecto_id
        left join public.terceros_cuentas c on c.id = i.cuenta_tercero_id
        left join public.bancos b on b.id = c.banco_id
        left join lateral (select x.item, x.semana, x.anio, x.estado, x.motivo_rechazo from public.pagos x
                            where x.requisicion_admin_item_id = i.id
                            order by x.creado_en desc limit 1) g on true
       where i.requisicion_id = p_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.detalle_requisicion_admin(uuid) from public, anon;
grant execute on function public.detalle_requisicion_admin(uuid) to authenticated;

-- ------------------------------------------------- Mis pendientes
-- Recrea _pendientes_de (copia EXACTA de 20261202000000, verificada contra la
-- base): la requisición sale UNA vez ("req_admin_por_aprobar") y sus ítems ya
-- no salen sueltos en "Pagos por aprobar".
create or replace function public._pendientes_de(p_uid uuid)
returns table (
  tipo text,         -- clave del grupo (lib/pendientes.ts tiene su título)
  categoria text,    -- 'hacer' (le toca a la persona) | 'seguimiento' (lo suyo, en manos de otro)
  id uuid,
  proyecto_id uuid,
  titulo text,
  detalle text,
  monto numeric,
  desde timestamptz, -- desde cuándo espera
  de_quien uuid,     -- quién lo envió o lo creó
  vence date,        -- fecha requerida o de entrega, si tiene
  url text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_proys uuid[] := array(select public.proyectos_visibles(p_uid));
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_aprobar_pedidos boolean := public.tiene_accion(p_uid, 'aprobar_pedidos');
  v_comprar boolean := public.tiene_accion(p_uid, 'comprar');
  v_aprobar_insumos boolean := public.tiene_accion(p_uid, 'aprobar_insumos');
  v_aprobar_mo boolean := public.tiene_accion(p_uid, 'aprobar_mano_obra');
  v_aprobar_oc boolean := public.tiene_accion(p_uid, 'aprobar_oc');
  v_almacen boolean := public.tiene_accion(p_uid, 'gestionar_almacen');
  v_aprobar_pagos boolean := public.tiene_accion(p_uid, 'aprobar_pagos');
  v_gestionar_pagos boolean := public.tiene_accion(p_uid, 'gestionar_pagos');
  v_verificar boolean := public.tiene_accion(p_uid, 'verificar_terceros');
  v_juridica boolean := public.tiene_accion(p_uid, 'aprobar_contratos');
  v_subgerencia boolean := public.tiene_accion(p_uid, 'aprobar_minutas');
  v_revisar_polizas boolean := public.tiene_accion(p_uid, 'aprobar_contratos')
                               and public.tiene_pestana(p_uid, 'contratos.aprobar_polizas');
  -- Firma: quien elabora o aprueba documentos que se firman (actas, pólizas,
  -- órdenes de compra, minutas y otrosí; 20261129000000 y 20261130100000).
  v_firma_pendiente boolean := (public.tiene_accion(p_uid, 'elaborar_actas')
                                or public.tiene_accion(p_uid, 'aprobar_pagos')
                                or public.tiene_accion(p_uid, 'aprobar_contratos')
                                or public.tiene_accion(p_uid, 'aprobar_minutas')
                                or public.tiene_accion(p_uid, 'solicitar_contratos')
                                or public.tiene_accion(p_uid, 'comprar')
                                or public.tiene_accion(p_uid, 'aprobar_oc'))
                               and not exists (select 1 from public.firmas_usuario f where f.perfil_id = p_uid);
begin
  if p_uid is null then
    return;
  end if;

  return query
  -- ------------------------------------------------ Requisiciones por aprobar
  select 'req_por_aprobar', 'hacer', r.id, r.proyecto_id,
         'Requisición N° ' || r.numero,
         r.n_lineas || case when r.n_lineas = 1 then ' insumo' else ' insumos' end
           || case when r.urgente then ' · urgente' else '' end,
         null::numeric, r.created_at, r.solicitado_por, r.fecha_requerida, '/admin-tecnico'
    from requisiciones r
   where v_aprobar_pedidos and r.estado = 'pendiente' and r.proyecto_id = any(v_proys)

  -- ------------------------------------------------ Requisiciones por comprar
  union all
  select 'req_por_comprar', 'hacer', r.id, r.proyecto_id,
         'Requisición N° ' || r.numero,
         r.n_lineas || case when r.n_lineas = 1 then ' insumo' else ' insumos' end
           || case when r.urgente then ' · urgente' else '' end,
         null, r.created_at, r.solicitado_por, r.fecha_requerida, '/almacen/comprar-pedidos'
    from requisiciones r
   where v_comprar and r.estado = 'aprobada' and r.estado_compra = 'pendiente' and r.proyecto_id = any(v_proys)

  -- ------------------------------------------------ Insumos nuevos por aprobar
  -- Van por proyecto (20261118500000); sin presupuesto ligado, a todos.
  union all
  select 'insumo_por_aprobar', 'hacer', s.id, pr.proyecto_id,
         s.descripcion,
         concat_ws(' · ', nullif(s.u_m, ''), nullif(s.tipo, '')),
         s.vr_unitario_propuesto, s.created_at, s.solicitado_por, null::date, '/presupuestos/admin-insumos'
    from solicitudes_insumos s
    left join presupuesto_items pi on pi.id = s.presupuesto_item_id
    left join presupuestos pr on pr.id = pi.presupuesto_id
   where v_aprobar_insumos and s.estado = 'pendiente'
     and (pr.proyecto_id is null or pr.proyecto_id = any(v_proys))

  -- ------------------------------------------------ Mano de obra y equipos por aprobar
  union all
  select 'mo_por_aprobar', 'hacer', s.id, pr.proyecto_id,
         s.descripcion, 'Mano de obra' || coalesce(' · ' || nullif(s.grupo_sugerido, ''), ''),
         s.valor_propuesto, s.created_at, s.solicitado_por, null::date, '/presupuestos/admin-mo'
    from solicitudes_mano_obra s
    left join presupuesto_items pi on pi.id = s.presupuesto_item_id
    left join presupuestos pr on pr.id = pi.presupuesto_id
   where v_aprobar_mo and s.estado = 'pendiente'
     and (pr.proyecto_id is null or pr.proyecto_id = any(v_proys))
  union all
  select 'mo_por_aprobar', 'hacer', s.id, pr.proyecto_id,
         s.descripcion, 'Equipo' || coalesce(' · ' || nullif(s.grupo_sugerido, ''), ''),
         s.valor_propuesto, s.created_at, s.solicitado_por, null::date, '/presupuestos/admin-mo'
    from solicitudes_equipo s
    left join presupuesto_items pi on pi.id = s.presupuesto_item_id
    left join presupuestos pr on pr.id = pi.presupuesto_id
   where v_aprobar_mo and s.estado = 'pendiente'
     and (pr.proyecto_id is null or pr.proyecto_id = any(v_proys))

  -- ------------------------------------------------ OC por aprobar
  union all
  select 'oc_por_aprobar', 'hacer', o.id, o.proyecto_id,
         'OC N° ' || o.numero, coalesce(pv.nombre, 'Sin proveedor'),
         (select round(coalesce(sum(i.cantidad * i.precio_unitario * (1 - i.porcentaje_descuento / 100.0)
                                    * (1 + i.porcentaje_iva / 100.0)), 0), 2)
            from ordenes_compra_items i where i.orden_compra_id = o.id),
         o.created_at, o.created_by, o.fecha_entrega, '/almacen/aprobar-oc'
    from ordenes_compra o
    left join proveedores pv on pv.unique_id = o.proveedor_id
   where v_aprobar_oc and o.estado = 'pendiente_aprobacion' and o.proyecto_id = any(v_proys)

  -- ------------------------------------------------ OC por recibir en bodega
  union all
  select 'oc_por_recibir', 'hacer', o.id, o.proyecto_id,
         'OC N° ' || o.numero,
         coalesce(pv.nombre, 'Sin proveedor') || case when o.estado_entrega = 'entrega_parcial' then ' · entrega parcial' else '' end,
         null, coalesce(o.aprobada_at, o.created_at), o.created_by, o.fecha_entrega, '/almacen/entradas'
    from ordenes_compra o
    left join proveedores pv on pv.unique_id = o.proveedor_id
   where v_almacen and o.estado = 'aprobada' and o.estado_entrega <> 'entregada' and o.proyecto_id = any(v_proys)

  -- ------------------------------------------------ Pagos por aprobar (A&F: global)
  union all
  select 'pago_por_aprobar', 'hacer', g.id, g.proyecto_id,
         g.concepto, coalesce(t.razon_social, 'Sin tercero'),
         g.valor, coalesce(g.solicitado_en, g.creado_en), null::uuid, null::date, '/ayf/aprobacion-pagos'
    from pagos g
    left join terceros t on t.id = g.tercero_id
   where v_aprobar_pagos and g.estado = 'solicitado' and g.requisicion_admin_id is null

  -- ------------------------------------------------ Requisiciones administrativas por aprobar (A&F: global)
  union all
  select 'req_admin_por_aprobar', 'hacer', ra.id, null::uuid,
         'Requisición administrativa N° ' || ra.numero,
         concat_ws(' · ', pf.nombre, ra.n_items || ' ítem(s)', case when ra.metodo = 'pse' then 'PSE' end),
         ra.valor_total, ra.enviada_en, ra.creado_por, null::date, '/ayf/aprobacion-pagos'
    from requisiciones_admin ra
    left join perfiles pf on pf.id = ra.creado_por
   where v_aprobar_pagos and ra.estado = 'por_aprobar'

  -- ------------------------------------------------ Pagos aprobados sin tercero o cuenta
  -- Los de PSE (requisiciones administrativas) no tienen tercero ni cuenta en la app.
  union all
  select 'pago_sin_tercero', 'hacer', g.id, g.proyecto_id,
         g.concepto, case when g.tercero_id is null then 'Sin tercero' else 'Sin cuenta verificada' end,
         g.valor, coalesce(g.aprobado_en, g.creado_en), g.aprobado_por, null::date, '/ayf/consolidado'
    from pagos g
    left join requisiciones_admin ra on ra.id = g.requisicion_admin_id
   where v_gestionar_pagos and g.estado = 'aprobado' and (g.tercero_id is null or g.cuenta_tercero_id is null)
     and ra.metodo is distinct from 'pse'

  -- ------------------------------------------------ Cuentas de terceros por verificar
  union all
  select 'cuenta_por_verificar', 'hacer', c.id, null::uuid,
         t.razon_social, concat_ws(' · ', b.nombre, '•••• ' || right(c.numero_cuenta, 4)),
         null, c.creado_en, c.creado_por, null::date, '/ayf/terceros'
    from terceros_cuentas c
    join terceros t on t.id = c.tercero_id
    left join bancos b on b.id = c.banco_id
   where v_verificar and c.estado = 'PENDIENTE'

  -- ------------------------------------------------ Contratos por pre-aprobar (Jurídica)
  union all
  select 'contrato_por_preaprobar', 'hacer', c.id, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero), k.nombre,
         c.valor, coalesce(c.enviado_at, c.created_at), c.solicitado_por, null::date, '/contratos/pre-aprobacion'
    from contratos c
    join contratistas k on k.id = c.contratista_id
   where v_juridica and c.estado = 'pre_aprobacion' and c.proyecto_id = any(v_proys)

  -- ------------------------------------------------ Minutas por hacer o corregir (Jurídica)
  union all
  select 'minuta_por_elaborar', 'hacer', c.id, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero),
         k.nombre || case when c.minuta_estado = 'devuelta' then ' · devuelta por Subgerencia' else '' end,
         c.valor, coalesce(c.minuta_resuelta_at, c.resuelto_at, c.created_at), c.solicitado_por, null::date,
         '/contratos/pre-aprobacion'
    from contratos c
    join contratistas k on k.id = c.contratista_id
   where v_juridica and c.estado = 'aprobada' and (c.minuta_estado is null or c.minuta_estado = 'devuelta')
     and c.liquidado_at is null and c.proyecto_id = any(v_proys)

  -- ------------------------------------------------ Minutas por aprobar (Subgerencia)
  union all
  select 'minuta_por_aprobar', 'hacer', c.id, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero), k.nombre,
         c.valor, coalesce(c.minuta_enviada_at, c.created_at), c.minuta_enviada_por, null::date,
         '/contratos/aprobacion-minutas'
    from contratos c
    join contratistas k on k.id = c.contratista_id
   where v_subgerencia and c.minuta_estado = 'en_revision' and c.proyecto_id = any(v_proys)

  -- ------------------------------------------------ Otrosí por revisar (Jurídica) y por aprobar (Subgerencia)
  union all
  select case when o.estado = 'en_revision' then 'otrosi_por_aprobar' else 'otrosi_por_revisar' end, 'hacer',
         o.id, o.proyecto_id,
         'Otrosí al contrato ' || coalesce(c.numero_contrato, 'N° ' || c.numero),
         k.nombre || case when o.estado = 'devuelta_subgerencia' then ' · devuelto por Subgerencia' else '' end,
         o.nuevo_valor,
         case when o.estado = 'en_revision' then coalesce(o.enviada_subgerencia_at, o.enviado_at, o.created_at)
              else coalesce(o.resuelto_at, o.enviado_at, o.created_at) end,
         case when o.estado = 'en_revision' then o.enviada_subgerencia_por else o.solicitado_por end,
         null::date, '/contratos/aprobacion-otrosi'
    from otrosis o
    join contratos c on c.id = o.contrato_id
    join contratistas k on k.id = c.contratista_id
   where o.proyecto_id = any(v_proys)
     and ((v_juridica and o.estado in ('por_revisar', 'devuelta_subgerencia'))
          or (v_subgerencia and o.estado = 'en_revision'))

  -- ------------------------------------------------ Lo mío: solicitud de contrato devuelta
  union all
  select 'mi_contrato_devuelto', 'hacer', c.id, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero),
         k.nombre || coalesce(' · ' || nullif(c.motivo_resolucion, ''), ''),
         c.valor, coalesce(c.resuelto_at, c.created_at), c.resuelto_por, null::date,
         case when c.clase = 'general' then '/contratos/generales' else '/contratos/solicitar' end
    from contratos c
    join contratistas k on k.id = c.contratista_id
   where c.solicitado_por = p_uid and c.estado = 'devuelta'

  -- ------------------------------------------------ Lo mío: otrosí devuelto
  union all
  select 'mi_otrosi_devuelto', 'hacer', o.id, o.proyecto_id,
         'Otrosí al contrato ' || coalesce(c.numero_contrato, 'N° ' || c.numero),
         k.nombre || coalesce(' · ' || nullif(o.motivo, ''), ''),
         o.nuevo_valor, coalesce(o.resuelto_at, o.created_at), o.resuelto_por, null::date, '/contratos/otrosi'
    from otrosis o
    join contratos c on c.id = o.contrato_id
    join contratistas k on k.id = c.contratista_id
   where o.solicitado_por = p_uid and o.estado = 'devuelta'

  -- ------------------------------------------------ Lo mío: acta rechazada (se corrige y se envía otra vez)
  union all
  select 'mi_acta_rechazada', 'hacer', a.id, c.proyecto_id,
         'Acta ' || a.numero || ' · ' || coalesce(c.numero_contrato, 'N° ' || c.numero),
         k.nombre || coalesce(' · ' || nullif(a.motivo_resolucion, ''), ''),
         a.neto, coalesce(a.resuelto_at, a.created_at), a.resuelto_por, null::date, '/contratos/actas'
    from actas a
    join contratos c on c.id = a.contrato_id
    join contratistas k on k.id = c.contratista_id
   where a.creado_por = p_uid and a.estado = 'rechazada' and c.liquidado_at is null

  -- ------------------------------------------------ Lo mío: requisición administrativa rechazada
  union all
  select 'mi_req_admin_rechazada', 'hacer', ra.id, null::uuid,
         'Requisición administrativa N° ' || ra.numero,
         coalesce(nullif(ra.motivo_rechazo, ''), 'Rechazada por A&F'),
         ra.valor_total, ra.resuelta_en, ra.resuelta_por, null::date, '/ayf/requisiciones-administrativas?ver=' || ra.id
    from requisiciones_admin ra
   where ra.creado_por = p_uid and ra.estado = 'rechazada'

  -- ------------------------------------------------ Contratos vencidos sin liquidar
  -- A quien lo pidió y a Jurídica de sus proyectos.
  union all
  select 'contrato_vencido', 'hacer', c.id, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero), k.nombre || ' · falta el acta de liquidación',
         c.valor, public._fecha_fin_contrato(c.id)::timestamptz, c.solicitado_por, public._fecha_fin_contrato(c.id),
         '/contratos/actas'
    from contratos c
    join contratistas k on k.id = c.contratista_id
   where c.estado = 'aprobada' and c.minuta_estado = 'aprobada' and c.liquidado_at is null
     and (c.solicitado_por = p_uid or (v_juridica and c.proyecto_id = any(v_proys)))
     and public._fecha_fin_contrato(c.id) < v_hoy

  -- ------------------------------------------------ Seguimiento: mis requisiciones atrasadas
  -- Aprobadas, sin comprar del todo y con la fecha requerida ya pasada.
  union all
  select 'mi_req_atrasada', 'seguimiento', r.id, r.proyecto_id,
         'Requisición N° ' || r.numero, 'Aprobada, todavía sin comprar del todo',
         null, r.created_at, null::uuid, r.fecha_requerida, '/almacen/registro-requisiciones/' || r.id
    from requisiciones r
   where r.solicitado_por = p_uid and r.estado = 'aprobada' and r.estado_compra = 'pendiente'
     and r.fecha_requerida < v_hoy

  -- ------------------------------------------------ Mi firma sin registrar
  -- Se registra una vez y se pone sola en lo que la persona apruebe o elabore.
  -- La url '#mi-firma' abre el diálogo de Mi firma (no es una página).
  union all
  select 'mi_firma', 'hacer', p_uid, null::uuid,
         'Registra tu firma', 'Una sola vez: se pone sola en los documentos que apruebes o elabores',
         null, null::timestamptz, null::uuid, null::date, '#mi-firma'
   where v_firma_pendiente

  -- ------------------------------------------------ Lo mío: póliza por subir
  -- Contrato aprobado sin póliza (o con la póliza devuelta por Jurídica).
  union all
  select 'mi_poliza_por_subir', 'hacer', c.id, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero),
         k.nombre || coalesce(' · devuelta: ' || nullif(d.motivo, ''), ''),
         c.valor, coalesce(d.resuelta_at, c.minuta_resuelta_at, c.created_at), d.resuelta_por, null::date,
         '/contratos/polizas'
    from contratos c
    join contratistas k on k.id = c.contratista_id
    left join lateral (select o.motivo, o.resuelta_at, o.resuelta_por from contrato_polizas o
                        where o.contrato_id = c.id and o.estado = 'devuelta'
                        order by o.resuelta_at desc nulls last limit 1) d on true
   where c.solicitado_por = p_uid and c.poliza_estado = 'pendiente' and c.liquidado_at is null

  -- ------------------------------------------------ Pólizas por revisar (Jurídica)
  union all
  select 'poliza_por_revisar', 'hacer', o.id, c.proyecto_id,
         'Póliza del contrato ' || coalesce(c.numero_contrato, 'N° ' || c.numero), k.nombre,
         c.valor, o.created_at, o.subida_por, null::date, '/contratos/aprobacion-polizas'
    from contrato_polizas o
    join contratos c on c.id = o.contrato_id
    join contratistas k on k.id = c.contratista_id
   where v_revisar_polizas and o.estado = 'por_revisar' and c.proyecto_id = any(v_proys);
end;
$function$;

revoke all on function public._pendientes_de(uuid) from public, anon, authenticated;
