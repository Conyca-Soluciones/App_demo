-- Datos (2026-11-11): junta las solicitudes de insumo nuevo PENDIENTES que
-- quedaron repetidas (misma descripción y unidad), una por línea del import.
-- Pasaba al marcar "No existe — crear solicitud" y guardar línea por línea
-- (en el Malecón, 24 iguales para "Repisa ordinario 3 m"); el código ya
-- reutiliza la pendiente (solicitudInsumoParaLinea en presupuestos/actions.ts).
--
-- Queda la más antigua de cada grupo; las demás le pasan sus líneas de
-- apu_import_revision y se borran. Cada línea conserva SU cantidad: al
-- aprobar, el disparador crea una línea de APU por línea del import
-- (20261231999500). Solo se juntan las del import (con líneas): una hecha a
-- mano desde el editor de APU no tiene líneas, se aprueba por otro camino y
-- no se toca. Correrla dos veces no cambia nada.
-- Va DESPUÉS de 20261231999500.

create temp table _union_solicitudes as
with s as (
  select s.id, s.created_at,
         lower(regexp_replace(trim(s.descripcion), '\s+', ' ', 'g')) as d,
         upper(trim(coalesce(s.u_m, ''))) as u
  from public.solicitudes_insumos s
  where s.estado = 'pendiente'
    and exists (select 1 from public.apu_import_revision r where r.solicitud_id = s.id)
)
select id, first_value(id) over (partition by d, u order by created_at, id) as queda from s;

delete from _union_solicitudes where id = queda;

update public.apu_import_revision r
set solicitud_id = u.queda
from _union_solicitudes u
where r.solicitud_id = u.id;

delete from public.solicitudes_insumos s
using _union_solicitudes u
where s.id = u.id;

drop table _union_solicitudes;
