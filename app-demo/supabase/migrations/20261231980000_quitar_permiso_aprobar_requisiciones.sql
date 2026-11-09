-- Las requisiciones normales ya no se aprueban (20261231960000): nacen
-- aprobadas y van directo a Compras. Quedaba el permiso de aprobarlas en
-- Líder Técnico y Subgerencia, y el de desaprobarlas en Líder Técnico (que las
-- devolvería a "pendiente" sin nadie que las apruebe). Se quitan de todos los
-- roles y de la matriz de Roles y permisos (lib/pestanas.ts).
-- Las extraordinarias no cambian: las maneja Gerencia con
-- `aprobar_requisiciones_extraordinarias`. `cancelar_pedidos` tampoco cambia.
-- `pedidos_insumos_select` deja de dar lectura por `admin_proyectos()`: Líder
-- Técnico sigue leyendo con sus pestañas de requisiciones, en sus proyectos.
-- Se puede correr dos veces. Va después de 20261231970000.

delete from public.rol_permisos
 where permiso in ('accion.aprobar_pedidos', 'accion.desaprobar_pedidos');
