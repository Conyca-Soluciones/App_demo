-- Reversa de 20270101002100_correos.sql: deja de encolar y de enviar. Las
-- tablas (cola y ajustes) y la columna perfiles.correo_avisos se dejan.

begin;

select cron.unschedule('enviar-correos') where exists (select 1 from cron.job where jobname = 'enviar-correos');
drop trigger if exists trg_correo_notificacion on public.notificaciones;
drop function if exists public._encolar_correo_notificacion();
drop function if exists public.tomar_correos(integer);
drop function if exists public.marcar_correo(uuid, boolean, text);
drop function if exists public.encolar_correo_prueba(text);

commit;
