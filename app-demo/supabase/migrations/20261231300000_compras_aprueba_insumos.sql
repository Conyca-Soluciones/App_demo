-- Aprobación de insumos nuevos: la hace Compras, no el Líder Técnico
-- (decisión del usuario, 2026-11-05). Compras y Líder Compras reciben la
-- pestaña Aprobación de insumos y la acción aprobar_insumos; Líder Técnico y
-- Área Técnica las pierden. Gerencia las conserva. La aprobación de mano de
-- obra y equipos sigue igual (Líder Técnico).
-- Se puede correr más de una vez.

insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
  from public.roles r
 cross join (values ('tab.almacen.aprobar_insumos'), ('accion.aprobar_insumos')) as p(permiso)
 where r.clave in ('compras', 'lider_compras')
   and not exists (select 1 from public.rol_permisos x where x.rol_id = r.id and x.permiso = p.permiso);

delete from public.rol_permisos rp
 using public.roles r
 where rp.rol_id = r.id
   and r.clave in ('lider_tecnico', 'area_tecnica')
   and rp.permiso in ('tab.almacen.aprobar_insumos', 'accion.aprobar_insumos');
