-- A&F · Migración 3: órdenes de compra con anticipo -> pagos.
--
-- Aprobar una orden de compra ES aprobar su pago:
--   * Sin anticipo: se crea UN pago ('unico') por el total, ya aprobado, con
--     semana e ITEM del consolidado de la empresa del proyecto.
--   * Con anticipo: dos pagos. El 'anticipo' (porcentaje del total) queda
--     aprobado al aprobar la orden. El 'saldo' (el resto) queda 'programado' y
--     pasa a 'solicitado' (a aprobación de Gerencia) cuando:
--         - saldo_modo = 'entrega': la orden queda totalmente entregada, o
--         - saldo_modo = 'fecha':   llega saldo_fecha.
--     Los dos pagos hay que aprobarlos antes de pagarse.
--   * Si la orden se devuelve a pendiente o se cancela, sus pagos que todavía
--     no salieron se anulan; si alguno ya está en dispersión o pagado, se
--     bloquea (hay que resolver ese pago primero).
--
-- Solo las órdenes que se aprueben desde ahora generan pagos; las ya aprobadas
-- antes no (se pueden generar una a una con generar_pagos_orden).
--
-- Lo existente se toca lo mínimo: 3 columnas nuevas y opcionales en
-- ordenes_compra, crear_orden_compra con 3 parámetros nuevos (con valor por
-- defecto: las llamadas actuales siguen funcionando igual) y dos disparadores
-- AFTER que NUNCA hacen fallar la aprobación de la orden: si algo sale mal al
-- crear el pago solo avisan (WARNING).

-- --------------------------------------------------------- columnas nuevas
alter table public.ordenes_compra
  add column if not exists anticipo_porcentaje numeric(5,2),
  add column if not exists saldo_modo          text,
  add column if not exists saldo_fecha         date;

alter table public.ordenes_compra drop constraint if exists ordenes_compra_anticipo_check;
alter table public.ordenes_compra add constraint ordenes_compra_anticipo_check check (
  (anticipo_porcentaje is null or (anticipo_porcentaje > 0 and anticipo_porcentaje < 100))
  and (saldo_modo is null or saldo_modo in ('entrega','fecha'))
  and ((anticipo_porcentaje is null) = (saldo_modo is null))
  and ((saldo_modo is not distinct from 'fecha') = (saldo_fecha is not null))
);

-- ------------------------------------------------------------ total de la OC
-- Mismo cálculo que lib/ordenes-compra-calculos.ts (descuento, luego IVA).
create or replace function public.total_orden_compra(p_orden_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    i.cantidad * i.precio_unitario
    * (1 - i.porcentaje_descuento / 100.0)
    * (1 + i.porcentaje_iva / 100.0)
  ), 0)
  from public.ordenes_compra_items i
  where i.orden_compra_id = p_orden_id
$$;
revoke all on function public.total_orden_compra(uuid) from public, anon, authenticated;

-- ------------------------------------------------------- crear_orden_compra
-- Igual que antes, más el anticipo. Hay que BORRAR la firma anterior: dejar las
-- dos haría ambigua la llamada con 11 argumentos.
drop function if exists public.crear_orden_compra(
  uuid, uuid, text, date, text, text, text, text, text, text, jsonb
);

