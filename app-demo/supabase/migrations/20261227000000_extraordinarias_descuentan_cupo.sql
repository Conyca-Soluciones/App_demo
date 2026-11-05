-- Las requisiciones extraordinarias SÍ descuentan del cupo del presupuesto
-- (decisión del usuario, 2026-11-05: si se usan por error cuando todavía había
-- cupo, el cupo debe bajar). La primera versión aplicada de
-- 20261226000000_requisiciones_extraordinarias.sql las excluía de
-- `_comprometido_insumo_item`; esto la deja como estaba antes (cuenta toda
-- requisición pendiente o aprobada). Se puede correr más de una vez.

create or replace function public._comprometido_insumo_item(p_presupuesto_item_id uuid, p_insumo_id uuid)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $function$
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
$function$;
