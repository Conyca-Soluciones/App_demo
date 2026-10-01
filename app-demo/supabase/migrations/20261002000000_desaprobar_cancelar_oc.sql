-- DESAPROBAR y CANCELAR órdenes de compra.
--
--  Desaprobar: una orden APROBADA vuelve a "pendiente de aprobación".
--              Solo si NO fue marcada como enviada y NO tiene material recibido.
--  Cancelar  : una orden APROBADA pasa a "cancelada". Solo si NO tiene material
--              recibido (sin_entregar): Entrega parcial y Entregada no se
--              pueden cancelar. Puede estar enviada (justamente para eso sirve:
--              se avisa al proveedor). Sus líneas dejan de contar como
--              "ya comprado", así que los pedidos vuelven a "Comprar pedidos".
--
-- Ambas exigen motivo y validan el permiso en la base (acciones
-- desaprobar_oc / cancelar_oc del rol).

-- --------------------------------------------------------------- columnas
alter table public.ordenes_compra
  add column if not exists desaprobada_at timestamptz,
  add column if not exists desaprobada_por uuid references public.perfiles(id),
  add column if not exists motivo_desaprobacion text,
  add column if not exists cancelada_at timestamptz,
  add column if not exists cancelada_por uuid references public.perfiles(id),
  add column if not exists motivo_cancelacion text;

-- 'cancelada' como estado válido (idempotente: el nombre del check no está en
-- el repo, así que se busca por su definición).
do $$
declare
  v_nombre text;
begin
  for v_nombre in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.ordenes_compra'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%pendiente_aprobacion%'
  loop
    execute format('alter table public.ordenes_compra drop constraint %I', v_nombre);
  end loop;

  alter table public.ordenes_compra
    add constraint ordenes_compra_estado_check
    check (estado in ('pendiente_aprobacion', 'aprobada', 'rechazada', 'cancelada'));
end $$;

-- Antes: enviada exigía estado = 'aprobada'. Una orden enviada que luego se
-- cancela debe CONSERVAR el dato de que ya se había enviado al proveedor.
alter table public.ordenes_compra
  drop constraint if exists ordenes_compra_enviada_requiere_aprobada;
alter table public.ordenes_compra
  add constraint ordenes_compra_enviada_requiere_aprobada
  check (not enviada or estado in ('aprobada', 'cancelada'));

-- --------------------------------------------------------------- funciones
create or replace function public.desaprobar_orden_compra(p_orden_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o record;
begin
  if not public.tiene_accion(auth.uid(), 'desaprobar_oc') then
    raise exception 'No autorizado -- no tienes permiso para desaprobar órdenes de compra.';
  end if;
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo es obligatorio.';
  end if;

  select estado, enviada, estado_entrega into v_o
    from ordenes_compra where id = p_orden_id for update;

  if not found then
    raise exception 'La orden no existe.';
  end if;
  if v_o.estado <> 'aprobada' then
    raise exception 'Solo se puede desaprobar una orden aprobada.';
  end if;
  if v_o.enviada then
    raise exception 'La orden ya fue marcada como enviada al proveedor: no se puede desaprobar. Si ya no se necesita, cancélala.';
  end if;
  if v_o.estado_entrega <> 'sin_entregar' then
    raise exception 'La orden ya tiene material recibido: no se puede desaprobar.';
  end if;

  update ordenes_compra
     set estado = 'pendiente_aprobacion',
         aprobada_por = null,
         aprobada_at = null,
         desaprobada_por = auth.uid(),
         desaprobada_at = now(),
         motivo_desaprobacion = trim(p_motivo)
   where id = p_orden_id;
end;
$$;

create or replace function public.cancelar_orden_compra(p_orden_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o record;
begin
  if not public.tiene_accion(auth.uid(), 'cancelar_oc') then
    raise exception 'No autorizado -- no tienes permiso para cancelar órdenes de compra.';
  end if;
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo de cancelación es obligatorio.';
  end if;

  select estado, estado_entrega into v_o
    from ordenes_compra where id = p_orden_id for update;

  if not found then
    raise exception 'La orden no existe.';
  end if;
  if v_o.estado <> 'aprobada' then
    raise exception 'Solo se puede cancelar una orden aprobada.';
  end if;
  if v_o.estado_entrega <> 'sin_entregar' then
    raise exception 'No se puede cancelar: la orden ya tiene material recibido (entrega parcial o entregada).';
  end if;
  -- Refuerzo: aunque estado_entrega diga sin_entregar, ninguna entrada vigente.
  if exists (
    select 1
    from entradas_almacen e
    where e.orden_compra_id = p_orden_id and e.anulada_at is null
  ) then
    raise exception 'No se puede cancelar: la orden tiene entradas de almacén registradas. Anúlalas primero.';
  end if;

  update ordenes_compra
     set estado = 'cancelada',
         cancelada_por = auth.uid(),
         cancelada_at = now(),
         motivo_cancelacion = trim(p_motivo)
   where id = p_orden_id;
end;
$$;

revoke all on function public.desaprobar_orden_compra(uuid, text) from public;
revoke all on function public.cancelar_orden_compra(uuid, text) from public;
grant execute on function public.desaprobar_orden_compra(uuid, text) to authenticated;
grant execute on function public.cancelar_orden_compra(uuid, text) to authenticated;

-- crear_orden_compra: igual que antes, salvo que las líneas de órdenes
-- CANCELADAS ya no cuentan como "ya comprado" -- así los pedidos de una orden
-- cancelada se pueden volver a comprar. (Las de órdenes rechazadas siguen
-- contando: se decidió dejarlas para revisión manual.)
create or replace function public.crear_orden_compra(
  p_proyecto_id uuid, p_proveedor_id uuid, p_sitio_entrega text, p_fecha_entrega date,
  p_contacto_nombre text, p_telefono text, p_ciudad text, p_email text,
  p_condiciones_pago text, p_observaciones text, p_lineas jsonb
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
begin
  if not rol_compras(auth.uid()) then
    raise exception 'No autorizado.';
  end if;

  if jsonb_array_length(p_lineas) = 0 then
    raise exception 'La orden de compra necesita al menos un insumo.';
  end if;

  insert into ordenes_compra (
    proyecto_id, proveedor_id, sitio_entrega, fecha_entrega,
    contacto_nombre, telefono, ciudad, email, condiciones_pago, observaciones, created_by
  ) values (
    p_proyecto_id, p_proveedor_id, p_sitio_entrega, p_fecha_entrega,
    p_contacto_nombre, p_telefono, p_ciudad, p_email, p_condiciones_pago, p_observaciones, auth.uid()
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
