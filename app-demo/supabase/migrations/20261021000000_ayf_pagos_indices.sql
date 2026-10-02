-- A&F · Migración 7: índices de los listados de pagos.
--
-- Consolidado de pagos: ordena por año ↓, semana ↓, consolidado, ITEM. Con un
-- consolidado elegido ya lo resuelve pagos_item_unico; este cubre "Todos". El
-- NULLS LAST de los dos primeros campos es el que manda la aplicación (si no
-- coincidiera, la base no usaría el índice para ordenar).
create index if not exists idx_pagos_semana_item
  on public.pagos (anio desc nulls last, semana desc nulls last, consolidado_id, item, id)
  where item is not null;

-- Aprobación de pagos: filtra por estado y ordena por solicitado_en. Cubre
-- todos los estados (el anterior solo servía para "Por aprobar").
drop index if exists public.idx_pagos_solicitados;
create index if not exists idx_pagos_estado_solicitado
  on public.pagos (estado, solicitado_en, id);
