-- Nombre y rol de cada persona visibles para todos los usuarios con sesión
-- (decisión del usuario, 2026-10-19; hallazgo E1 de la revisión por roles).
--
-- Antes, `perfiles` solo la leía el propio usuario, el Administrador o quien
-- tiene la acción `comprar`: en el resto de roles "Solicitado por", "Creada
-- por", "Aprobada por"... salían "—" en todas las pantallas que embeben
-- perfiles(nombre) o leen requisiciones_vista.
--
-- Ahora:
--   * cualquiera con sesión lee TODAS las filas de perfiles, pero solo las
--     columnas id, nombre y rol_id (permiso por columna). Correo, usuario,
--     banderas viejas y todos_los_proyectos siguen ocultos; los leen las
--     funciones SECURITY DEFINER de siempre (permisos, Usuarios y accesos).
--   * cualquiera con sesión lee roles (id, clave, nombre): el nombre del rol
--     no es sensible. rol_permisos sigue cerrado.
--   * obtener_permisos_usuario (SECURITY INVOKER) leía perfiles.es_admin en el
--     camino viejo de usuarios sin rol: ahora usa public.es_admin(), que ya era
--     SECURITY DEFINER. Mismo resultado.
--
-- Revisado contra la base viva antes de escribirla: ninguna pantalla lee otra
-- columna de perfiles con la sesión del usuario (todas piden nombre o id), la
-- única vista que la usa (requisiciones_vista) lee id y nombre, y ninguna
-- política de otra tabla consulta perfiles.

-- ------------------------------------------------------------- perfiles
revoke select on public.perfiles from anon, authenticated;
grant select (id, nombre, rol_id) on public.perfiles to authenticated;

drop policy if exists "ver propio perfil o admin ve todos" on public.perfiles;
drop policy if exists perfiles_select_compras on public.perfiles;
drop policy if exists perfiles_select_nombre_rol on public.perfiles;
create policy perfiles_select_nombre_rol on public.perfiles
  for select to authenticated
  using (true);

-- --------------------------------------------------------------- roles
revoke select on public.roles from anon;
grant select (id, clave, nombre) on public.roles to authenticated;

drop policy if exists roles_select_autenticados on public.roles;
create policy roles_select_autenticados on public.roles
  for select to authenticated
  using (true);

-- ------------------------------------------- obtener_permisos_usuario
-- Copia de la versión viva; solo cambia la lectura de es_admin (camino sin rol).
create or replace function public.obtener_permisos_usuario(p_usuario_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_rol uuid;
  v_es_admin boolean;
  v_ve_todos boolean;
  v_edita_todos boolean;
  v_edita boolean;
  v_proyectos jsonb;
begin
  select rol_id into v_rol from public.perfiles where id = p_usuario_id;

  -- Con rol asignado: el rol decide.
  if v_rol is not null then
    v_es_admin := public.es_admin(p_usuario_id);
    v_ve_todos := v_es_admin or public.usuario_ve_todos_proyectos(p_usuario_id);
    v_edita := public.tiene_accion(p_usuario_id, 'editar_presupuestos');

    if v_ve_todos then
      return jsonb_build_object(
        'esAdmin', v_es_admin, 'veTodosProyectos', true,
        'puedeEditarTodos', v_edita, 'proyectos', '{}'::jsonb
      );
    end if;

    select coalesce(jsonb_object_agg(up.proyecto_id, v_edita), '{}'::jsonb)
      into v_proyectos
      from public.usuario_proyectos up
     where up.usuario_id = p_usuario_id;

    return jsonb_build_object(
      'esAdmin', false, 'veTodosProyectos', false,
      'puedeEditarTodos', false, 'proyectos', v_proyectos
    );
  end if;

  -- Sin rol: lógica anterior. es_admin se lee con la función (la columna ya
  -- no se puede leer con la sesión del usuario).
  v_es_admin := public.es_admin(p_usuario_id);

  if v_es_admin then
    return jsonb_build_object(
      'esAdmin', true, 'veTodosProyectos', true,
      'puedeEditarTodos', true, 'proyectos', '{}'::jsonb
    );
  end if;

  select bool_or(g.ve_todos_proyectos), bool_or(g.ve_todos_proyectos and g.puede_editar_todos)
    into v_ve_todos, v_edita_todos
    from public.usuario_grupos ug
    join public.grupos g on g.id = ug.grupo_id
   where ug.usuario_id = p_usuario_id;

  if v_ve_todos then
    return jsonb_build_object(
      'esAdmin', false, 'veTodosProyectos', true,
      'puedeEditarTodos', coalesce(v_edita_todos, false), 'proyectos', '{}'::jsonb
    );
  end if;

  select coalesce(jsonb_object_agg(proyecto_id, puede_editar), '{}'::jsonb)
    into v_proyectos
    from (
      select combinado.proyecto_id, bool_or(combinado.puede_editar) as puede_editar
      from (
        select gp.proyecto_id, gp.puede_editar
          from public.grupo_proyectos gp
          join public.usuario_grupos ug on ug.grupo_id = gp.grupo_id
         where ug.usuario_id = p_usuario_id
        union all
        select up.proyecto_id, up.puede_editar
          from public.usuario_proyectos up
         where up.usuario_id = p_usuario_id
      ) as combinado
      group by combinado.proyecto_id
    ) as agregado;

  return jsonb_build_object(
    'esAdmin', false, 'veTodosProyectos', false,
    'puedeEditarTodos', false, 'proyectos', v_proyectos
  );
end;
$function$;
