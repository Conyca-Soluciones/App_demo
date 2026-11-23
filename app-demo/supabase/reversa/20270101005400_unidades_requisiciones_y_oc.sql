-- Reversa de 20270101005400: deshace los parches (texto nuevo -> texto de antes) y borra
-- las funciones nuevas. Las requisiciones ya creadas no cambian.

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

select pg_temp._parche('public.crear_requisicion(jsonb, date, boolean, text, text)'::regprocedure,
$a$    -- En unidades de compra del insumo (las de la maestra), enteras (20270101005400).
    if l.cantidad is null or l.cantidad <= 0
       or not public._cantidad_compra_entera(l.cantidad, public._factor_pedido(l.presupuesto_item_id, l.item_apu_id, l.insumo_id)) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero, en la unidad de compra del insumo.';
    end if;
    if public._conversion_pendiente(l.presupuesto_item_id, l.item_apu_id, l.insumo_id) then
      raise exception 'Falta la conversión de unidad de "%" en el presupuesto: escríbela en el APU del ítem antes de pedirlo.',
        (select descripcion from public.maestro_insumos where id = l.insumo_id);
    end if;$a$,
$b$    if l.cantidad is null or l.cantidad <= 0 or l.cantidad <> trunc(l.cantidad) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero.';
    end if;$b$);

select pg_temp._parche('public.modificar_requisicion(uuid, jsonb, date, boolean, text)'::regprocedure,
$a$    -- En unidades de compra del insumo (las de la maestra), enteras (20270101005400).
    if l.cantidad is null or l.cantidad <= 0
       or not public._cantidad_compra_entera(l.cantidad, public._factor_pedido(l.presupuesto_item_id, l.item_apu_id, l.insumo_id)) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero, en la unidad de compra del insumo.';
    end if;
    if public._conversion_pendiente(l.presupuesto_item_id, l.item_apu_id, l.insumo_id) then
      raise exception 'Falta la conversión de unidad de "%" en el presupuesto: escríbela en el APU del ítem antes de pedirlo.',
        (select descripcion from public.maestro_insumos where id = l.insumo_id);
    end if;$a$,
$b$    if l.cantidad is null or l.cantidad <= 0 or l.cantidad <> trunc(l.cantidad) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero.';
    end if;$b$);

select pg_temp._parche('public.crear_requisicion_extraordinaria(jsonb, date, boolean, text)'::regprocedure,
$a$    -- En unidades de compra del insumo (las de la maestra), enteras (20270101005400).
    if l.cantidad is null or l.cantidad <= 0
       or not public._cantidad_compra_entera(l.cantidad, public._factor_pedido(l.presupuesto_item_id, l.item_apu_id, l.insumo_id)) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero, en la unidad de compra del insumo.';
    end if;
    if public._conversion_pendiente(l.presupuesto_item_id, l.item_apu_id, l.insumo_id) then
      raise exception 'Falta la conversión de unidad de "%" en el presupuesto: escríbela en el APU del ítem antes de pedirlo.',
        (select descripcion from public.maestro_insumos where id = l.insumo_id);
    end if;$a$,
$b$    if l.cantidad is null or l.cantidad <= 0 or l.cantidad <> trunc(l.cantidad) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero.';
    end if;$b$);

select pg_temp._parche('public._insertar_lineas_orden(uuid, uuid, jsonb)'::regprocedure,
$a$    -- Siempre la conversión de la requisición (la del APU); Compras ya no la cambia (20270101005400).
    v_factor := v_pedido.factor_unidad;$a$,
$b$    v_factor := coalesce(nullif(v_linea->>'factor', '')::numeric, v_pedido.factor_unidad);$b$);

-- _pendientes_de: quitar el bloque de conversion_pendiente (el parche al revés no sirve:
-- el texto de antes sigue dentro de la versión nueva).
create or replace function pg_temp._quitar_bloque(p_fn regprocedure)
returns void language plpgsql as $f$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
  i int := position('  -- ------------------------------------------------ Conversión de unidad pendiente en el APU (20270101005400)' in d);
  j int := position('  -- ------------------------------------------------ Soportes de cuadros de SINCO (20270101002800)' in d);
begin
  if i = 0 then return; end if;
  execute left(d, i - 1) || substr(d, j);
end;
$f$;
select pg_temp._quitar_bloque('public._pendientes_de(uuid)'::regprocedure);

drop function if exists public._conversion_pendiente(uuid, uuid, uuid);
drop function if exists public._cantidad_compra_entera(numeric, numeric);
drop function if exists public._factor_pedido(uuid, uuid, uuid);
drop function if exists public._unidad_reconocida(text);
drop function if exists public._unidad_normal(text);
drop function if exists public._unidad_limpia(text);

commit;