create or replace function public.crear_orden_compra(
  p_proyecto_id uuid, p_proveedor_id uuid, p_sitio_entrega text, p_fecha_entrega date,
  p_contacto_nombre text, p_telefono text, p_ciudad text, p_email text,
  p_condiciones_pago text, p_observaciones text, p_lineas jsonb,
  p_anticipo_porcentaje numeric default null,
  p_saldo_modo text default null,
  p_saldo_fecha date default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_orden_id uuid;
  v_linea jsonb;
  v_pedido record;
  v_ya_comprado numeric;
  v_cantidad_solicitada numeric;
  v_anticipo numeric(5,2) := nullif(p_anticipo_porcentaje, 0);
  v_modo text := null;
  v_fecha date := null;
begin
  if not rol_compras(auth.uid()) then
    raise exception 'No autorizado.';
  end if;

  if jsonb_array_length(p_lineas) = 0 then
    raise exception 'La orden de compra necesita al menos un insumo.';
  end if;

  -- Anticipo: porcentaje entre 0 y 100 (sin incluirlos) y cuándo se paga el saldo.
  if v_anticipo is not null then
    if v_anticipo <= 0 or v_anticipo >= 100 then
      raise exception 'El porcentaje del anticipo debe ser mayor que 0 y menor que 100.';
    end if;
    if p_saldo_modo is null or p_saldo_modo not in ('entrega','fecha') then
      raise exception 'Indica cuándo se paga el saldo: al ser entregado o en una fecha.';
    end if;
    v_modo := p_saldo_modo;
    if v_modo = 'fecha' then
      if p_saldo_fecha is null then
        raise exception 'Indica la fecha en que se paga el saldo.';
      end if;
      if p_saldo_fecha < (now() at time zone 'America/Bogota')::date then
        raise exception 'La fecha de pago del saldo no puede ser anterior a hoy.';
      end if;
      v_fecha := p_saldo_fecha;
    end if;
  end if;

  insert into ordenes_compra (
    proyecto_id, proveedor_id, sitio_entrega, fecha_entrega,
    contacto_nombre, telefono, ciudad, email, condiciones_pago, observaciones, created_by,
    anticipo_porcentaje, saldo_modo, saldo_fecha
  ) values (
    p_proyecto_id, p_proveedor_id, p_sitio_entrega, p_fecha_entrega,
    p_contacto_nombre, p_telefono, p_ciudad, p_email, p_condiciones_pago, p_observaciones, auth.uid(),
    v_anticipo, v_modo, v_fecha
  )
  returning id into v_orden_id;

  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    select id, cantidad, proyecto_id, estado
      into v_pedido
      from pedidos_insumos
      where id = (v_linea->>'pedido_id')::uuid
      for update;

    if v_pedido.id is null then
      raise exception 'Pedido % no existe.', v_linea->>'pedido_id';
    end if;

    if v_pedido.estado <> 'aprobado' then
      raise exception 'Pedido % ya no está aprobado.', v_linea->>'pedido_id';
    end if;

    if v_pedido.proyecto_id <> p_proyecto_id then
      raise exception 'Pedido % no pertenece al proyecto de esta orden.', v_linea->>'pedido_id';
    end if;

    select coalesce(sum(oci.cantidad), 0) into v_ya_comprado
      from ordenes_compra_items oci
      join ordenes_compra oc on oc.id = oci.orden_compra_id
      where oci.pedido_insumo_id = v_pedido.id
        and oc.estado <> 'cancelada';

    v_cantidad_solicitada := (v_linea->>'cantidad_comprar')::numeric;

    if v_cantidad_solicitada <= 0
       or v_ya_comprado + v_cantidad_solicitada > v_pedido.cantidad then
      raise exception 'Cantidad inválida para el pedido % (pedida: %, ya comprada: %, intentas: %).',
        v_linea->>'pedido_id', v_pedido.cantidad, v_ya_comprado, v_cantidad_solicitada;
    end if;

    insert into ordenes_compra_items (
      orden_compra_id, pedido_insumo_id, cantidad, precio_unitario, porcentaje_descuento, porcentaje_iva
    )
    values (
      v_orden_id, v_pedido.id, v_cantidad_solicitada,
      coalesce((v_linea->>'precio_unitario')::numeric, 0),
      coalesce((v_linea->>'porcentaje_descuento')::numeric, 0),
      coalesce((v_linea->>'porcentaje_iva')::numeric, 0)
    );
  end loop;

  return v_orden_id;
end;
$function$;

revoke all on function public.crear_orden_compra(
  uuid, uuid, text, date, text, text, text, text, text, text, jsonb, numeric, text, date
) from public, anon;
grant execute on function public.crear_orden_compra(
  uuid, uuid, text, date, text, text, text, text, text, text, jsonb, numeric, text, date
) to authenticated;

-- ------------------------------------------------------ crear los pagos
-- Idempotente: si la orden ya tiene pagos vivos no hace nada.
create or replace function public._crear_pagos_orden(p_orden_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  if v_anticipo is null or v_anticipo <= 0 or v_anticipo >= v_total then
    -- sin anticipo (o uno que redondeado no tiene sentido): un solo pago
    insert into public.pagos (
      fuente, orden_compra_id, tipo, proyecto_id, empresa_id, consolidado_id, tercero_id,
      cuenta_tercero_id, concepto, valor, estado, solicitado_en, aprobado_por, aprobado_en
    ) values (
      'orden_compra', p_orden_id, 'unico', v_oc.proyecto_id, v_oc.empresa_id, v_oc.consolidado_id,
      v_tercero, v_cuenta, v_concepto, v_total, 'aprobado',
      coalesce(v_oc.aprobada_at, now()), v_oc.aprobada_por, coalesce(v_oc.aprobada_at, now())
    ) returning id into v_id;
    v_ids := array[v_id];
  else
    insert into public.pagos (
      fuente, orden_compra_id, tipo, proyecto_id, empresa_id, consolidado_id, tercero_id,
      cuenta_tercero_id, concepto, valor, estado, solicitado_en, aprobado_por, aprobado_en
    ) values (
      'orden_compra', p_orden_id, 'anticipo', v_oc.proyecto_id, v_oc.empresa_id, v_oc.consolidado_id,
      v_tercero, v_cuenta, v_concepto || ' - ANTICIPO', v_anticipo, 'aprobado',
      coalesce(v_oc.aprobada_at, now()), v_oc.aprobada_por, coalesce(v_oc.aprobada_at, now())
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
    perform public._pago_asignar_item(v_id);
    perform public._pago_actualizar_novedad(v_id);
  end loop;
end;
$$;
revoke all on function public._crear_pagos_orden(uuid) from public, anon, authenticated;

-- Genera los pagos de una orden YA aprobada que no los tiene (por ejemplo una
-- aprobada antes de esta migración, o si algo falló al aprobarla).
create or replace function public.generar_pagos_orden(p_orden_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para gestionar pagos.';
  end if;
  if not exists (select 1 from public.ordenes_compra where id = p_orden_id and estado = 'aprobada') then
    raise exception 'La orden no existe o no está aprobada.';
  end if;
  perform public._crear_pagos_orden(p_orden_id);
end;
$$;
revoke all on function public.generar_pagos_orden(uuid) from public, anon;
grant execute on function public.generar_pagos_orden(uuid) to authenticated;

-- ------------------------------------------------------------ disparadores
-- Cambio de estado de la orden.
create or replace function public._oc_estado_pagos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'aprobada' then
    -- Nunca debe impedir que la orden se apruebe.
    begin
      perform public._crear_pagos_orden(new.id);
    exception when others then
      raise warning 'No se pudieron crear los pagos de la orden %: %', new.id, sqlerrm;
    end;

  elsif old.estado = 'aprobada' and new.estado in ('pendiente_aprobacion', 'cancelada') then
    if exists (
      select 1 from public.pagos
       where orden_compra_id = new.id and estado in ('en_dispersion', 'dispersado')
    ) then
      raise exception
        'No se puede devolver ni cancelar la orden: ya tiene un pago en dispersión o pagado. Resuélvelo primero con Financiera.';
    end if;

    update public.pagos
       set estado = 'anulado', anulado_en = now(),
           motivo_anulacion = case when new.estado = 'cancelada'
             then 'La orden de compra fue cancelada.' else 'La orden de compra fue devuelta a pendiente.' end
     where orden_compra_id = new.id
       and estado in ('programado', 'solicitado', 'aprobado', 'liquidado');
  end if;
  return null;
end;
$$;
revoke all on function public._oc_estado_pagos() from public, anon, authenticated;

drop trigger if exists trg_oc_estado_pagos on public.ordenes_compra;
create trigger trg_oc_estado_pagos
  after update of estado on public.ordenes_compra
  for each row when (old.estado is distinct from new.estado)
  execute function public._oc_estado_pagos();

-- Saldo "al ser entregado": se solicita cuando la orden queda entregada por
-- completo, y vuelve a programado si una entrada se anula y deja de estarlo.
create or replace function public._oc_entrega_pagos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.saldo_modo is distinct from 'entrega' then
    return null;
  end if;

  begin
    if new.estado_entrega = 'entregada' then
      update public.pagos
         set estado = 'solicitado', solicitado_en = now()
       where orden_compra_id = new.id and tipo = 'saldo' and estado = 'programado';
    elsif old.estado_entrega = 'entregada' then
      update public.pagos
         set estado = 'programado', solicitado_en = null
       where orden_compra_id = new.id and tipo = 'saldo' and estado = 'solicitado';
    end if;
  exception when others then
    raise warning 'No se pudo actualizar el saldo de la orden %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public._oc_entrega_pagos() from public, anon, authenticated;

drop trigger if exists trg_oc_entrega_pagos on public.ordenes_compra;
create trigger trg_oc_entrega_pagos
  after update of estado_entrega on public.ordenes_compra
  for each row when (old.estado_entrega is distinct from new.estado_entrega)
  execute function public._oc_entrega_pagos();
