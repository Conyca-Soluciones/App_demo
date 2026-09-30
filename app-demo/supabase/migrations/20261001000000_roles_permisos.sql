-- ROLES Y PERMISOS.
--
-- Modelo: cada usuario tiene UN rol general (perfiles.rol_id) y una lista de
-- proyectos (usuario_proyectos, o perfiles.todos_los_proyectos). Cada rol
-- tiene un conjunto de permisos en rol_permisos, de dos tipos:
--   'tab.<clave>'     acceso a una pestaña del menú
--   'accion.<clave>'  poder hacer una acción (aprobar OC, editar presupuesto...)
-- El rol 'administrador' tiene siempre todo (no depende de rol_permisos).
--
-- COMPATIBILIDAD: un usuario con perfiles.rol_id NULL sigue funcionando con
-- las banderas anteriores (es_admin, rol_compras, admin_insumos...) y con
-- grupos, exactamente como antes. Esta migración NO cambia el
-- comportamiento de nadie hasta que se le asigne un rol (ver
-- 20261001100000_migrar_usuarios_a_roles.sql, que se corre aparte).
--
-- Las funciones de ayuda (es_admin, rol_compras, admin_insumos, ...) conservan
-- nombre y firma: las ~35 políticas RLS que las usan no se tocan.

-- ------------------------------------------------------------------ tablas
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  nombre text not null,
  es_sistema boolean not null default false,
  orden integer not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.rol_permisos (
  rol_id uuid not null references public.roles(id) on delete cascade,
  permiso text not null check (permiso ~ '^(tab|accion)\.[a-z0-9_.]+$'),
  primary key (rol_id, permiso)
);

alter table public.perfiles
  add column if not exists rol_id uuid references public.roles(id) on delete set null,
  add column if not exists todos_los_proyectos boolean not null default false;

-- Sin policies: todo acceso pasa por las funciones security definer de abajo.
alter table public.roles enable row level security;
alter table public.rol_permisos enable row level security;

-- ------------------------------------------------------------ roles base
insert into public.roles (clave, nombre, es_sistema, orden) values
  ('compras',       'Compras',        true, 10),
  ('lider_compras', 'Líder Compras',  true, 20),
  ('area_tecnica',  'Área Técnica',   true, 30),
  ('lider_tecnico', 'Líder Técnico',  true, 40),
  ('gerencia',      'Gerencia',       true, 50),
  ('administrador', 'Administrador',  true, 60),
  ('legal',         'Legal',          true, 70),
  ('lider_legal',   'Líder Legal',    true, 80)
on conflict (clave) do nothing;

