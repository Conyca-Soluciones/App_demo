-- Aprobación de insumos: filtros por proyecto y por origen (decisión del
-- usuario, 2026-11-20).
--
-- Las solicitudes de insumo nuevo llegan del presupuesto (import, editor de
-- APU, ítem manual) o de una requisición administrativa. Las administrativas
-- no tienen ítem del presupuesto, así que no había cómo saber de qué proyecto
-- eran ni distinguirlas de una del presupuesto sin ítem.
-- - origen: 'presupuesto' (por omisión: el import y las funciones que crean
--   solicitudes en SQL no cambian) o 'requisicion_administrativa'.
-- - proyecto_id: el proyecto que se eligió en la requisición administrativa
--   (FUNCIONAMIENTO o uno con presupuesto). En las del presupuesto el proyecto
--   sale del ítem y esta columna queda vacía.
-- Las pendientes de hoy tienen todas ítem del presupuesto: no hay qué llenar.
--
-- Va ANTES del código (la pantalla lee las columnas). Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

alter table public.solicitudes_insumos
  add column if not exists origen text not null default 'presupuesto',
  add column if not exists proyecto_id uuid references public.proyectos(id) on delete set null;

alter table public.solicitudes_insumos drop constraint if exists solicitudes_insumos_origen_check;
alter table public.solicitudes_insumos
  add constraint solicitudes_insumos_origen_check check (origen in ('presupuesto', 'requisicion_administrativa'));

create index if not exists solicitudes_insumos_proyecto_id_idx on public.solicitudes_insumos (proyecto_id);

commit;
