-- Pestaña Pagos › Informes (ayf.informes, 2026-11-25, decisión del usuario) para Contabilidad y
-- Contabilidad Barranquilla. El primer informe es Dispersores generados (solo el soporte PDF).
-- No cambia permisos de tablas: un dispersor y su soporte ya se leen si tienen algún pago que la
-- persona ve (dispersiones_select y dispersores_archivos_select), y Contabilidad ve los pagos de
-- sus consolidados. Otros roles se le dan desde Admin › Roles.
-- Solo agrega filas en rol_permisos. Reversa en supabase/reversa/.

insert into public.rol_permisos (rol_id, permiso)
select r.id, 'tab.ayf.informes'
  from public.roles r
 where r.clave in ('contabilidad_bogota', 'contabilidad_barranquilla')
   and not exists (select 1 from public.rol_permisos rp where rp.rol_id = r.id and rp.permiso = 'tab.ayf.informes');