-- Permisos iniciales (editables desde la página de Roles). Solo se cargan
-- para un rol que todavía no tiene ninguno, así volver a correr esta
-- migración no resucita permisos que alguien quitó a propósito.
insert into public.rol_permisos (rol_id, permiso)
select r.id, s.permiso
from public.roles r
join (values
  -- Gerencia
  ('gerencia','tab.presupuestos.elaboracion'), ('gerencia','tab.almacen.inventario'),
  ('gerencia','tab.compras.ordenes'), ('gerencia','tab.compras.aprobar_oc'),
  ('gerencia','tab.contratos.contratos'), ('gerencia','tab.contratos.cortes'),
  ('gerencia','tab.contratos.informes'), ('gerencia','tab.admin.visualizacion'),
  ('gerencia','accion.aprobar_oc'), ('gerencia','accion.desaprobar_oc'), ('gerencia','accion.cancelar_oc'),
  -- Compras
  ('compras','tab.almacen.insumos'), ('compras','tab.almacen.proveedores'),
  ('compras','tab.almacen.inventario'), ('compras','tab.compras.comprar_pedidos'),
  ('compras','tab.compras.ordenes'), ('compras','accion.comprar'),
  -- Líder Compras
  ('lider_compras','tab.almacen.insumos'), ('lider_compras','tab.almacen.proveedores'),
  ('lider_compras','tab.almacen.inventario'), ('lider_compras','tab.compras.comprar_pedidos'),
  ('lider_compras','tab.compras.ordenes'), ('lider_compras','tab.compras.aprobar_oc'),
  ('lider_compras','accion.comprar'), ('lider_compras','accion.aprobar_oc'),
  ('lider_compras','accion.desaprobar_oc'), ('lider_compras','accion.cancelar_oc'),
  -- Área Técnica
  ('area_tecnica','tab.presupuestos.elaboracion'), ('area_tecnica','tab.tecnico.pedidos'),
  ('area_tecnica','tab.almacen.insumos'), ('area_tecnica','tab.almacen.entradas'),
  ('area_tecnica','tab.almacen.inventario'), ('area_tecnica','tab.almacen.salidas'),
  ('area_tecnica','accion.editar_presupuestos'), ('area_tecnica','accion.gestionar_almacen'),
  -- Líder Técnico (todo lo de Área Técnica + las aprobaciones técnicas)
  ('lider_tecnico','tab.presupuestos.elaboracion'), ('lider_tecnico','tab.tecnico.pedidos'),
  ('lider_tecnico','tab.tecnico.aprobar_pedidos'), ('lider_tecnico','tab.tecnico.aprobar_mano_obra'),
  ('lider_tecnico','tab.almacen.insumos'), ('lider_tecnico','tab.almacen.aprobar_insumos'),
  ('lider_tecnico','tab.almacen.entradas'), ('lider_tecnico','tab.almacen.inventario'),
  ('lider_tecnico','tab.almacen.salidas'),
  ('lider_tecnico','accion.editar_presupuestos'), ('lider_tecnico','accion.gestionar_almacen'),
  ('lider_tecnico','accion.aprobar_pedidos'), ('lider_tecnico','accion.aprobar_mano_obra'),
  ('lider_tecnico','accion.aprobar_insumos'),
  -- Legal y Líder Legal
  ('legal','tab.contratos.contratos'), ('legal','tab.contratos.cortes'), ('legal','tab.contratos.informes'),
  ('lider_legal','tab.contratos.contratos'), ('lider_legal','tab.contratos.cortes'),
  ('lider_legal','tab.contratos.informes')
) as s(clave, permiso) on s.clave = r.clave
where not exists (select 1 from public.rol_permisos rp where rp.rol_id = r.id)
on conflict do nothing;

-- ------------------------------------------------------ funciones de ayuda
-- ¿Tiene el usuario esta ACCIÓN? Con rol: lo que diga el rol (Administrador
-- siempre sí). Sin rol (rol_id NULL): las banderas anteriores.
create or replace function public.tiene_accion(p_usuario_id uuid, p_accion text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when p.rol_id is null then
        case p_accion
          when 'comprar'             then p.es_admin or p.rol_compras
          when 'aprobar_insumos'     then p.es_admin or p.admin_insumos
          when 'gestionar_almacen'   then p.es_admin or p.admin_insumos
          when 'aprobar_pedidos'     then p.es_admin or p.admin_proyectos or p.admin_insumos
          when 'aprobar_mano_obra'   then p.es_admin or p.admin_mano_obra
          else p.es_admin  -- aprobar/desaprobar/cancelar OC, editar_presupuestos (por proyecto, ver más abajo)
        end
      else
        r.clave = 'administrador'
        or exists (
          select 1 from public.rol_permisos rp
          where rp.rol_id = p.rol_id and rp.permiso = 'accion.' || p_accion
        )
    end
    from public.perfiles p
    left join public.roles r on r.id = p.rol_id
    where p.id = p_usuario_id
  ), false)
$$;

create or replace function public.es_admin(p_usuario_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case when p.rol_id is null then p.es_admin else r.clave = 'administrador' end
    from public.perfiles p
    left join public.roles r on r.id = p.rol_id
    where p.id = p_usuario_id
  ), false)
$$;

