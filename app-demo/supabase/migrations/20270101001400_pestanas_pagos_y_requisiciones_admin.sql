-- Pagos administrativos y Requisiciones administrativas pasan a la matriz de
-- Roles (decisión del usuario, 2026-11-12): antes las veía cualquier usuario con
-- sesión; ahora son las pestañas ayf.pagos_administrativos y
-- ayf.requisiciones_administrativas.
--
-- Para que nadie pierda el acceso de golpe (la app está en uso), se le dan las
-- dos a TODOS los roles que existen hoy, salvo al Solicitante de pagos, que
-- solo recibe Pagos administrativos. El Administrador las ve siempre. Lo que
-- sobre se quita en Admin › Roles y permisos.
--
-- Solo agrega filas en rol_permisos. Reversa: borrar esas dos claves de
-- rol_permisos (con eso el código nuevo deja de mostrarlas; el anterior las
-- mostraba a todos).

begin;

insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
  from public.roles r
 cross join (values ('tab.ayf.pagos_administrativos'), ('tab.ayf.requisiciones_administrativas')) as p(permiso)
 where r.clave <> 'administrador'
   and not (r.clave = 'solicitante_pagos' and p.permiso = 'tab.ayf.requisiciones_administrativas')
on conflict do nothing;

commit;
