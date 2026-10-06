-- Compras de más: el cupo del presupuesto y la clasificación del costo.
--
-- Reglas (Luis, 2026-10-06):
--   1. Lo que se compra de más que la requisición NO se descuenta del
--      presupuesto disponible: del cupo solo cuenta lo que pidió la requisición.
--      (Antes: greatest(pedido, comprado) -> 1 bulto de 50 kg para 20 kg pedidos
--      gastaba 50 kg de cupo; ahora gasta 20.)
--   2. El costo de una compra se clasifica en tres categorías, para la futura
--      pestaña de control y supervisión de proyecto:
--        COMPRAS        lo que se pagó en la orden de compra (todo: 6 cajas).
--        REQUISICIONES  el costo de lo que SÍ salió en la requisición (10 m², no 11).
--        EXCEDENTES DE COMPRAS  = Compras - Requisiciones (el 1 m² de sobra).
--
-- Cómo se reparte una compra entre requisiciones y excedente: las líneas de
-- orden de un mismo pedido (requisición) se recorren por fecha de creación y
-- cada una cubre lo que le falte al pedido; lo que pase de ahí es excedente.
-- Se calcula en el momento (no se guarda): si una orden se cancela o rechaza,
-- las demás se reacomodan solas. Costo = total de la línea (con descuento e IVA),
-- repartido en proporción a la cantidad. Pago, OC e inventario NO cambian: al
-- proveedor se le paga todo.

-- ---------------------------------------------------------------- 1. cupo
-- Misma función que la versión vigente (única fuente de la regla del tope); solo
-- cambia el caso de la requisición NO rechazada por Compras: cuenta lo pedido,
-- aunque se haya comprado más. Si Compras la rechazó, cuenta lo ya comprado pero
-- sin pasar de lo pedido.
create or replace function public._comprometido_insumo_item(p_presupuesto_item_id uuid, p_insumo_id uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(sum(
    case
      when p.rechazado_compras_at is null then p.cantidad
      else least(p.cantidad, public._comprado_pedido(p.id))
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
$$;

-- --------------------------------------------------- 2. costos por línea
-- Una fila por línea de orden de compra vigente (no cancelada ni rechazada) con
-- sus tres costos. Se filtra por `estado_orden` ('aprobada' para lo ya pagado) y
-- se agrupa por proyecto, orden, insumo o requisición según lo que se necesite.
-- security_invoker: cada usuario ve solo lo que sus permisos le dejan ver de las
-- órdenes.
create or replace view public.v_ordenes_compra_items_costos
with (security_invoker = true) as
with lineas as (
  select
    oci.id                                   as item_id,
    oci.orden_compra_id,
    oci.pedido_insumo_id,
    oc.proyecto_id,
    oc.estado                                as estado_orden,
    oc.created_at                            as orden_creada,
    -- lo comprado, en la unidad de la requisición (lo que mide el pedido)
    oci.cantidad * oci.factor_unidad         as cantidad_comprada_req,
    pi.cantidad                              as cantidad_pedida_req,
    oci.cantidad * oci.precio_unitario
      * (1 - oci.porcentaje_descuento / 100.0)
      * (1 + oci.porcentaje_iva / 100.0)     as costo_compra
  from public.ordenes_compra_items oci
  join public.ordenes_compra oc on oc.id = oci.orden_compra_id
  join public.pedidos_insumos pi on pi.id = oci.pedido_insumo_id
  where oc.estado not in ('cancelada', 'rechazada')
), acumulado as (
  select
    l.*,
    -- lo que ya cubrieron las líneas anteriores del mismo pedido
    coalesce(sum(l.cantidad_comprada_req) over (
      partition by l.pedido_insumo_id
      order by l.orden_creada, l.item_id
      rows between unbounded preceding and 1 preceding
    ), 0) as cubierto_antes
  from lineas l
), repartido as (
  select
    a.*,
    greatest(least(a.cantidad_comprada_req, a.cantidad_pedida_req - a.cubierto_antes), 0) as cantidad_requisicion
  from acumulado a
)
select
  r.item_id,
  r.orden_compra_id,
  r.pedido_insumo_id,
  r.proyecto_id,
  r.estado_orden,
  r.cantidad_comprada_req,
  r.cantidad_requisicion,
  r.cantidad_comprada_req - r.cantidad_requisicion as cantidad_excedente,
  r.costo_compra                                              as costo_compras,
  case when r.cantidad_comprada_req > 0
       then r.costo_compra * r.cantidad_requisicion / r.cantidad_comprada_req
       else 0 end                                             as costo_requisiciones,
  r.costo_compra
    - case when r.cantidad_comprada_req > 0
           then r.costo_compra * r.cantidad_requisicion / r.cantidad_comprada_req
           else 0 end                                         as costo_excedentes_compras
from repartido r;

grant select on public.v_ordenes_compra_items_costos to authenticated;
