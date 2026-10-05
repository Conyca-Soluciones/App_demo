-- Unidades en requisiciones y compras (2026-10-05). Sigue a
-- 20261025000000_unidades_presentacion.sql.
--
-- La requisición se hace en la unidad del APU (120 m de tela, 85 kg de
-- cemento): ahí vive el tope del presupuesto. De la orden de compra en
-- adelante (proveedor, precio, entradas, inventario, salidas, pagos) todo va
-- en la unidad en que se compra (rollos, bultos), que es la u_m del insumo.
-- El puente es el factor de la línea del APU (1 rollo = 100 m), que cada
-- línea de requisición copia al crearse.
--
-- * pedidos_insumos.unidad / factor_unidad: se llenan solos al insertar
--   (trigger), desde la línea del APU.
-- * _comprado_pedido y _comprometido_insumo_item: lo comprado (en unidades de
--   compra) se pasa a la unidad de la requisición antes de compararlo.
-- * crear_orden_compra: la cantidad es en unidades de compra; se puede
--   comprar hasta las unidades completas que cubren lo pedido (120 m con
--   rollos de 100 m = hasta 2 rollos). Además vuelve a no contar las órdenes
--   RECHAZADAS como ya compradas (la versión con anticipo las contaba otra
--   vez, al contrario de 20261006100000_liberar_ordenes_rechazadas.sql).
-- * _resumen_ejecucion_proyecto_base: cantidades y valores en unidad de
--   compra (antes mezclaba kg del presupuesto con bultos comprados, y el
--   valor presupuestado de una línea en kg salía multiplicado por el contenido).
-- * buscar_insumos_presupuesto / insumos_presupuesto_por_ids: la unidad que
--   se muestra al hacer la requisición es la de la línea del APU.
--
-- Se puede correr dos veces.

alter table public.pedidos_insumos
  add column if not exists unidad text,
  add column if not exists factor_unidad numeric(14,4) not null default 1;

alter table public.pedidos_insumos drop constraint if exists pedidos_insumos_factor_unidad_check;
alter table public.pedidos_insumos add constraint pedidos_insumos_factor_unidad_check check (factor_unidad > 0);

create or replace function public._pedido_unidad_desde_apu()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_factor numeric;
  v_unidad text;
begin
  if new.item_apu_id is not null then
    select ia.factor_unidad, coalesce(ia.unidad, mi.u_m) into v_factor, v_unidad
      from item_apu ia join maestro_insumos mi on mi.id = ia.insumo_id
     where ia.id = new.item_apu_id;
  end if;
  if v_factor is null then
    select ia.factor_unidad, coalesce(ia.unidad, mi.u_m) into v_factor, v_unidad
      from presupuesto_items pi
      join item_apu ia on ia.apu_id = pi.apu_id and ia.insumo_id = new.insumo_id
      join maestro_insumos mi on mi.id = ia.insumo_id
     where pi.id = new.presupuesto_item_id
     order by ia.id
     limit 1;
  end if;
  new.factor_unidad := coalesce(v_factor, 1);
  new.unidad := coalesce(v_unidad, (select u_m from maestro_insumos where id = new.insumo_id));
  return new;
end;
$$;

revoke all on function public._pedido_unidad_desde_apu() from public, anon, authenticated;

drop trigger if exists trg_pedido_unidad_desde_apu on public.pedidos_insumos;
create trigger trg_pedido_unidad_desde_apu
  before insert on public.pedidos_insumos
  for each row execute function public._pedido_unidad_desde_apu();

-- Lo comprado de una línea de requisición, en la unidad de la requisición.
create or replace function public._comprado_pedido(p_pedido_id uuid)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(sum(oci.cantidad), 0)
         * coalesce((select factor_unidad from pedidos_insumos where id = p_pedido_id), 1)
  from ordenes_compra_items oci
  join ordenes_compra oc on oc.id = oci.orden_compra_id
  where oci.pedido_insumo_id = p_pedido_id
    and oc.estado not in ('cancelada', 'rechazada')
$function$;

create or replace function public._comprometido_insumo_item(p_presupuesto_item_id uuid, p_insumo_id uuid)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(sum(
    case
      when p.rechazado_compras_at is null then p.cantidad
      else coalesce((
        select sum(oci.cantidad)
        from ordenes_compra_items oci
        join ordenes_compra oc on oc.id = oci.orden_compra_id
        where oci.pedido_insumo_id = p.id
          and oc.estado not in ('cancelada', 'rechazada')
      ), 0) * p.factor_unidad
    end
  ), 0)
  from presupuesto_items este
  join presupuesto_items mismo_item
    on mismo_item.presupuesto_id = este.presupuesto_id
   and mismo_item.codigo = este.codigo
  join pedidos_insumos p
    on p.presupuesto_item_id = mismo_item.id
   and p.insumo_id = p_insumo_id
   and p.estado in ('pendiente', 'aprobado')
  where este.id = p_presupuesto_item_id
