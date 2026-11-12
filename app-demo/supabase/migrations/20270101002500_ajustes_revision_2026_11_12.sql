-- Ajustes de la revisión del 2026-11-12 (decisión del usuario).
--
-- 1. Unidad de las solicitudes de mano de obra y equipo que creó la versión
--    anterior de la app mientras se publicaba la nueva (120 de Ricardo, 20:49
--    a 21:06 UTC, sin unidad): sin ella no se agrupan con las iguales.
-- 2. Juntar otra vez las pendientes iguales (misma actividad y unidad): sus
--    líneas pasan a la más vieja, cada una con su ítem y su cantidad. Misma
--    lógica que 20270101002400.
-- 3. search_path fijo en tres funciones pequeñas (aviso de seguridad de
--    Supabase): _clave_unidad, _clave_actividad y _fmt_pesos (correos).
--
-- Se puede correr más de una vez.

update public.solicitudes_mano_obra s
   set unidad = pi.unidad
  from public.presupuesto_items pi
 where pi.id = s.presupuesto_item_id and s.unidad is null;

update public.solicitudes_equipo s
   set unidad = (select r.unidad from public.apu_import_revision r
                  where r.solicitud_equipo_id = s.id and r.unidad is not null
                  order by r.created_at limit 1)
 where s.unidad is null;

update public.apu_import_revision r
   set solicitud_mano_obra_id = g.queda
  from (select id,
               first_value(id) over w as queda,
               row_number() over w as n
          from public.solicitudes_mano_obra
         where estado = 'pendiente'
        window w as (partition by public._clave_actividad(descripcion), public._clave_unidad(unidad) order by created_at, id)) g
 where r.solicitud_mano_obra_id = g.id and g.n > 1;

delete from public.solicitudes_mano_obra s
 using (select id,
               row_number() over (partition by public._clave_actividad(descripcion), public._clave_unidad(unidad) order by created_at, id) as n
          from public.solicitudes_mano_obra
         where estado = 'pendiente') g
 where s.id = g.id and g.n > 1
   and not exists (select 1 from public.apu_import_revision r where r.solicitud_mano_obra_id = s.id);

update public.apu_import_revision r
   set solicitud_equipo_id = g.queda
  from (select id,
               first_value(id) over w as queda,
               row_number() over w as n
          from public.solicitudes_equipo
         where estado = 'pendiente'
        window w as (partition by public._clave_actividad(descripcion), public._clave_unidad(unidad) order by created_at, id)) g
 where r.solicitud_equipo_id = g.id and g.n > 1;

delete from public.solicitudes_equipo s
 using (select id,
               row_number() over (partition by public._clave_actividad(descripcion), public._clave_unidad(unidad) order by created_at, id) as n
          from public.solicitudes_equipo
         where estado = 'pendiente') g
 where s.id = g.id and g.n > 1
   and not exists (select 1 from public.apu_import_revision r where r.solicitud_equipo_id = s.id);

alter function public._clave_unidad(text) set search_path = public;
alter function public._clave_actividad(text) set search_path = public;
alter function public._fmt_pesos(numeric) set search_path = public;