create or replace function public.rol_compras(p_usuario_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.tiene_accion(p_usuario_id, 'comprar') $$;

create or replace function public.admin_insumos(p_usuario_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.tiene_accion(p_usuario_id, 'aprobar_insumos') $$;

create or replace function public.admin_proyectos(p_usuario_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.tiene_accion(p_usuario_id, 'aprobar_pedidos') $$;

create or replace function public.admin_usuarios(p_usuario_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case when p.rol_id is null then p.es_admin or p.admin_usuarios else r.clave = 'administrador' end
    from public.perfiles p
    left join public.roles r on r.id = p.rol_id
    where p.id = p_usuario_id
  ), false)
$$;

create or replace function public.tiene_scope_admin(p_usuario_id uuid, p_columna text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_columna
    when 'admin_insumos'   then public.admin_insumos(p_usuario_id)
    when 'admin_proyectos' then public.admin_proyectos(p_usuario_id)
    when 'admin_usuarios'  then public.admin_usuarios(p_usuario_id)
    else public.es_admin(p_usuario_id)
  end
$$;

-- ---------------------------------------------------- acceso a proyectos
-- Con rol: perfiles.todos_los_proyectos. Sin rol: grupos con
-- ve_todos_proyectos, como antes.
create or replace function public.usuario_ve_todos_proyectos(p_usuario_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when p.rol_id is null then exists (
        select 1
        from public.usuario_grupos ug
        join public.grupos g on g.id = ug.grupo_id
        where ug.usuario_id = p_usuario_id and g.ve_todos_proyectos = true
      )
      else p.todos_los_proyectos
    end
    from public.perfiles p
    where p.id = p_usuario_id
  ), false)
$$;

create or replace function public.usuario_puede_ver_proyecto(p_usuario_id uuid, p_proyecto_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.es_admin(p_usuario_id)
    or public.usuario_ve_todos_proyectos(p_usuario_id)
    or exists (
      select 1 from public.usuario_proyectos up
      where up.usuario_id = p_usuario_id and up.proyecto_id = p_proyecto_id
    )
    -- Los grupos solo cuentan para usuarios que todavía no tienen rol.
    or exists (
      select 1
      from public.perfiles pf
      join public.usuario_grupos ug on ug.usuario_id = pf.id
      join public.grupo_proyectos gp on gp.grupo_id = ug.grupo_id
      where pf.id = p_usuario_id and pf.rol_id is null and gp.proyecto_id = p_proyecto_id
    )
$$;

-- Editar presupuesto: con rol, es una ACCIÓN del rol + ver el proyecto. Sin
-- rol, la lógica anterior (puede_editar por proyecto / grupo).
create or replace function public.usuario_puede_editar_proyecto(p_usuario_id uuid, p_proyecto_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce((select p.rol_id is null from public.perfiles p where p.id = p_usuario_id), true) then (
      public.es_admin(p_usuario_id)
      or exists (
        select 1
        from public.usuario_grupos ug
        join public.grupos g on g.id = ug.grupo_id
        where ug.usuario_id = p_usuario_id
          and g.ve_todos_proyectos = true
          and g.puede_editar_todos = true
      )
      or exists (
        select 1 from public.usuario_proyectos up
        where up.usuario_id = p_usuario_id and up.proyecto_id = p_proyecto_id and up.puede_editar = true
      )
      or exists (
        select 1
        from public.usuario_grupos ug
        join public.grupo_proyectos gp on gp.grupo_id = ug.grupo_id
        where ug.usuario_id = p_usuario_id and gp.proyecto_id = p_proyecto_id and gp.puede_editar = true
      )
    )
    else
      public.tiene_accion(p_usuario_id, 'editar_presupuestos')
      and public.usuario_puede_ver_proyecto(p_usuario_id, p_proyecto_id)
  end
$$;

create or replace function public.usuario_tiene_acceso_a_item(p_presupuesto_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.presupuesto_items pi
    join public.presupuestos p on p.id = pi.presupuesto_id
    where pi.id = p_presupuesto_item_id
      and (
        public.usuario_puede_ver_proyecto(auth.uid(), p.proyecto_id)
        -- quienes aprueban insumos o pedidos ven los pedidos de todos los proyectos
        or public.admin_insumos(auth.uid())
        or public.admin_proyectos(auth.uid())
      )
  );
$$;

-- Misma forma de respuesta de siempre (esAdmin, veTodosProyectos,
-- puedeEditarTodos, proyectos): el código TypeScript que la llama no cambia.
create or replace function public.obtener_permisos_usuario(p_usuario_id uuid)
returns jsonb
language plpgsql
stable
as $$
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

  -- Sin rol: lógica anterior, sin cambios.
  select es_admin into v_es_admin from public.perfiles where id = p_usuario_id;

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
$$;

-- --------------------------------------------- permisos del usuario actual
-- Lo usan el middleware (protección de rutas), el menú y las Server Actions.
-- Para un usuario sin rol devuelve sinRol=true y las acciones equivalentes a
-- sus banderas anteriores; las pestañas no se filtran en ese caso.
create or replace function public.permisos_rol_usuario(p_usuario_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_usuario_id, auth.uid());
  v_rol_id uuid;
  v_todos boolean;
  v_rol record;
  v_es_admin boolean;
  v_pestanas text[];
  v_acciones text[];
begin
  if v_uid is null then
    raise exception 'No autenticado.';
  end if;
  if v_uid <> coalesce(auth.uid(), v_uid) and not public.es_admin(auth.uid()) then
    raise exception 'No autorizado.';
  end if;

  select rol_id, todos_los_proyectos into v_rol_id, v_todos from public.perfiles where id = v_uid;
  v_es_admin := public.es_admin(v_uid);

  if v_rol_id is null then
    select coalesce(array_agg(a), '{}') into v_acciones
      from unnest(array['editar_presupuestos','aprobar_pedidos','aprobar_mano_obra','aprobar_insumos',
                        'gestionar_almacen','comprar','aprobar_oc','desaprobar_oc','cancelar_oc']) as a
     where public.tiene_accion(v_uid, a);

    return jsonb_build_object(
      'sinRol', true, 'rolId', null, 'rolClave', null, 'rolNombre', null,
      'esAdministrador', v_es_admin,
      'pestanas', '[]'::jsonb, 'acciones', to_jsonb(v_acciones),
      'todosProyectos', public.usuario_ve_todos_proyectos(v_uid)
    );
  end if;

  select id, clave, nombre into v_rol from public.roles where id = v_rol_id;

  select coalesce(array_agg(substr(rp.permiso, 5)), '{}') into v_pestanas
    from public.rol_permisos rp where rp.rol_id = v_rol_id and rp.permiso like 'tab.%';
  select coalesce(array_agg(substr(rp.permiso, 8)), '{}') into v_acciones
    from public.rol_permisos rp where rp.rol_id = v_rol_id and rp.permiso like 'accion.%';

  return jsonb_build_object(
    'sinRol', false, 'rolId', v_rol.id, 'rolClave', v_rol.clave, 'rolNombre', v_rol.nombre,
    'esAdministrador', v_es_admin,
    'pestanas', to_jsonb(v_pestanas), 'acciones', to_jsonb(v_acciones),
    'todosProyectos', v_es_admin or v_todos
  );
end;
$$;

-- ------------------------------------------- administración (solo Administrador)
create or replace function public._exigir_administrador()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.es_admin(auth.uid()) then
    raise exception 'Solo un Administrador puede hacer esto.';
  end if;
end;
$$;

create or replace function public.listar_roles_con_permisos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._exigir_administrador();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'clave', r.clave, 'nombre', r.nombre, 'es_sistema', r.es_sistema,
      'permisos', coalesce((select jsonb_agg(rp.permiso order by rp.permiso)
                              from public.rol_permisos rp where rp.rol_id = r.id), '[]'::jsonb),
      'usuarios', (select count(*) from public.perfiles p where p.rol_id = r.id)
    ) order by r.orden, r.nombre)
    from public.roles r
  ), '[]'::jsonb);
