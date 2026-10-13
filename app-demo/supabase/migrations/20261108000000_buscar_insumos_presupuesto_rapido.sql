-- Búsqueda de insumos para una requisición: el cupo una vez por fila.
--
-- buscar_insumos_presupuesto usaba el cupo comprometido en dos columnas
-- (cantidad_comprometida y cantidad_disponible) y Postgres copiaba la llamada
-- a _comprometido_insumo_item en las dos: dos consultas aparte por cada fila
-- mostrada (~1,4 ms cada una en producción). Con 50 filas, 100 llamadas.
--
-- Ahora: filtra, ordena y corta en p_limite primero, y calcula el cupo una
-- sola vez por fila (offset 0 en el lateral). Mismas columnas, mismo orden,
-- misma regla de cupo (_comprometido_insumo_item sigue siendo la única fuente).
-- Probado contra la versión anterior con 3.000 líneas y 20.000 pedidos: mismas
-- filas, la mitad de llamadas. Se puede correr más de una vez.

create or replace function public.buscar_insumos_presupuesto(
  p_version_id uuid,
  p_query text default null::text,
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
set search_path to 'public'
as $function$
  select
    b.pi_id,
    b.pi_codigo,
    b.pi_descripcion,
    b.ia_id,
    b.mi_id,
    b.mi_codigo,
    b.mi_descripcion,
    b.um,
    b.cantidad_apu,
    b.rendimiento,
    b.cantidad_maxima,
    c.total,
    greatest(b.cantidad_maxima - c.total, 0)
  from (
    select
      pi.id as pi_id,
      pi.codigo as pi_codigo,
      pi.descripcion as pi_descripcion,
      ia.id as ia_id,
      mi.id as mi_id,
      mi.codigo as mi_codigo,
      mi.descripcion as mi_descripcion,
      coalesce(ia.unidad, mi.u_m) as um,
      ia.cantidad as cantidad_apu,
      ia.rendimiento,
      (ia.cantidad * coalesce(pi.cantidad, 0)) as cantidad_maxima
    from public.presupuesto_items pi
    join public.item_apu ia        on ia.apu_id = pi.apu_id
    join public.maestro_insumos mi on mi.id = ia.insumo_id
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
    limit p_limite
  ) b
  cross join lateral (
    -- offset 0: que Postgres no copie la llamada en las dos columnas que la usan
    select public._comprometido_insumo_item(b.pi_id, b.mi_id) as total offset 0
  ) c
  order by b.mi_descripcion, b.pi_codigo;
$function$;
