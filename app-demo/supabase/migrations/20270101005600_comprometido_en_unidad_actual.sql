-- Tope del presupuesto: lo ya pedido en la unidad ACTUAL de la línea del APU
-- (2026-11-23, encontrado en las pruebas de unidades).
--
-- Cada requisición guarda su cantidad en la unidad que tenía la línea del APU cuando se
-- pidió (pedidos_insumos.cantidad + factor_unidad). Si después el ingeniero cambia la
-- conversión de la línea (1 bulto = 50 kg), _comprometido_insumo_item seguía sumando las
-- cantidades viejas como si estuvieran en la unidad nueva: 2 bultos pedidos contaban como
-- 2 kg y el tope dejaba pedir de más. Ahora cada requisición se pasa por su unidad de
-- compra (cantidad / su factor) y se lleva a la unidad actual (× el factor de hoy). Si el
-- factor no cambió (todo lo que hay hoy) da exactamente lo mismo que antes.
--
-- Lo mismo en modificar_requisicion: lo que la misma requisición ya tenía (v_previa) se
-- devolvía al tope en su unidad vieja; ahora en la unidad actual de la línea.
--
-- Cambia _comprometido_insumo_item (misma firma) y un parche por texto exacto en
-- modificar_requisicion. Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $f$
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
$f$;

create or replace function public._comprometido_insumo_item(p_presupuesto_item_id uuid, p_insumo_id uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $function$
  with actual as (
    select public._factor_pedido(p_presupuesto_item_id, null, p_insumo_id) as f
  )
  select coalesce(sum(
    case
      when coalesce(p.factor_unidad, 1) = a.f then c.cantidad
      else c.cantidad / nullif(coalesce(p.factor_unidad, 1), 0) * a.f
    end
  ), 0)
  from presupuesto_items este
  cross join actual a
  join presupuesto_items mismo_item
    on mismo_item.presupuesto_id = este.presupuesto_id
   and mismo_item.codigo = este.codigo
  join pedidos_insumos p
    on p.presupuesto_item_id = mismo_item.id
   and p.insumo_id = p_insumo_id
   and p.estado in ('pendiente', 'aprobado')
  cross join lateral (
    select case
             when p.rechazado_compras_at is null then p.cantidad
             else least(p.cantidad, public._comprado_pedido(p.id))
           end as cantidad
  ) c
  where este.id = p_presupuesto_item_id
$function$;

select pg_temp._parche('public.modificar_requisicion(uuid, jsonb, date, boolean, text)'::regprocedure,
$a$    select coalesce(sum(p.cantidad), 0) into v_previa$a$,
$b$    -- En la unidad actual de la línea (la requisición pudo pedirse con otra conversión, 20270101005600).
    select coalesce(sum(
             case
               when coalesce(p.factor_unidad, 1) = public._factor_pedido(l.presupuesto_item_id, null, l.insumo_id) then p.cantidad
               else p.cantidad / nullif(coalesce(p.factor_unidad, 1), 0) * public._factor_pedido(l.presupuesto_item_id, null, l.insumo_id)
             end), 0) into v_previa$b$);

commit;
