-- MIGRAR USUARIOS EXISTENTES A ROLES.
--
-- CORRER SOLO CUANDO YA ESTÉS LISTO: en cuanto un usuario tiene rol, el rol
-- reemplaza a sus banderas anteriores y a los grupos. Antes de correrlo,
-- revisa en la página "Roles y permisos" que la matriz esté como quieres.
--
-- Reglas (puedes corregir a mano en "Usuarios y accesos" después):
--   es_admin                                  -> Administrador
--   rol_compras                               -> Compras
--   admin_insumos / admin_proyectos /
--   admin_mano_obra                           -> Líder Técnico
--   el resto                                  -> queda SIN rol (sigue como hoy)
-- Acceso a proyectos:
--   * "todos los proyectos" para Administrador, Compras y para quien tuviera
--     un grupo con ve_todos_proyectos
--   * los proyectos que venían por grupos se copian como asignación directa
-- Se puede volver a correr sin duplicar nada.

begin;

-- 1) Quien veía todos los proyectos por un grupo (se calcula ANTES de asignar
--    roles, porque después usuario_ve_todos_proyectos lee el nuevo flag).
update public.perfiles p
   set todos_los_proyectos = true
 where p.rol_id is null
   and exists (
     select 1
     from public.usuario_grupos ug
     join public.grupos g on g.id = ug.grupo_id
     where ug.usuario_id = p.id and g.ve_todos_proyectos = true
   );

-- 2) Proyectos que venían por grupo -> asignación directa.
insert into public.usuario_proyectos (usuario_id, proyecto_id, puede_editar)
select ug.usuario_id, gp.proyecto_id, bool_or(gp.puede_editar)
  from public.usuario_grupos ug
  join public.grupo_proyectos gp on gp.grupo_id = ug.grupo_id
  join public.perfiles p on p.id = ug.usuario_id and p.rol_id is null
 where not exists (
   select 1 from public.usuario_proyectos up
   where up.usuario_id = ug.usuario_id and up.proyecto_id = gp.proyecto_id
 )
 group by ug.usuario_id, gp.proyecto_id;

-- 3) Asignar rol según las banderas anteriores.
update public.perfiles p
   set rol_id = r.id
  from public.roles r
 where p.rol_id is null
   and r.clave = case
     when p.es_admin then 'administrador'
     when p.rol_compras then 'compras'
     when p.admin_insumos or p.admin_proyectos or p.admin_mano_obra then 'lider_tecnico'
   end;

-- 4) Administrador y Compras ven todos los proyectos.
update public.perfiles p
   set todos_los_proyectos = true
  from public.roles r
 where r.id = p.rol_id and r.clave in ('administrador', 'compras');

commit;
