-- Reversa de 20270101007000_drive_excel_requisiciones.sql: los anexos de
-- requisiciones vuelven a copiarse a Drive y se quitan el Excel semanal, su tarea y
-- su función. Lo que ya está en Drive se queda.

begin;
set local lock_timeout = '10s';

select cron.unschedule(jobid) from cron.job where jobname = 'informe-requisiciones-drive';

create or replace function public._drive_encolar_objeto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.name is not distinct from old.name and new.version is not distinct from old.version then
    return null;
  end if;
  if new.name like '%.emptyFolderPlaceholder' or coalesce(new.is_delete_marker, false) then
    return null;
  end if;
  begin
    insert into public.drive_cola (bucket, ruta) values (new.bucket_id, new.name)
    on conflict (bucket, ruta) do update
       set estado = 'pendiente', intentos = 0, siguiente_intento = now(), ultimo_error = null, creado_en = now()
     where public.drive_cola.estado <> 'subiendo';
  exception when others then
    null;
  end;
  return null;
end;
$$;

drop function if exists public.requisiciones_semana_drive(date);
drop table if exists public.drive_informes;

commit;