end;
$$;

create or replace function public.establecer_permiso_rol(p_rol_id uuid, p_permiso text, p_activo boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clave text;
begin
  perform public._exigir_administrador();
  select clave into v_clave from public.roles where id = p_rol_id;
  if v_clave is null then
    raise exception 'El rol no existe.';
  end if;
  if v_clave = 'administrador' then
    raise exception 'El rol Administrador siempre tiene todos los permisos.';
  end if;

  if p_activo then
    insert into public.rol_permisos (rol_id, permiso) values (p_rol_id, p_permiso)
    on conflict do nothing;
  else
    delete from public.rol_permisos where rol_id = p_rol_id and permiso = p_permiso;
  end if;
end;
$$;

create or replace function public.crear_rol(p_nombre text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_base text;
  v_clave text;
  v_n int := 1;
  v_id uuid;
begin
  perform public._exigir_administrador();
  if v_nombre = '' then
    raise exception 'El nombre del rol es obligatorio.';
  end if;

  v_base := trim(both '_' from regexp_replace(
    translate(lower(v_nombre), 'áéíóúñü', 'aeiounu'), '[^a-z0-9]+', '_', 'g'));
  if v_base = '' then v_base := 'rol'; end if;
  v_clave := v_base;
  while exists (select 1 from public.roles where clave = v_clave) loop
    v_n := v_n + 1;
    v_clave := v_base || '_' || v_n;
  end loop;

  insert into public.roles (clave, nombre, es_sistema, orden)
  values (v_clave, v_nombre, false, coalesce((select max(orden) from public.roles), 0) + 10)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.eliminar_rol(p_rol_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sistema boolean;
begin
  perform public._exigir_administrador();
  select es_sistema into v_sistema from public.roles where id = p_rol_id;
  if v_sistema is null then
    raise exception 'El rol no existe.';
  end if;
  if v_sistema then
    raise exception 'Los roles base no se pueden eliminar.';
  end if;
  if exists (select 1 from public.perfiles where rol_id = p_rol_id) then
    raise exception 'Hay usuarios con este rol. Cámbiales el rol antes de eliminarlo.';
  end if;
  delete from public.roles where id = p_rol_id;
end;
$$;

create or replace function public.listar_usuarios_accesos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._exigir_administrador();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'nombre', p.nombre, 'email', p.email, 'username', p.username,
      'rol_id', p.rol_id, 'todos_los_proyectos', p.todos_los_proyectos,
      'proyecto_ids', coalesce((select jsonb_agg(up.proyecto_id)
                                  from public.usuario_proyectos up where up.usuario_id = p.id), '[]'::jsonb),
      'banderas_anteriores', jsonb_build_object(
        'es_admin', p.es_admin, 'rol_compras', p.rol_compras, 'admin_insumos', p.admin_insumos,
        'admin_proyectos', p.admin_proyectos, 'admin_mano_obra', p.admin_mano_obra,
        'admin_usuarios', p.admin_usuarios)
    ) order by p.nombre)
    from public.perfiles p
  ), '[]'::jsonb);
