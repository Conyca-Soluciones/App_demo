-- Unidades en requisiciones y compras (2026-11-23, decisiones del usuario).
--
-- 1. La requisición se pide en la UNIDAD DE COMPRA del insumo (la de la maestra: rollos,
--    no metros). La base sigue guardando la cantidad en la unidad del APU (metros) y el
--    TOPE DEL PRESUPUESTO NO CAMBIA: disponible_insumo_item se sigue revisando igual
--    (cantidad en metros <= disponible en metros). Lo nuevo es que la cantidad tiene que
--    ser un número ENTERO de unidades de compra (3 rollos = 300 m), no de metros. Con
--    conversión 1 (casi todos los insumos) es exactamente la regla de antes.
-- 2. Una línea del APU en otra unidad que la del insumo y sin conversión ("conversión de
--    unidad pendiente") no se puede pedir y sale en Mis pendientes de quien edita
--    presupuestos (tipo conversion_pendiente). El pendiente del import
--    (insumo_por_convertir) sigue igual.
-- 3. Generar OC: Compras ya no cambia la conversión; la orden usa siempre la de la
--    requisición (la del APU). Un rollo de 50 m y uno de 100 m son insumos distintos.
--    "UM disponible" (presentación) no cambia.
--
-- Parches por texto exacto sobre la versión viva (fallan si no encuentran el texto).

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

-- ------------------------------------------------------------ Unidades (igual que lib/unidades.ts)
-- Texto limpio: sin tildes, ² = 2, ³ = 3, mayúsculas, sin puntos, espacios, _ ni guiones.
create or replace function public._unidad_limpia(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
           upper(translate(coalesce(p, ''),
             'áéíóúàèìòùäëïöüâêîôûñÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÑ²³',
             'aeiouaeiouaeiouaeiounAEIOUAEIOUAEIOUAEIOUN23')),
           '[.\s_-]+', '', 'g')
$$;

-- Código común de una unidad ("UNIDAD - UND" -> UND, "m³" -> M3), o null. Mismo
-- algoritmo y mismos sinónimos que normalizarUnidad (lib/unidades.ts).
create or replace function public._unidad_normal(p text)
returns text
language plpgsql
immutable
set search_path = public
as $f$
declare
  v_sinonimos constant jsonb := '{"UND":"UND","UN":"UND","U":"UND","UNID":"UND","UNIDAD":"UND","UNIDADES":"UND","UNDS":"UND","UNDD":"UND","PZA":"UND","PIEZA":"UND","KG":"KG","KGS":"KG","KILO":"KG","KILOS":"KG","KILOGRAMO":"KG","KILOGRAMOS":"KG","G":"G","GR":"G","GRS":"G","GRAMO":"G","GRAMOS":"G","T":"TON","TON":"TON","TONELADA":"TON","TONELADAS":"TON","M":"M","ML":"M","MT":"M","MTS":"M","MTR":"M","MTRS":"M","METRO":"M","METROS":"M","METROLINEAL":"M","METROSLINEALES":"M","M2":"M2","MT2":"M2","METROCUADRADO":"M2","METROSCUADRADOS":"M2","M3":"M3","MT3":"M3","METROCUBICO":"M3","METROSCUBICOS":"M3","CM":"CM","CMS":"CM","CMT":"CM","CENTIMETRO":"CM","CENTIMETROS":"CM","MM":"MM","MILIMETRO":"MM","MILIMETROS":"MM","L":"L","LT":"L","LTS":"L","LTR":"L","LITRO":"L","LITROS":"L","CC":"CC","MLT":"CC","MILILITRO":"CC","MILILITROS":"CC","GAL":"GAL","GALON":"GAL","GALONES":"GAL","QT":"QT","CUARTO":"QT","CUARTODEGALON":"QT","LB":"LB","LBS":"LB","LIBRA":"LB","LIBRAS":"LB","ROLL":"ROLLO","ROLLO":"ROLLO","ROLLOS":"ROLLO","RLL":"ROLLO","BE":"BULTO","BULTO":"BULTO","BULTOS":"BULTO","BTO":"BULTO","BT":"BULTO","CNT":"CUNETE","CUNETE":"CUNETE","CUNETES":"CUNETE","DIA":"DIA","DIAS":"DIA","D":"DIA","HR":"HORA","HRS":"HORA","H":"HORA","HORA":"HORA","HORAS":"HORA","MES":"MES","MESES":"MES","MS":"MES","VJ":"VIAJE","VIAJE":"VIAJE","VIAJES":"VIAJE","KM":"KM","KILOMETRO":"KM","KILOMETROS":"KM","JGO":"JUEGO","JG":"JUEGO","JUEGO":"JUEGO","JUEGOS":"JUEGO","GL":"GLOBAL","GLB":"GLOBAL","GLOBAL":"GLOBAL","SM":"SEMANA","SEMANA":"SEMANA","SEMANAS":"SEMANA","PAR":"PAR","PARES":"PAR","%":"%","PORCENTAJE":"%"}';
  v_crudo text;
  v_partes text[];
  v_codigo text;
  v_unido text;
  i int;
begin
  if p is null then return null; end if;
  v_crudo := regexp_replace(btrim(p), '^[-\s]+|[-\s]+$', '', 'g');
  if v_crudo = '' or lower(v_crudo) = 'null' then return null; end if;
  select array_agg(btrim(t.x) order by t.n) into v_partes
    from unnest(regexp_split_to_array(v_crudo, '\s+-\s+')) with ordinality as t(x, n)
   where btrim(t.x) <> '' and lower(btrim(t.x)) <> 'null';
  if v_partes is not null then
    for i in reverse array_length(v_partes, 1)..1 loop
      v_codigo := v_sinonimos ->> public._unidad_limpia(v_partes[i]);
      if v_codigo is not null then return v_codigo; end if;
    end loop;
  end if;
  v_unido := public._unidad_limpia(v_crudo);
  if v_sinonimos ? v_unido then return v_sinonimos ->> v_unido; end if;
  if v_partes is not null then
    return nullif(public._unidad_limpia(v_partes[array_length(v_partes, 1)]), '');
  end if;
  return nullif(v_unido, '');
end;
$f$;

-- ¿Es una de las unidades conocidas (kg, m, rollo...) y no un texto suelto ("Ins", "caja")?
-- Igual que esUnidadReconocida (lib/unidades.ts).
create or replace function public._unidad_reconocida(p text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(public._unidad_normal(p) = any (array['%','BULTO','CC','CM','CUNETE','DIA','G','GAL','GLOBAL','HORA','JUEGO','KG','KM','L','LB','M','M2','M3','MES','MM','PAR','QT','ROLLO','SEMANA','TON','UND','VIAJE']::text[]), false)
$$;

-- ------------------------------------------------------------ Conversión de la línea del pedido
-- La misma búsqueda que el disparador _pedido_unidad_desde_apu: la línea del APU indicada,
-- o la primera línea del insumo en el APU del ítem. 1 si no hay.
create or replace function public._factor_pedido(p_item uuid, p_item_apu uuid, p_insumo uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select ia.factor_unidad from item_apu ia where ia.id = p_item_apu),
    (select ia.factor_unidad
       from presupuesto_items pi
       join item_apu ia on ia.apu_id = pi.apu_id and ia.insumo_id = p_insumo
      where pi.id = p_item
      order by ia.id
      limit 1),
    1)
$$;

-- ¿La cantidad (en la unidad del APU) es un número entero de unidades de compra?
create or replace function public._cantidad_compra_entera(p_cantidad numeric, p_factor numeric)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_cantidad is not null and coalesce(p_factor, 0) > 0
     and round(p_cantidad / p_factor, 6) = trunc(round(p_cantidad / p_factor, 6))
$$;

-- ¿La línea del APU está en otra unidad que el insumo y sin conversión?
create or replace function public._conversion_pendiente(p_item uuid, p_item_apu uuid, p_insumo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select ia.factor_unidad = 1
           and public._unidad_reconocida(ia.unidad)
           and public._unidad_normal(mi.u_m) is not null
           and public._unidad_normal(ia.unidad) <> public._unidad_normal(mi.u_m)
      from item_apu ia
      join maestro_insumos mi on mi.id = ia.insumo_id
     where ia.id = coalesce(p_item_apu, (
             select ia2.id from presupuesto_items pi
               join item_apu ia2 on ia2.apu_id = pi.apu_id and ia2.insumo_id = p_insumo
              where pi.id = p_item order by ia2.id limit 1))
  ), false)
