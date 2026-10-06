-- Saldos con fecha: pasan a solicitud solos, 3 días antes de la fecha.
--
-- Antes (20261017000000_ayf_pagos.sql) un saldo "en una fecha" pasaba de
-- programado a solicitado el MISMO día, y solo cuando alguien abría Aprobación
-- de pagos: si nadie la abría, el pago seguía programado aunque ya tocara.
-- Ahora una tarea de pg_cron lo hace cada hora, y con 3 días de anticipación
-- (decisión del usuario: que Financiera lo vea antes de que venza).
--
-- La pantalla sigue llamando liberar_pagos_programados al abrir (misma regla):
-- así se ve al día aunque la tarea todavía no haya corrido. Si no hay nada
-- por liberar, el UPDATE no escribe nada (usa idx_pagos_programados_fecha).
--
-- Los saldos "al ser entregado" no cambian: los libera _oc_entrega_pagos
-- cuando la orden queda entregada completa.
--
-- Si `create extension pg_cron` falla por permisos: Dashboard de Supabase ->
-- Database -> Extensions -> pg_cron -> Enable, y volver a correr este archivo.
-- Se puede correr más de una vez.

create extension if not exists pg_cron;

-- --------------------------------------------- regla (una sola, interna)
create or replace function public._liberar_pagos_programados()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n integer;
begin
  update public.pagos
     set estado = 'solicitado', solicitado_en = now()
   where estado = 'programado'
     and fecha_programada is not null
     and fecha_programada <= (now() at time zone 'America/Bogota')::date + 3;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Solo la tarea programada (corre como postgres) y el envoltorio de abajo.
revoke all on function public._liberar_pagos_programados() from public, anon, authenticated;

-- ------------------------------------- envoltorio de la pantalla (mismo nombre)
create or replace function public.liberar_pagos_programados()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.tiene_pestana(auth.uid(), 'ayf.aprobacion_pagos') then
    raise exception 'No tienes permiso para ver los pagos por aprobar.';
  end if;
  return public._liberar_pagos_programados();
end;
$$;

revoke all on function public.liberar_pagos_programados() from public, anon;
grant execute on function public.liberar_pagos_programados() to authenticated;

-- ------------------------------------------------------ tarea cada hora
-- Al minuto 5 de cada hora. Con el mismo nombre, cron.schedule reemplaza la
-- tarea en vez de duplicarla.
select cron.schedule(
  'liberar-pagos-programados',
  '5 * * * *',
  $$select public._liberar_pagos_programados()$$
);
