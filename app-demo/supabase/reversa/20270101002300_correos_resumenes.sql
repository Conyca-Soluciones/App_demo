-- Reversa de 20270101002300_correos_resumenes.sql: quita los resúmenes, los avisos
-- nuevos y el filtro de tipos (vuelven a salir por correo todos los avisos). Las
-- columnas ajustes_correo.tipos y perfiles.correo_resumen se dejan.

begin;

select cron.unschedule('resumen-diario-pagos') where exists (select 1 from cron.job where jobname = 'resumen-diario-pagos');
select cron.unschedule('resumen-semanal-pendientes') where exists (select 1 from cron.job where jobname = 'resumen-semanal-pendientes');
drop trigger if exists trg_avisar_requisiciones_compradas on public.ordenes_compra;
drop trigger if exists trg_avisar_oc_lider_compras on public.ordenes_compra;
drop function if exists public._avisar_requisiciones_compradas();
drop function if exists public._avisar_oc_lider_compras();
drop function if exists public.vista_previa_resumenes(text);
drop function if exists public._encolar_resumenes(text);
drop function if exists public._lineas_resumen(text, uuid);
drop function if exists public._titulo_pendiente(text);
drop function if exists public._fmt_pesos(numeric);
drop function if exists public.fijar_correo_resumen(uuid, boolean);
drop function if exists public.mis_correos();
-- Para que el disparador de correos deje de filtrar por tipo:
update public.ajustes_correo set tipos = '{}' where id;

commit;