$$;

revoke all on function public._unidad_limpia(text) from public;
revoke all on function public._unidad_normal(text) from public;
revoke all on function public._unidad_reconocida(text) from public;
revoke all on function public._factor_pedido(uuid, uuid, uuid) from public;
revoke all on function public._cantidad_compra_entera(numeric, numeric) from public;
revoke all on function public._conversion_pendiente(uuid, uuid, uuid) from public;

-- ------------------------------------------------------------ Requisiciones
select pg_temp._parche('public.crear_requisicion(jsonb, date, boolean, text, text)'::regprocedure,
$a$    if l.cantidad is null or l.cantidad <= 0 or l.cantidad <> trunc(l.cantidad) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero.';
    end if;$a$,
$b$    -- En unidades de compra del insumo (las de la maestra), enteras (20270101005400).
    if l.cantidad is null or l.cantidad <= 0
       or not public._cantidad_compra_entera(l.cantidad, public._factor_pedido(l.presupuesto_item_id, l.item_apu_id, l.insumo_id)) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero, en la unidad de compra del insumo.';
    end if;
    if public._conversion_pendiente(l.presupuesto_item_id, l.item_apu_id, l.insumo_id) then
      raise exception 'Falta la conversión de unidad de "%" en el presupuesto: escríbela en el APU del ítem antes de pedirlo.',
        (select descripcion from public.maestro_insumos where id = l.insumo_id);
    end if;$b$);