end;
$$;

-- p_rol_id NULL = dejar al usuario sin rol (vuelve a sus banderas anteriores).
create or replace function public.asignar_rol_usuario(p_usuario_id uuid, p_rol_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clave text;
  v_es_admin_ahora boolean;
begin
  perform public._exigir_administrador();

  if not exists (select 1 from public.perfiles where id = p_usuario_id) then
    raise exception 'El usuario no existe.';
  end if;
  if p_rol_id is not null then
    select clave into v_clave from public.roles where id = p_rol_id;
    if v_clave is null then
      raise exception 'El rol no existe.';
    end if;
  end if;

  v_es_admin_ahora := public.es_admin(p_usuario_id);

  if v_es_admin_ahora and coalesce(v_clave, '') <> 'administrador' then
    if p_usuario_id = auth.uid() then
      raise exception 'No puedes quitarte tu propio acceso de Administrador.';
    end if;
    if not exists (
      select 1 from public.perfiles p
      where p.id <> p_usuario_id and public.es_admin(p.id)
    ) then
      raise exception 'Debe quedar al menos un Administrador.';
    end if;
  end if;

  update public.perfiles set rol_id = p_rol_id where id = p_usuario_id;
end;
$$;

-- p_todos = acceso a todos los proyectos (incluye los que se creen después).
-- p_proyectos = proyectos puntuales; se guardan aunque p_todos sea true, por
-- si luego se desactiva "todos".
create or replace function public.establecer_proyectos_usuario(
  p_usuario_id uuid,
  p_todos boolean,
  p_proyectos uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._exigir_administrador();

  if not exists (select 1 from public.perfiles where id = p_usuario_id) then
    raise exception 'El usuario no existe.';
  end if;

  update public.perfiles set todos_los_proyectos = coalesce(p_todos, false) where id = p_usuario_id;

  delete from public.usuario_proyectos
   where usuario_id = p_usuario_id
     and not (proyecto_id = any(coalesce(p_proyectos, '{}'::uuid[])));

  insert into public.usuario_proyectos (usuario_id, proyecto_id, puede_editar)
  select p_usuario_id, x.proyecto_id, true
    from unnest(coalesce(p_proyectos, '{}'::uuid[])) as x(proyecto_id)
   where not exists (
     select 1 from public.usuario_proyectos up
     where up.usuario_id = p_usuario_id and up.proyecto_id = x.proyecto_id
   );
end;
$$;

-- ---------------------------------------- funciones de órdenes de compra
-- aprobar / rechazar: ahora es la acción 'aprobar_oc' (antes es_admin). Sin
-- rol se comporta igual que antes (solo es_admin).
create or replace function public.aprobar_orden_compra(p_orden_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_oc') then
    raise exception 'No autorizado -- no tienes permiso para aprobar órdenes de compra.';
  end if;

  update ordenes_compra
    set estado = 'aprobada', aprobada_por = auth.uid(), aprobada_at = now(), motivo_rechazo = null
    where id = p_orden_id and estado = 'pendiente_aprobacion';

  if not found then
    raise exception 'La orden no existe o ya no está pendiente de aprobación.';
  end if;
end;
$function$;

create or replace function public.rechazar_orden_compra(p_orden_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_oc') then
    raise exception 'No autorizado -- no tienes permiso para rechazar órdenes de compra.';
  end if;

  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo de rechazo es obligatorio.';
  end if;

  -- Las líneas en ordenes_compra_items se dejan intactas a propósito (decisión:
  -- revisión manual de Compras, no se liberan los pedidos automáticamente).
  update ordenes_compra
    set estado = 'rechazada', aprobada_por = auth.uid(), aprobada_at = now(), motivo_rechazo = p_motivo
    where id = p_orden_id and estado = 'pendiente_aprobacion';

  if not found then
    raise exception 'La orden no existe o ya no está pendiente de aprobación.';
  end if;
end;
$function$;

-- Notificaciones de sobrecosto: antes iban a es_admin; ahora a quien puede
-- aprobar órdenes de compra (sin rol: igual que antes, solo es_admin).
create or replace function public.notificar_insumo_sobre_presupuesto()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  fila record;
  pct_sobre numeric;
  titulo text;
  mensaje text;
begin
  for fila in
    select r.insumo_descripcion, r.valor_presupuestado, r.valor_comprado
    from resumen_ejecucion_proyecto(new.proyecto_id) r
    where r.insumo_id in (
      select distinct pe.insumo_id
      from ordenes_compra_items oci
      join pedidos_insumos pe on pe.id = oci.pedido_insumo_id
      where oci.orden_compra_id = new.id
    )
    and r.valor_presupuestado > 0
    and r.valor_comprado > r.valor_presupuestado
  loop
    pct_sobre := (fila.valor_comprado / fila.valor_presupuestado - 1) * 100;
    titulo := case when pct_sobre >= 10 then 'Insumo con sobrecosto (+10%)' else 'Insumo sobre presupuesto' end;
    mensaje := fila.insumo_descripcion || ': comprado $' || round(fila.valor_comprado)::text ||
      ' vs. presupuestado $' || round(fila.valor_presupuestado)::text ||
      ' (' || round(pct_sobre, 1) || '% por encima). Orden de compra #' || new.numero || '.';

    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    select p.id, 'insumo_sobre_presupuesto', 'orden_compra', new.id, titulo, mensaje
    from perfiles p
    where public.tiene_accion(p.id, 'aprobar_oc');
  end loop;

  return new;
end;
$function$;

create or replace function public.notificar_precio_sobre_efectivo_oc_item()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_insumo_id uuid;
  v_insumo_descripcion text;
  v_precio_efectivo numeric;
  v_numero_orden integer;
  v_pct_sobre numeric;
begin
  select mi.id, mi.descripcion
    into v_insumo_id, v_insumo_descripcion
    from pedidos_insumos pi
    join maestro_insumos mi on mi.id = pi.insumo_id
    where pi.id = new.pedido_insumo_id;

  -- Pedido o insumo eliminado/inconsistente: no hay nada que comparar.
  if v_insumo_id is null then
    return new;
  end if;

  select pe.precio_efectivo into v_precio_efectivo
    from precios_efectivos_insumos(array[v_insumo_id]) pe;

  -- Sin precio efectivo (o cero) no hay base real de comparación -- mismo
  -- criterio de guarda que notificar_insumo_sobre_presupuesto usa con
  -- valor_presupuestado > 0.
  if v_precio_efectivo is null or v_precio_efectivo <= 0 then
    return new;
  end if;

  if new.precio_unitario > v_precio_efectivo * 1.10 then
    select numero into v_numero_orden from ordenes_compra where id = new.orden_compra_id;
    v_pct_sobre := (new.precio_unitario / v_precio_efectivo - 1) * 100;

    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    select
      p.id,
      'orden_compra_precio_sobre_efectivo',
      'orden_compra',
      new.orden_compra_id,
      'Precio de OC por encima del valor vigente (+10%)',
      v_insumo_descripcion || ': precio puesto en la OC $' || round(new.precio_unitario)::text ||
        ' vs. precio unitario vigente $' || round(v_precio_efectivo)::text ||
        ' (' || round(v_pct_sobre, 1) || '% por encima). Orden de compra #' || v_numero_orden || '.'
    from perfiles p
    where public.tiene_accion(p.id, 'aprobar_oc');
  end if;

  return new;
end;
$function$;

-- ------------------------------------- almacén (entradas / salidas / inventario)
create or replace function public._puede_gestionar_entradas()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.tiene_accion(auth.uid(), 'gestionar_almacen') $$;

create or replace function public.inventario_proyecto(p_proyecto_id uuid)
returns table (
  insumo_id uuid,
  insumo_codigo integer,
  insumo_descripcion text,
  insumo_um text,
  cantidad_entrada numeric,
  cantidad_salida numeric,
  cantidad_disponible numeric,
  costo_promedio numeric,
  valor_inventario numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not (
    public._puede_gestionar_entradas()
    or usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id)
  ) then
    raise exception 'No tienes permiso para ver el inventario de este proyecto.';
  end if;

  return query
  with ent as (
    select
      pe.insumo_id,
      sum(ei.cantidad) as cantidad,
      sum(ei.cantidad * oci.precio_unitario
          * (1 - oci.porcentaje_descuento / 100.0)
          * (1 + oci.porcentaje_iva / 100.0)) as valor
    from entradas_almacen_items ei
    join entradas_almacen e on e.id = ei.entrada_id
    join ordenes_compra oc on oc.id = e.orden_compra_id
    join ordenes_compra_items oci on oci.id = ei.orden_compra_item_id
    join pedidos_insumos pe on pe.id = oci.pedido_insumo_id
    where oc.proyecto_id = p_proyecto_id and e.anulada_at is null
    group by pe.insumo_id
  ),
  sal as (
    select s.insumo_id, sum(s.cantidad) as cantidad
    from salidas_insumos s
    where s.proyecto_id = p_proyecto_id and s.anulada_at is null
    group by s.insumo_id
  ),
  todos as (
    select ent.insumo_id from ent
    union
    select sal.insumo_id from sal
  )
  select
    t.insumo_id,
    mi.codigo,
    mi.descripcion,
    mi.u_m,
    coalesce(ent.cantidad, 0),
    coalesce(sal.cantidad, 0),
    coalesce(ent.cantidad, 0) - coalesce(sal.cantidad, 0),
    coalesce(ent.valor / nullif(ent.cantidad, 0), 0),
    (coalesce(ent.cantidad, 0) - coalesce(sal.cantidad, 0))
      * coalesce(ent.valor / nullif(ent.cantidad, 0), 0)
  from todos t
  join maestro_insumos mi on mi.id = t.insumo_id
  left join ent on ent.insumo_id = t.insumo_id
  left join sal on sal.insumo_id = t.insumo_id
  order by mi.codigo;
end;
$$;

create or replace function public.listar_salidas_proyecto(p_proyecto_id uuid)
returns table (
  id uuid,
  fecha date,
  created_at timestamptz,
  insumo_codigo integer,
  insumo_descripcion text,
  insumo_um text,
  cantidad numeric,
  cantidad_original numeric,
  retira text,
  observaciones text,
  registrado_por_nombre text,
  editada_at timestamptz,
  anulada_at timestamptz,
  motivo_anulacion text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not (
    public._puede_gestionar_entradas()
    or usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id)
  ) then
    raise exception 'No tienes permiso para ver las salidas de este proyecto.';
  end if;

  return query
  select s.id, s.fecha, s.created_at, mi.codigo, mi.descripcion, mi.u_m, s.cantidad,
         s.cantidad_original, s.retira, s.observaciones, pf.nombre,
         s.editada_at, s.anulada_at, s.motivo_anulacion
  from salidas_insumos s
  join maestro_insumos mi on mi.id = s.insumo_id
  left join perfiles pf on pf.id = s.registrado_por
  where s.proyecto_id = p_proyecto_id
  order by s.created_at desc
  limit 200;
end;
$$;

-- --------------------------- políticas que leían perfiles directamente
drop policy if exists pedidos_insumos_update on public.pedidos_insumos;
create policy pedidos_insumos_update on public.pedidos_insumos
  for update using (public.tiene_accion(auth.uid(), 'aprobar_pedidos'));

drop policy if exists proveedores_select on public.proveedores;
create policy proveedores_select on public.proveedores
  for select using (public.rol_compras(auth.uid()) or public.es_admin(auth.uid()));

drop policy if exists informacion_bancaria_select on public.informacion_bancaria;
create policy informacion_bancaria_select on public.informacion_bancaria
  for select using (public.rol_compras(auth.uid()) or public.es_admin(auth.uid()));

drop policy if exists "admin_mano_obra resuelve solicitudes_mano_obra" on public.solicitudes_mano_obra;
create policy "admin_mano_obra resuelve solicitudes_mano_obra" on public.solicitudes_mano_obra
  for update using (public.tiene_accion(auth.uid(), 'aprobar_mano_obra'));

drop policy if exists "admin_mano_obra resuelve solicitudes_equipo" on public.solicitudes_equipo;
create policy "admin_mano_obra resuelve solicitudes_equipo" on public.solicitudes_equipo
  for update using (public.tiene_accion(auth.uid(), 'aprobar_mano_obra'));

-- ----------------------------------------------------------------- permisos
revoke all on function public.permisos_rol_usuario(uuid) from public;
revoke all on function public._exigir_administrador() from public;
revoke all on function public.listar_roles_con_permisos() from public;
revoke all on function public.establecer_permiso_rol(uuid, text, boolean) from public;
revoke all on function public.crear_rol(text) from public;
revoke all on function public.eliminar_rol(uuid) from public;
revoke all on function public.listar_usuarios_accesos() from public;
revoke all on function public.asignar_rol_usuario(uuid, uuid) from public;
revoke all on function public.establecer_proyectos_usuario(uuid, boolean, uuid[]) from public;
grant execute on function public.permisos_rol_usuario(uuid) to authenticated;
grant execute on function public.listar_roles_con_permisos() to authenticated;
grant execute on function public.establecer_permiso_rol(uuid, text, boolean) to authenticated;
grant execute on function public.crear_rol(text) to authenticated;
grant execute on function public.eliminar_rol(uuid) to authenticated;
grant execute on function public.listar_usuarios_accesos() to authenticated;
grant execute on function public.asignar_rol_usuario(uuid, uuid) to authenticated;
grant execute on function public.establecer_proyectos_usuario(uuid, boolean, uuid[]) to authenticated;
