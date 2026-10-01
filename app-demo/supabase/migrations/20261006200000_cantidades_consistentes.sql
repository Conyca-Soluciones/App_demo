-- Auditoría de cantidades (mismo tipo de error que 20261006100000: algo que ya
-- no debería contar seguía contando). Tres casos:
--
-- A. Requisición RECHAZADA POR COMPRAS seguía descontando del presupuesto.
--    rechazarPedidoCompras deja la requisición en estado 'aprobado' y marca
--    rechazado_compras_at; el tope del ítem (disponible_insumo_item /
--    buscar_insumos_presupuesto) contaba toda su cantidad aunque nunca se
--    fuera a comprar, así que el ingeniero no podía volver a pedirla. Caso
--    real: 72 puntillas rechazadas por Compras, sin comprar, bloqueadas.
--    Ahora de una requisición rechazada por Compras solo cuenta lo que ya
--    quedó en órdenes de compra vigentes (no canceladas ni rechazadas).
--
-- B. VERSIONES del presupuesto: crearNuevaVersion copia los ítems con ids
--    nuevos, y el tope solo miraba requisiciones del ítem EXACTO (por id). Al
--    crear una versión nueva, todo lo ya pedido sobre la versión anterior
--    dejaba de contar y se podía volver a pedir el presupuesto completo.
--    Ahora el tope suma las requisiciones del mismo ítem (mismo código, mismo
--    presupuesto) en cualquier versión.
--
-- C. SALIDAS ANULADAS seguían contando en el trigger
--    verificar_salida_no_supera_disponible: después de anular una salida, esa
--    cantidad no se podía volver a sacar aunque el inventario la mostrara
--    disponible.
--
-- Verificado antes de aplicar: con la regla nueva, de 31 combinaciones
-- ítem/insumo de los presupuestos vigentes, 30 dan exactamente lo mismo y
-- solo cambia la requisición rechazada por Compras (84 -> 12 comprometidas).

-- ---------------------------------------------------------------------------
-- Cantidad comprometida de un insumo en un ítem del presupuesto. ÚNICA
-- fuente de esta regla: la usan disponible_insumo_item (tope al crear o
-- modificar requisiciones) y buscar_insumos_presupuesto (diálogo de
-- requisición). SECURITY DEFINER: el tope es global, no debe depender de qué
-- requisiciones u órdenes deja ver RLS a quien pregunta.
-- ---------------------------------------------------------------------------
create or replace function public._comprometido_insumo_item(p_presupuesto_item_id uuid, p_insumo_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    case
      when p.rechazado_compras_at is null then p.cantidad
      -- Rechazada por Compras: solo lo que ya está en órdenes vigentes.
      else coalesce((
        select sum(oci.cantidad)
        from ordenes_compra_items oci
        join ordenes_compra oc on oc.id = oci.orden_compra_id
        where oci.pedido_insumo_id = p.id
          and oc.estado not in ('cancelada', 'rechazada')
      ), 0)
    end
  ), 0)
  from presupuesto_items este
  join presupuesto_items mismo_item
    on mismo_item.presupuesto_id = este.presupuesto_id
   and mismo_item.codigo = este.codigo          -- el mismo ítem en cualquier versión
  join pedidos_insumos p
    on p.presupuesto_item_id = mismo_item.id
   and p.insumo_id = p_insumo_id
   and p.estado in ('pendiente', 'aprobado')
  where este.id = p_presupuesto_item_id
$$;

revoke all on function public._comprometido_insumo_item(uuid, uuid) from public, anon;
grant execute on function public._comprometido_insumo_item(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A + B en el tope puntual (misma firma).
-- ---------------------------------------------------------------------------
create or replace function public.disponible_insumo_item(p_presupuesto_item_id uuid, p_insumo_id uuid)
returns numeric
language sql
stable
as $$
  select greatest(
    (ia.cantidad * coalesce(pi.cantidad, 0)) - public._comprometido_insumo_item(pi.id, p_insumo_id),
    0
  )
  from public.presupuesto_items pi
  join public.item_apu ia on ia.apu_id = pi.apu_id and ia.insumo_id = p_insumo_id
  where pi.id = p_presupuesto_item_id;
$$;

-- ---------------------------------------------------------------------------
-- A + B en la búsqueda del diálogo de requisición (misma firma y columnas).
-- ---------------------------------------------------------------------------
create or replace function public.buscar_insumos_presupuesto(
  p_version_id uuid,
  p_query text default null,
  p_limite integer default 50
)
returns table(
  presupuesto_item_id uuid, item_codigo text, item_descripcion text, item_apu_id uuid,
  insumo_id uuid, insumo_codigo integer, insumo_descripcion text, insumo_um text,
  cantidad_apu numeric, rendimiento numeric, cantidad_maxima numeric,
  cantidad_comprometida numeric, cantidad_disponible numeric
)
language sql
stable
as $$
  select
    pi.id,
    pi.codigo,
    pi.descripcion,
    ia.id,
    mi.id,
    mi.codigo,
    mi.descripcion,
    mi.u_m,
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
$$;

-- ---------------------------------------------------------------------------
-- C. Trigger de salidas: no contar salidas anuladas. Se cambia solo esa
-- condición sobre la definición actual; falla si no encuentra el texto.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.verificar_salida_no_supera_disponible()'::regprocedure);
  v_nueva text;
begin
  v_nueva := replace(v_def, 's.id <> new.id;', 's.id <> new.id and s.anulada_at is null;');
  if v_nueva = v_def then
    raise exception 'No se encontró la condición a cambiar en verificar_salida_no_supera_disponible';
  end if;
  execute v_nueva;
end;
$$;

-- ---------------------------------------------------------------------------
-- A también en la Visualización (resumen_ejecucion_proyecto): "cantidad
-- pedida" contaba completas las requisiciones rechazadas por Compras.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.resumen_ejecucion_proyecto(uuid)'::regprocedure);
  v_nueva text;
begin
  v_nueva := replace(v_def,
    'select pe.insumo_id, sum(pe.cantidad) as cantidad_pedida',
    'select pe.insumo_id, sum(case when pe.rechazado_compras_at is null then pe.cantidad else coalesce((select sum(oci2.cantidad) from ordenes_compra_items oci2 join ordenes_compra oc2 on oc2.id = oci2.orden_compra_id where oci2.pedido_insumo_id = pe.id and oc2.estado not in (''cancelada'', ''rechazada'')), 0) end) as cantidad_pedida');
  if v_nueva = v_def then
    raise exception 'No se encontró la condición a cambiar en resumen_ejecucion_proyecto';
  end if;
  execute v_nueva;
end;
$$;
