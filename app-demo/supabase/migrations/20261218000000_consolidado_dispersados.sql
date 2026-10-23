-- Conteo de las pestañas del Consolidado (decisiones del usuario, 2026-10-23):
--  * pestaña "Dispersados": los pagos que ya salieron en un dispersor, con el
--    soporte individual del dispersor al lado del soporte del pago (la lista
--    ya filtra estado = 'dispersado'). Va después de 20261217000000.
--  * filtro por SEMANA DE CREACIÓN del pago (creado_en), aparte de la de
--    aprobación (anio / semana = la del ITEM, que se da al aprobar): rangos
--    [desde, hasta) lunes a lunes en hora de Colombia, que arma la app.
-- Se quita la versión de 3 parámetros: la nueva los acepta igual (los rangos
-- tienen valor por omisión), así no quedan dos funciones con el mismo nombre.

drop function if exists public.conteo_etapas_consolidado(uuid, integer[], integer[]);

create or replace function public.conteo_etapas_consolidado(
  p_consolidado_id uuid,
  p_anios integer[],
  p_semanas integer[],
  p_creado_desde timestamptz[] default '{}',
  p_creado_hasta timestamptz[] default '{}'
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'preparacion', count(*) filter (where liquidacion_estado is null and estado = 'aprobado'),
    'por_liquidar', count(*) filter (where liquidacion_estado = 'por_liquidar' and estado = 'aprobado'),
    'observado', count(*) filter (where liquidacion_estado = 'observado' and estado = 'aprobado'),
    'liquidado', count(*) filter (where liquidacion_estado = 'liquidado' and estado = 'aprobado'),
    'dispersado', count(*) filter (where estado = 'dispersado'),
    'todos', count(*))
    from public.pagos g
   where g.consolidado_id = p_consolidado_id and g.item is not null
     and (coalesce(array_length(p_anios, 1), 0) = 0 or g.anio = any (p_anios))
     and (coalesce(array_length(p_semanas, 1), 0) = 0 or g.semana = any (p_semanas))
     and (coalesce(array_length(p_creado_desde, 1), 0) = 0
          or exists (select 1 from unnest(p_creado_desde, p_creado_hasta) r(desde, hasta)
                      where g.creado_en >= r.desde and g.creado_en < r.hasta))
$$;

revoke all on function public.conteo_etapas_consolidado(uuid, integer[], integer[], timestamptz[], timestamptz[]) from public, anon;
grant execute on function public.conteo_etapas_consolidado(uuid, integer[], integer[], timestamptz[], timestamptz[]) to authenticated;

-- Filtrar por semana de creación por consolidado.
create index if not exists idx_pagos_consolidado_creado on public.pagos(consolidado_id, creado_en) where item is not null;
