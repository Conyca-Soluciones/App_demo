-- Reversa de 20270101006800_copia_drive.sql: quita la tarea, el disparador, las
-- funciones y las tablas de la copia a Drive. Lo que ya se subió a Drive se queda
-- allá (no se borra nada de Drive).

begin;
set local lock_timeout = '10s';

select cron.unschedule(jobid) from cron.job where jobname = 'subir-drive';
drop trigger if exists trg_drive_encolar on storage.objects;

drop function if exists public._drive_encolar_objeto();
drop function if exists public.tomar_drive(integer);
drop function if exists public.marcar_drive(uuid, text, text, text);
drop function if exists public.drive_encolar_existentes();
drop function if exists public._drive_destino(text, text);
drop function if exists public._drive_carpeta_contrato(uuid);
drop function if exists public._drive_resultado(uuid, text[], text);
drop function if exists public._drive_limpio(text);

drop table if exists public.drive_cola;
drop table if exists public.drive_carpetas;
drop table if exists public.ajustes_drive;

commit;