$function$;

-- Igual a la versión con anticipo (20261018000000_ayf_oc_pagos.sql); cambia
-- solo el tope de cantidad por línea.
create or replace function public.crear_orden_compra(
  p_proyecto_id uuid, p_proveedor_id uuid, p_sitio_entrega text, p_fecha_entrega date,
  p_contacto_nombre text, p_telefono text, p_ciudad text, p_email text, p_condiciones_pago text,
  p_observaciones text, p_lineas jsonb, p_anticipo_porcentaje numeric default null::numeric,
  p_saldo_modo text default null::text, p_saldo_fecha date default null::date
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
  v_maximo numeric;
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
    select id, cantidad, factor_unidad, proyecto_id, estado
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

    -- En unidades de compra. Las órdenes canceladas o rechazadas no cuentan.
    select coalesce(sum(oci.cantidad), 0) into v_ya_comprado
      from ordenes_compra_items oci
      join ordenes_compra oc on oc.id = oci.orden_compra_id
      where oci.pedido_insumo_id = v_pedido.id
        and oc.estado not in ('cancelada', 'rechazada');

    -- Unidades de compra completas que cubren lo pedido (120 m con rollos de
    -- 100 m -> 2). El margen evita que el ruido de los decimales sume una.
    v_maximo := ceil(v_pedido.cantidad / v_pedido.factor_unidad - 0.000001);

    v_cantidad_solicitada := (v_linea->>'cantidad_comprar')::numeric;

    if v_cantidad_solicitada <= 0
       or v_ya_comprado + v_cantidad_solicitada > v_maximo then
      raise exception 'Cantidad inválida para el pedido % (se pueden comprar: %, ya comprada: %, intentas: %).',
        v_linea->>'pedido_id', v_maximo, v_ya_comprado, v_cantidad_solicitada;
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

-- Todo en unidad de compra (la u_m del insumo, que es la que muestra).
create or replace function public._resumen_ejecucion_proyecto_base(p_proyecto_id uuid)
returns table(insumo_id uuid, insumo_codigo integer, insumo_descripcion text, insumo_um text, cantidad_presupuestada numeric, valor_presupuestado numeric, cantidad_pedida numeric, cantidad_comprada numeric, valor_comprado numeric, cantidad_salida numeric, valor_salida numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  with presupuesto_del_proyecto as (
    select p.version_actual_id
    from presupuestos p
    where p.proyecto_id = p_proyecto_id
    order by p.created_at desc
    limit 1
  ),
  presupuestado as (
    select
      ia.insumo_id,
      sum(pi.cantidad * ia.cantidad / ia.factor_unidad) as cantidad_presupuestada,
      sum(pi.cantidad * ia.cantidad / ia.factor_unidad * coalesce(mi.vr_neto, mi.vr_unitario, 0)) as valor_presupuestado
    from presupuesto_items pi
    join presupuesto_del_proyecto pp on pi.version_id = pp.version_actual_id
    join item_apu ia on ia.apu_id = pi.apu_id
    join maestro_insumos mi on mi.id = ia.insumo_id
    where pi.apu_id is not null and ia.insumo_id is not null
    group by ia.insumo_id
  ),
  pedido as (
    select pe.insumo_id, sum(case when pe.rechazado_compras_at is null then pe.cantidad / pe.factor_unidad else coalesce((select sum(oci2.cantidad) from ordenes_compra_items oci2 join ordenes_compra oc2 on oc2.id = oci2.orden_compra_id where oci2.pedido_insumo_id = pe.id and oc2.estado not in ('cancelada', 'rechazada')), 0) end) as cantidad_pedida
    from pedidos_insumos pe
    where pe.proyecto_id = p_proyecto_id and pe.estado = 'aprobado'
    group by pe.insumo_id
  ),
  comprado as (
    select
      pe.insumo_id,
      sum(oci.cantidad) as cantidad_comprada,
      sum(oci.cantidad * oci.precio_unitario * (1 - oci.porcentaje_descuento / 100.0) * (1 + oci.porcentaje_iva / 100.0)) as valor_comprado
    from ordenes_compra_items oci
    join ordenes_compra oc on oc.id = oci.orden_compra_id
    join pedidos_insumos pe on pe.id = oci.pedido_insumo_id
    where oc.proyecto_id = p_proyecto_id and oc.estado = 'aprobada'
    group by pe.insumo_id
  ),
  salida as (
    select s.insumo_id, sum(s.cantidad) as cantidad_salida
    from salidas_insumos s
    where s.proyecto_id = p_proyecto_id and s.anulada_at is null
    group by s.insumo_id
  ),
  todos_los_insumos as (
    select insumo_id from presupuestado
    union select insumo_id from pedido
    union select insumo_id from comprado
    union select insumo_id from salida
  )
  select
    t.insumo_id, mi.codigo as insumo_codigo, mi.descripcion as insumo_descripcion, mi.u_m as insumo_um,
    coalesce(presupuestado.cantidad_presupuestada, 0) as cantidad_presupuestada,
    coalesce(presupuestado.valor_presupuestado, 0) as valor_presupuestado,
    coalesce(pedido.cantidad_pedida, 0) as cantidad_pedida,
    coalesce(comprado.cantidad_comprada, 0) as cantidad_comprada,
    coalesce(comprado.valor_comprado, 0) as valor_comprado,
    coalesce(salida.cantidad_salida, 0) as cantidad_salida,
    coalesce(salida.cantidad_salida, 0)
      * coalesce(presupuestado.valor_presupuestado / nullif(presupuestado.cantidad_presupuestada, 0), 0) as valor_salida
  from todos_los_insumos t
  join maestro_insumos mi on mi.id = t.insumo_id
  left join presupuestado on presupuestado.insumo_id = t.insumo_id
  left join pedido on pedido.insumo_id = t.insumo_id
  left join comprado on comprado.insumo_id = t.insumo_id
  left join salida on salida.insumo_id = t.insumo_id
  order by mi.codigo;
$function$;

-- La unidad que ve el ingeniero al pedir es la de la línea del APU.
create or replace function public.buscar_insumos_presupuesto(p_version_id uuid, p_query text default null::text, p_limite integer default 50)
returns table(presupuesto_item_id uuid, item_codigo text, item_descripcion text, item_apu_id uuid, insumo_id uuid, insumo_codigo integer, insumo_descripcion text, insumo_um text, cantidad_apu numeric, rendimiento numeric, cantidad_maxima numeric, cantidad_comprometida numeric, cantidad_disponible numeric)
language sql
stable
set search_path to 'public'
as $function$
  select
    pi.id,
    pi.codigo,
    pi.descripcion,
    ia.id,
    mi.id,
    mi.codigo,
    mi.descripcion,
    coalesce(ia.unidad, mi.u_m),
    ia.cantidad,
    ia.rendimiento,
    (ia.cantidad * coalesce(pi.cantidad, 0)),
    c.total,
    greatest((ia.cantidad * coalesce(pi.cantidad, 0)) - c.total, 0)
  from public.presupuesto_items pi
  join public.item_apu ia        on ia.apu_id = pi.apu_id
  join public.maestro_insumos mi on mi.id = ia.insumo_id
  cross join lateral (select public._comprometido_insumo_item(pi.id, mi.id) as total) c
  where pi.version_id = p_version_id
    and pi.apu_id is not null
    and (
      p_query is null
      or p_query = ''
      or mi.descripcion ilike '%' || p_query || '%'
      or mi.codigo::text ilike '%' || p_query || '%'
      or pi.codigo ilike '%' || p_query || '%'
    )
  order by mi.descripcion, pi.codigo
  limit p_limite;
$function$;

create or replace function public.insumos_presupuesto_por_ids(p_version_id uuid, p_insumo_ids uuid[])
returns table(presupuesto_item_id uuid, item_codigo text, item_descripcion text, item_apu_id uuid, insumo_id uuid, insumo_codigo integer, insumo_descripcion text, insumo_um text, cantidad_apu numeric, rendimiento numeric, cantidad_maxima numeric, cantidad_comprometida numeric, cantidad_disponible numeric)
language sql
stable
set search_path to 'public'
as $function$
  select
    pi.id,
    pi.codigo,
    pi.descripcion,
    ia.id,
    mi.id,
    mi.codigo,
    mi.descripcion,
    coalesce(ia.unidad, mi.u_m),
    ia.cantidad,
    ia.rendimiento,
    (ia.cantidad * coalesce(pi.cantidad, 0)),
    c.total,
    greatest((ia.cantidad * coalesce(pi.cantidad, 0)) - c.total, 0)
  from public.presupuesto_items pi
  join public.item_apu ia        on ia.apu_id = pi.apu_id
  join public.maestro_insumos mi on mi.id = ia.insumo_id
  cross join lateral (select public._comprometido_insumo_item(pi.id, mi.id) as total) c
  where pi.version_id = p_version_id
    and pi.apu_id is not null
    and ia.insumo_id = any (p_insumo_ids)
  order by mi.descripcion, pi.codigo;
$function$;
