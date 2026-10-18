-- Recuperar al maestro los insumos borrados el 2026-10-15 cuyo IVA es claro
-- (decisión del usuario, 2026-10-18).
--
-- 20261114200000_borrar_insumos_iva_dudoso.sql borró 911 insumos que no tenían
-- TODAS sus compras al 19 %. Entre ellos había insumos de uso diario con el
-- precio claro: el CEMENTO X 42.5 KG tenía 39 de 40 compras al 19 % y una al
-- 0 %, y esa sola compra lo sacó. Vuelven los que tienen al menos 3 compras y
-- el 80 % o más al 19 % (172), con:
--   * su mismo id y código (nada en la base los reusó; revisado antes),
--     descripción, tipo, unidad, agrupación y presentación de antes;
--   * IVA 19 % y vr_unitario = promedio SIN IVA (con descuento) de sus compras
--     al 19 % de los 12 meses anteriores a su última compra. vr_neto lo calcula
--     el disparador maestro_insumos_vr_neto;
--   * su historial de compras completo (también las compras al 0 %).
-- Los otros 739 siguen borrados (sin historial, todo al 0 %, pocas compras o
-- mezclas sin mayoría): si hacen falta entran por "Enviar a aprobación los
-- insumos sin sugerencias" y el Excel de precios de Compras.
-- Las líneas de APU y requisiciones que se borraron con ellos NO vuelven.
-- Se puede correr más de una vez (solo inserta lo que falte).

create table if not exists public._insumos_a_recuperar_20261018 (id uuid primary key, precio numeric not null);
alter table public._insumos_a_recuperar_20261018 enable row level security;
revoke all on public._insumos_a_recuperar_20261018 from anon, authenticated;

insert into public._insumos_a_recuperar_20261018 (id, precio)
with h as (
  select (datos->>'insumo_id')::uuid as insumo_id,
         (datos->>'precio_unitario')::numeric as p,
         coalesce((datos->>'iva_monto')::numeric, 0) as iva,
         coalesce((datos->>'porcentaje_descuento')::numeric, 0) as dto,
         (datos->>'fecha_compra')::date as f
  from public.respaldo_borrado_20261015
  where tabla = 'historico_precios_compra'
),
s as (
  select insumo_id,
         count(*) as n,
         count(*) filter (where p > 0 and abs(iva / p - 0.19) < 0.01) as c19,
         max(f) as ultima
  from h
  group by insumo_id
),
cand as (
  select r.id, s.ultima
  from public.respaldo_borrado_20261015 r
  join s on s.insumo_id = r.id
  where r.tabla = 'maestro_insumos'
    and s.n >= 3
    and s.c19::numeric / s.n >= 0.8
    and not exists (select 1 from public.maestro_insumos mi where mi.id = r.id)
    and not exists (select 1 from public.maestro_insumos mi where mi.codigo = (r.datos->>'codigo')::int)
)
select c.id,
       coalesce(
         round(avg(h.p * (1 - h.dto / 100)) filter (where abs(h.iva / h.p - 0.19) < 0.01 and h.f > c.ultima - interval '12 months'), 2),
         round(avg(h.p * (1 - h.dto / 100)) filter (where abs(h.iva / h.p - 0.19) < 0.01), 2)
       )
from cand c
join h on h.insumo_id = c.id and h.p > 0
group by c.id
having coalesce(
         avg(h.p) filter (where abs(h.iva / h.p - 0.19) < 0.01 and h.f > c.ultima - interval '12 months'),
         avg(h.p) filter (where abs(h.iva / h.p - 0.19) < 0.01)
       ) > 0
on conflict (id) do nothing;

-- El insumo, como estaba, con el precio y el IVA nuevos.
insert into public.maestro_insumos (
  id, codigo, descripcion, tipo, u_m, agrupacion, vr_unitario, iva_porcentaje,
  iva_descontable, excluye_iva, usuario_modificacion, fecha_modificacion,
  created_at, unidad_uso, contenido
)
select m.id, m.codigo, m.descripcion, m.tipo, m.u_m, m.agrupacion, a.precio, 19,
       m.iva_descontable, false, 'recuperado 2026-10-18',
       (now() at time zone 'America/Bogota')::date,
       m.created_at, m.unidad_uso, m.contenido
from public._insumos_a_recuperar_20261018 a
join public.respaldo_borrado_20261015 r on r.tabla = 'maestro_insumos' and r.id = a.id
cross join lateral jsonb_populate_record(null::public.maestro_insumos, r.datos) m
where not exists (select 1 from public.maestro_insumos mi where mi.id = a.id);

-- Su historial de compras.
insert into public.historico_precios_compra
select (jsonb_populate_record(null::public.historico_precios_compra, r.datos)).*
from public.respaldo_borrado_20261015 r
where r.tabla = 'historico_precios_compra'
  and (r.datos->>'insumo_id')::uuid in (select id from public._insumos_a_recuperar_20261018)
  and not exists (select 1 from public.historico_precios_compra h where h.id = r.id);

-- Revisar: deben salir 172 insumos y su historial; el cemento x 42.5 kg a
-- unos $21.000 sin IVA.
select (select count(*) from public.maestro_insumos where usuario_modificacion = 'recuperado 2026-10-18') as insumos_recuperados,
       (select count(*) from public.historico_precios_compra
         where insumo_id in (select id from public._insumos_a_recuperar_20261018)) as compras_recuperadas,
       (select count(*) from public.maestro_insumos) as maestro_total,
       (select string_agg(descripcion || ': ' || vr_unitario || ' + IVA = ' || vr_neto, ' | ')
          from public.maestro_insumos
         where usuario_modificacion = 'recuperado 2026-10-18' and descripcion ilike 'CEMENTO%') as cementos;
