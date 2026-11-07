-- Carga de insumos nuevos por Excel (decisión del usuario, 2026-10-15).
--
-- "Revisar pendientes" exporta las líneas de insumo del import que no tienen
-- ninguna opción en el maestro; se completan (tipo, unidad, agrupación, IVA,
-- precio) y se suben en Aprobación de insumos: se crean en el maestro y se
-- asignan solas a las líneas pendientes con el mismo texto del Excel.
--
-- lineas_revision_pendientes_por_texto(textos): líneas de insumo pendientes
-- cuyo texto (sin mayúsculas ni espacios de más) es uno de los dados. Va por
-- RPC para mandar los textos en el cuerpo (hay de más de 300 caracteres; en un
-- .in() de la URL no caben). SECURITY INVOKER: ve lo mismo que la tabla.
-- Se puede correr más de una vez.

drop function if exists public.lineas_revision_pendientes_por_texto(text[]);
create or replace function public.lineas_revision_pendientes_por_texto(p_textos text[])
returns jsonb
language sql
stable
set search_path = public
as $$
  -- Un solo jsonb (no filas): la API corta en 1.000 filas y un presupuesto
  -- grande tiene más líneas pendientes.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'texto', lower(btrim(regexp_replace(r.descripcion_original, '\s+', ' ', 'g'))),
           'unidad', r.unidad,
           'presupuesto_item_id', r.presupuesto_item_id)), '[]'::jsonb)
  from apu_import_revision r
  where r.estado = 'pendiente'
    and r.tipo = 'INSUMO'
    and lower(btrim(regexp_replace(r.descripcion_original, '\s+', ' ', 'g'))) = any (
      select lower(btrim(regexp_replace(t, '\s+', ' ', 'g'))) from unnest(p_textos) t
    );
$$;
revoke all on function public.lineas_revision_pendientes_por_texto(text[]) from public, anon;
grant execute on function public.lineas_revision_pendientes_por_texto(text[]) to authenticated;
