-- Saldo con fecha que ya está a 3 días o menos: nace como solicitado.
--
-- 20261102000000_pagos_programados_cron.sql pasa a solicitado los saldos con
-- fecha a 3 días o menos, cada hora (pg_cron) y al abrir Aprobación de pagos.
-- Pero un saldo que NACE dentro de esos 3 días (OC aprobada hoy con saldo para
-- pasado mañana) quedaba "programado" hasta la siguiente corrida, hasta una
-- hora, aunque Generar OC avisa que llega "apenas se apruebe la orden". Este
-- disparador aplica la misma regla al crear el pago. No toca _crear_pagos_orden.
--
-- Se puede correr más de una vez.

create or replace function public._pago_programado_vencido()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.estado = 'programado'
     and new.fecha_programada is not null
     and new.fecha_programada <= (now() at time zone 'America/Bogota')::date + 3 then
    new.estado := 'solicitado';
    new.solicitado_en := coalesce(new.solicitado_en, now());
  end if;
  return new;
end;
$$;

revoke all on function public._pago_programado_vencido() from public, anon, authenticated;

drop trigger if exists trg_pago_programado_vencido on public.pagos;
create trigger trg_pago_programado_vencido
  before insert on public.pagos
  for each row execute function public._pago_programado_vencido();
