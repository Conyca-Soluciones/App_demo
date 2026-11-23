-- Reversa de 20270101005600: _comprometido_insumo_item como estaba antes.
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

-- modificar_requisicion: v_previa como antes (el parche al revés).
create or replace function pg_temp._quitar(p_fn regprocedure)
returns void language plpgsql as $f$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
  i int := position('    -- En la unidad actual de la línea (la requisición pudo pedirse con otra conversión, 20270101005600).' in d);
  j int;
begin
  if i = 0 then return; end if;
  j := position(' into v_previa' in substr(d, i)) + i - 1;
  execute left(d, i - 1) || '    select coalesce(sum(p.cantidad), 0)' || substr(d, j);
end;
$f$;
select pg_temp._quitar('public.modificar_requisicion(uuid, jsonb, date, boolean, text)'::regprocedure);

commit;