select pg_temp._parche('public.modificar_requisicion(uuid, jsonb, date, boolean, text)'::regprocedure,
$a$    if l.cantidad is null or l.cantidad <= 0 or l.cantidad <> trunc(l.cantidad) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero.';
    end if;$a$,
$b$    -- En unidades de compra del insumo (las de la maestra), enteras (20270101005400).
    if l.cantidad is null or l.cantidad <= 0
       or not public._cantidad_compra_entera(l.cantidad, public._factor_pedido(l.presupuesto_item_id, l.item_apu_id, l.insumo_id)) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero, en la unidad de compra del insumo.';
    end if;
    if public._conversion_pendiente(l.presupuesto_item_id, l.item_apu_id, l.insumo_id) then
      raise exception 'Falta la conversión de unidad de "%" en el presupuesto: escríbela en el APU del ítem antes de pedirlo.',
        (select descripcion from public.maestro_insumos where id = l.insumo_id);
    end if;$b$);

select pg_temp._parche('public.crear_requisicion_extraordinaria(jsonb, date, boolean, text)'::regprocedure,
$a$    if l.cantidad is null or l.cantidad <= 0 or l.cantidad <> trunc(l.cantidad) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero.';
    end if;$a$,
$b$    -- En unidades de compra del insumo (las de la maestra), enteras (20270101005400).
    if l.cantidad is null or l.cantidad <= 0
       or not public._cantidad_compra_entera(l.cantidad, public._factor_pedido(l.presupuesto_item_id, l.item_apu_id, l.insumo_id)) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero, en la unidad de compra del insumo.';
    end if;
    if public._conversion_pendiente(l.presupuesto_item_id, l.item_apu_id, l.insumo_id) then
      raise exception 'Falta la conversión de unidad de "%" en el presupuesto: escríbela en el APU del ítem antes de pedirlo.',
        (select descripcion from public.maestro_insumos where id = l.insumo_id);
    end if;$b$);

-- ------------------------------------------------------------ Generar OC: la conversión es la del pedido
select pg_temp._parche('public._insertar_lineas_orden(uuid, uuid, jsonb)'::regprocedure,
$a$    v_factor := coalesce(nullif(v_linea->>'factor', '')::numeric, v_pedido.factor_unidad);$a$,
$b$    -- Siempre la conversión de la requisición (la del APU); Compras ya no la cambia (20270101005400).
    v_factor := v_pedido.factor_unidad;$b$);

-- ------------------------------------------------------------ Mis pendientes
select pg_temp._parche('public._pendientes_de(uuid)'::regprocedure,
$a$  -- ------------------------------------------------ Soportes de cuadros de SINCO (20270101002800)$a$,
$b$  -- ------------------------------------------------ Conversión de unidad pendiente en el APU (20270101005400)
  union all
  select 'conversion_pendiente', 'hacer', (array_agg(ia.id order by ia.id))[1], pr.proyecto_id,
         m.descripcion,
         'Va en ' || lower(min(ia.unidad)) || ' y se compra por ' || lower(split_part(coalesce(m.u_m, 'unidad'), ' - ', 1))
           || ' · ' || count(*) || case when count(*) = 1 then ' línea' else ' líneas' end,
         null::numeric, m.created_at, null::uuid, null::date, '/presupuestos?conversion=1'
    from item_apu ia
    join maestro_insumos m on m.id = ia.insumo_id
    join presupuesto_items pi on pi.apu_id = ia.apu_id
    join presupuestos pr on pr.id = pi.presupuesto_id and pr.version_actual_id = pi.version_id
   where ia.factor_unidad = 1 and ia.unidad is not null and m.u_m is not null
     and upper(btrim(ia.unidad)) <> upper(btrim(m.u_m))
     and public._unidad_reconocida(ia.unidad)
     and public._unidad_normal(m.u_m) is not null
     and public._unidad_normal(ia.unidad) <> public._unidad_normal(m.u_m)
     and (select public.tiene_accion(p_uid, 'editar_presupuestos'))
     and pr.proyecto_id in (select public.proyectos_editables(p_uid))
   group by pr.proyecto_id, m.id, m.descripcion, m.u_m, m.created_at

  -- ------------------------------------------------ Soportes de cuadros de SINCO (20270101002800)$b$);

commit;
