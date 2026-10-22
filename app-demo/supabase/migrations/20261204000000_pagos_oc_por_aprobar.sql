-- ---------------------------------------------------------------------------
-- Órdenes de compra: Subgerencia aprueba la orden y el pago se aprueba en A&F
-- (decisión del usuario, 2026-10-22: "las órdenes de compra se aprueban
-- primero por subgerencia y luego de eso pasan a pagos y se aprueban ahí").
--
-- Antes, al aprobar la OC el pago único o el anticipo nacían 'aprobado' a
-- nombre de quien aprobó la orden (Líder de Compras) y A&F no los veía. Ahora
-- nacen 'solicitado' y salen en Aprobación de pagos, como el saldo. Lo demás
-- ya lo cubría el flujo del saldo: aprobar_pago da el ITEM, rechazar_pago +
-- resolicitar_pago, Mis pendientes (pago_por_aprobar) y devolver o cancelar la
-- OC anula también los solicitados (_oc_estado_pagos).
--
-- Los pagos ya creados no cambian. Permisos: Subgerencia recibe la pestaña y la
-- acción de aprobar órdenes de compra (sigue valiendo solo en sus proyectos);
-- a los demás roles no se les quita nada: eso se ajusta en Roles y permisos.
-- Se puede correr dos veces.
-- ---------------------------------------------------------------------------

create or replace function public._crear_pagos_orden(p_orden_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_oc        record;
  v_total     numeric;
  v_anticipo  numeric;
  v_tercero   uuid;
  v_cuenta    uuid;
  v_concepto  text;
  v_ids       uuid[];
  v_id        uuid;
begin
  select oc.id, oc.numero, oc.estado, oc.proyecto_id, oc.proveedor_id, oc.aprobada_por,
         oc.aprobada_at, oc.anticipo_porcentaje, oc.saldo_modo, oc.saldo_fecha,
         py.empresa_id, e.consolidado_id, pr.nombre as proveedor_nombre,
         pr.numero_documento::text as proveedor_documento
    into v_oc
    from public.ordenes_compra oc
    left join public.proyectos py on py.id = oc.proyecto_id
    left join public.empresas e on e.id = py.empresa_id
    left join public.proveedores pr on pr.unique_id = oc.proveedor_id
   where oc.id = p_orden_id;

  if not found or v_oc.estado <> 'aprobada' then
    return;
  end if;
  if exists (
    select 1 from public.pagos
     where orden_compra_id = p_orden_id and estado not in ('anulado','rechazado')
  ) then
    return;
  end if;

  v_total := round(public.total_orden_compra(p_orden_id), 0);
  if v_total <= 0 then
    return;  -- una orden en cero no genera pago
  end if;

  -- El tercero sale del documento del proveedor; la cuenta se elige sola solo
  -- si el tercero tiene exactamente UNA cuenta verificada.
  select t.id into v_tercero
    from public.terceros t
   where t.numero_documento = v_oc.proveedor_documento;
  if v_tercero is not null then
    select c.id into v_cuenta
      from public.terceros_cuentas c
     where c.tercero_id = v_tercero and c.estado = 'ACTIVO'
       and (select count(*) from public.terceros_cuentas x
             where x.tercero_id = v_tercero and x.estado = 'ACTIVO') = 1;
  end if;

  v_concepto := 'ORDEN DE COMPRA N° ' || v_oc.numero || ' - ' || coalesce(upper(v_oc.proveedor_nombre), '');

  v_anticipo := case when v_oc.anticipo_porcentaje is null then null
                     else round(v_total * v_oc.anticipo_porcentaje / 100.0, 0) end;

  -- El pago único y el anticipo nacen por aprobar (A&F los aprueba).
  if v_anticipo is null or v_anticipo <= 0 or v_anticipo >= v_total then
    -- sin anticipo (o uno que redondeado no tiene sentido): un solo pago
    insert into public.pagos (
      fuente, orden_compra_id, tipo, proyecto_id, empresa_id, consolidado_id, tercero_id,
      cuenta_tercero_id, concepto, valor, estado, solicitado_en
    ) values (
      'orden_compra', p_orden_id, 'unico', v_oc.proyecto_id, v_oc.empresa_id, v_oc.consolidado_id,
      v_tercero, v_cuenta, v_concepto, v_total, 'solicitado', coalesce(v_oc.aprobada_at, now())
    ) returning id into v_id;
    v_ids := array[v_id];
  else
    insert into public.pagos (
      fuente, orden_compra_id, tipo, proyecto_id, empresa_id, consolidado_id, tercero_id,
      cuenta_tercero_id, concepto, valor, estado, solicitado_en
    ) values (
      'orden_compra', p_orden_id, 'anticipo', v_oc.proyecto_id, v_oc.empresa_id, v_oc.consolidado_id,
      v_tercero, v_cuenta, v_concepto || ' - ANTICIPO', v_anticipo, 'solicitado',
      coalesce(v_oc.aprobada_at, now())
    ) returning id into v_id;
    v_ids := array[v_id];

    insert into public.pagos (
      fuente, orden_compra_id, tipo, proyecto_id, empresa_id, consolidado_id, tercero_id,
      cuenta_tercero_id, concepto, valor, estado, fecha_programada
    ) values (
      'orden_compra', p_orden_id, 'saldo', v_oc.proyecto_id, v_oc.empresa_id, v_oc.consolidado_id,
      v_tercero, v_cuenta, v_concepto || ' - SALDO', v_total - v_anticipo, 'programado',
      case when v_oc.saldo_modo = 'fecha' then v_oc.saldo_fecha end
    ) returning id into v_id;
    v_ids := v_ids || v_id;
  end if;

  foreach v_id in array v_ids loop
    perform public._pago_asignar_item(v_id);  -- no hace nada hasta que se apruebe
    perform public._pago_actualizar_novedad(v_id);
  end loop;
end;
$function$;

-- Subgerencia aprueba las órdenes de compra.
insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
  from public.roles r
 cross join (values ('tab.compras.aprobar_oc'), ('accion.aprobar_oc')) as p(permiso)
 where r.clave = 'subgerencia'
on conflict do nothing;
