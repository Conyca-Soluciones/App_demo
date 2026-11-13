-- Se quitan los dos correos de resumen (decisión del usuario, 2026-11-13): por correo
-- solo salen los avisos puntuales (ajustes_correo.tipos). Se desprograman las tareas
-- 'resumen-diario-pagos' (12:00 lunes a viernes) y 'resumen-semanal-pendientes'
-- (lunes 8:00) de 20270101002300 y se borran las funciones que las armaban.
-- perfiles.correo_resumen se deja (sin uso). Los avisos puntuales no cambian.

begin;

select cron.unschedule('resumen-diario-pagos') where exists (select 1 from cron.job where jobname = 'resumen-diario-pagos');
select cron.unschedule('resumen-semanal-pendientes') where exists (select 1 from cron.job where jobname = 'resumen-semanal-pendientes');

-- Los que ya estaban en cola y no han salido.
delete from public.correos_salientes
 where notificacion_id is null and estado = 'pendiente'
   and asunto in ('CONYCA 360 · Tus pagos de hoy', 'CONYCA 360 · Tus pendientes de la semana');

drop function if exists public.vista_previa_resumenes(text);
drop function if exists public._encolar_resumenes(text);
drop function if exists public._lineas_resumen(text, uuid);
drop function if exists public.fijar_correo_resumen(uuid, boolean);

commit;
