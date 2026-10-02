-- Rendimiento de las políticas RLS que quedaban con funciones de permiso por
-- fila (mismo tratamiento que 20261012100000_rendimiento_rls_contratos.sql).
-- Solo cambia CÓMO se evalúa cada política, no quién ve o hace qué: se usa
-- ALTER POLICY (mismo nombre, comando y roles) y se reescriben USING /
-- WITH CHECK.
--
--   * Lo que no depende de la fila va en (select f(...)): una vez por consulta.
--     También auth.uid() suelto -> (select auth.uid()).
--   * usuario_puede_ver_proyecto(uid, col) ->
--     col in (select proyectos_visibles(uid)). Las columnas proyecto_id son
--     FK, así que solo pueden traer proyectos existentes; donde la columna
--     admite null (presupuestos.proyecto_id) el caso null se resuelve con la
--     función vieja llamada una sola vez: (select f(uid, null)).
--   * usuario_puede_editar_proyecto(uid, col) -> col in (select
--     proyectos_editables(uid)) (nueva, equivalente: verificada para todos los
--     usuarios x proyectos, incluidos usuarios simulados con rol restringido,
--     sin rol con grupos y sin proyectos).
--   * usuario_tiene_acceso_a_item(presupuesto_item_id) (pedidos_insumos): la
--     parte "admin_insumos / admin_proyectos" no depende de la fila; la de
--     proyecto pasa a un exists sobre presupuesto_items -> presupuestos con el
--     conjunto de proyectos visibles. presupuesto_item_id es NOT NULL con FK,
--     así que el ítem siempre existe.
--
-- Mediciones (20 proyectos simulados, 25.000 ítems, 2.000 requisiciones /
-- 6.000 líneas, 1.000 OC / 3.000 líneas, 3.000 salidas; transacción
-- revertida, segunda corrida; admin real y el mismo usuario simulado con un
-- rol sin permisos y un solo proyecto):
--
--                                        admin            restringido
--   requisiciones_vista (500)         2.858 ->  52 ms   12.492 ->  70 ms
--   requisiciones_vista (todas)       4.658 -> 151 ms   12.410 ->  82 ms
--   pedidos_insumos (todos)           2.328 ->  73 ms   12.059 ->  20 ms
--   líneas de 100 requisiciones         258 ->  15 ms      652 ->  24 ms
--   ordenes_compra (lista)              858 ->  22 ms      924 ->   6 ms
--   ordenes_compra_items                464 ->  17 ms    2.117 ->   5 ms
--   salidas_insumos                     700 ->  18 ms    1.390 ->   3 ms
--
-- Mismas filas antes y después en todas las consultas medidas, y 1.292
-- comparaciones (19 usuarios reales y simulados x lectura de 31 tablas/vistas,
-- UPDATE e INSERT de presupuestos, versiones, ítems y pedidos) sin diferencias.

-- Mismos proyectos que acepta usuario_puede_editar_proyecto(uid, p) para todo
-- proyecto existente.
create or replace function public.proyectos_editables(p_usuario_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with u as (
    select coalesce((select pf.rol_id is null from public.perfiles pf where pf.id = p_usuario_id), true) as sin_rol
  )
  -- Sin rol (o sin perfil): admin o grupo que ve y edita todo -> todos.
  select p.id from public.proyectos p, u
  where u.sin_rol
    and (
      public.es_admin(p_usuario_id)
      or exists (
        select 1
        from public.usuario_grupos ug
        join public.grupos g on g.id = ug.grupo_id
        where ug.usuario_id = p_usuario_id
          and g.ve_todos_proyectos = true
          and g.puede_editar_todos = true
      )
    )
  union
  select up.proyecto_id from public.usuario_proyectos up, u
  where u.sin_rol and up.usuario_id = p_usuario_id and up.puede_editar = true
  union
  select gp.proyecto_id
  from public.usuario_grupos ug
  join public.grupo_proyectos gp on gp.grupo_id = ug.grupo_id, u
  where u.sin_rol and ug.usuario_id = p_usuario_id and gp.puede_editar = true
  union
  -- Con rol: acción editar_presupuestos + ver el proyecto.
  select v.id from public.proyectos_visibles(p_usuario_id) as v(id), u
  where not u.sin_rol and public.tiene_accion(p_usuario_id, 'editar_presupuestos')
$$;
revoke all on function public.proyectos_editables(uuid) from public, anon;
grant execute on function public.proyectos_editables(uuid) to authenticated, service_role;

-- ------------------------------------------------- "cualquier autenticado"
alter policy "autenticados leen y modifican apu" on public.apu
  using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
alter policy "autenticados leen y modifican apu_import_revision" on public.apu_import_revision
  using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
alter policy "autenticados leen y modifican item_apu" on public.item_apu
  using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
alter policy "autenticados leen y modifican transporte_precios" on public.transporte_precios
  using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);
alter policy empresas_select on public.empresas
  using ((select auth.uid()) is not null);
alter policy empresas_cuentas_bancarias_select on public.empresas_cuentas_bancarias
  using ((select auth.uid()) is not null);
alter policy "cualquier autenticado lee grupos" on public.grupos
  using ((select auth.uid()) is not null);
alter policy "autenticados leen historico de precios" on public.historico_precios_compra
  using ((select auth.uid()) is not null);
alter policy "autenticados leen y crean insumos" on public.maestro_insumos
  using ((select auth.uid()) is not null);
alter policy "autenticados ven solicitudes" on public.solicitudes_insumos
  using ((select auth.uid()) is not null);
alter policy "autenticados crean solicitudes" on public.solicitudes_insumos
  with check ((select auth.uid()) is not null);
alter policy "autenticados leen solicitudes_equipo" on public.solicitudes_equipo
  using ((select auth.uid()) is not null);
alter policy "autenticados crean sus propias solicitudes_equipo" on public.solicitudes_equipo
  with check ((select auth.uid()) is not null and solicitado_por = (select auth.uid()));
alter policy "autenticados leen solicitudes_mano_obra" on public.solicitudes_mano_obra
  using ((select auth.uid()) is not null);
alter policy "autenticados crean sus propias solicitudes_mano_obra" on public.solicitudes_mano_obra
  with check ((select auth.uid()) is not null and solicitado_por = (select auth.uid()));

-- ------------------------------------------------- solo admin (es_admin)
alter policy empresas_insert on public.empresas
  with check ((select public.es_admin((select auth.uid()))));
alter policy empresas_update on public.empresas
  using ((select public.es_admin((select auth.uid()))))
  with check ((select public.es_admin((select auth.uid()))));
alter policy empresas_delete on public.empresas
  using ((select public.es_admin((select auth.uid()))));
alter policy empresas_cuentas_bancarias_insert on public.empresas_cuentas_bancarias
  with check ((select public.es_admin((select auth.uid()))));
alter policy empresas_cuentas_bancarias_update on public.empresas_cuentas_bancarias
  using ((select public.es_admin((select auth.uid()))))
  with check ((select public.es_admin((select auth.uid()))));
alter policy empresas_cuentas_bancarias_delete on public.empresas_cuentas_bancarias
  using ((select public.es_admin((select auth.uid()))));
alter policy "solo admin modifica grupos" on public.grupos
  using ((select public.es_admin((select auth.uid()))))
  with check ((select public.es_admin((select auth.uid()))));
alter policy "solo admin modifica grupo_proyectos" on public.grupo_proyectos
  using ((select public.es_admin((select auth.uid()))))
  with check ((select public.es_admin((select auth.uid()))));
alter policy "solo admin modifica usuario_grupos" on public.usuario_grupos
  using ((select public.es_admin((select auth.uid()))))
  with check ((select public.es_admin((select auth.uid()))));
alter policy "solo admin modifica usuario_proyectos" on public.usuario_proyectos
  using ((select public.es_admin((select auth.uid()))))
  with check ((select public.es_admin((select auth.uid()))));
alter policy "solo admin modifica proyectos" on public.proyectos
  using ((select public.es_admin((select auth.uid()))))
  with check ((select public.es_admin((select auth.uid()))));
alter policy "solo admin borra insumos" on public.maestro_insumos
  using ((select public.es_admin((select auth.uid()))));
alter policy "solo admin actualiza perfiles" on public.perfiles
  using ((select public.es_admin((select auth.uid()))))
  with check ((select public.es_admin((select auth.uid()))));
alter policy "solo admin borra perfiles" on public.perfiles
  using ((select public.es_admin((select auth.uid()))));
alter policy "solo admin crea perfiles" on public.perfiles
  with check ((select public.es_admin((select auth.uid()))));

-- ------------------------------------------------- propios o admin
alter policy "ver propio perfil o admin ve todos" on public.perfiles
  using (id = (select auth.uid()) or (select public.es_admin((select auth.uid()))));
alter policy "ver los grupos propios, o admin ve todos" on public.usuario_grupos
  using (usuario_id = (select auth.uid()) or (select public.es_admin((select auth.uid()))));
alter policy "ver los proyectos individuales propios, o admin" on public.usuario_proyectos
  using (usuario_id = (select auth.uid()) or (select public.es_admin((select auth.uid()))));
alter policy "ver grupo_proyectos de los grupos propios, o admin" on public.grupo_proyectos
  using (
    (select public.es_admin((select auth.uid())))
    or exists (
      select 1 from public.usuario_grupos ug
      where ug.usuario_id = (select auth.uid()) and ug.grupo_id = grupo_proyectos.grupo_id
    )
  );
alter policy notificaciones_select_propias on public.notificaciones
  using (usuario_id = (select auth.uid()));
alter policy notificaciones_update_propias on public.notificaciones
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()));

-- ------------------------------------------------- acciones (tiene_accion y alias)
alter policy "admin_insumos inserta historico de precios" on public.historico_precios_compra
  with check ((select public.admin_insumos((select auth.uid()))));
alter policy "admin_insumos borra historico de precios" on public.historico_precios_compra
  using ((select public.admin_insumos((select auth.uid()))));
alter policy "admin_insumos inserta insumos" on public.maestro_insumos
  with check ((select public.admin_insumos((select auth.uid()))));
alter policy maestro_insumos_update on public.maestro_insumos
  using ((select public.tiene_accion((select auth.uid()), 'aprobar_insumos')))
  with check ((select public.tiene_accion((select auth.uid()), 'aprobar_insumos')));
alter policy "admin_insumos actualiza solicitudes" on public.solicitudes_insumos
  using ((select public.admin_insumos((select auth.uid()))))
  with check ((select public.admin_insumos((select auth.uid()))));
alter policy "admin_insumos borra solicitudes" on public.solicitudes_insumos
  using ((select public.admin_insumos((select auth.uid()))));
alter policy "admin_mano_obra resuelve solicitudes_equipo" on public.solicitudes_equipo
  using ((select public.tiene_accion((select auth.uid()), 'aprobar_mano_obra')));
alter policy "admin_mano_obra resuelve solicitudes_mano_obra" on public.solicitudes_mano_obra
  using ((select public.tiene_accion((select auth.uid()), 'aprobar_mano_obra')));
alter policy equipo_categorias_insert on public.equipo_categorias
  with check ((select public.tiene_accion((select auth.uid()), 'aprobar_mano_obra')));
alter policy equipo_categorias_update on public.equipo_categorias
  using ((select public.tiene_accion((select auth.uid()), 'aprobar_mano_obra')))
  with check ((select public.tiene_accion((select auth.uid()), 'aprobar_mano_obra')));
alter policy equipo_categorias_delete on public.equipo_categorias
  using ((select public.tiene_accion((select auth.uid()), 'aprobar_mano_obra')));
alter policy mano_obra_categorias_insert on public.mano_obra_categorias
  with check ((select public.tiene_accion((select auth.uid()), 'aprobar_mano_obra')));
alter policy mano_obra_categorias_update on public.mano_obra_categorias
  using ((select public.tiene_accion((select auth.uid()), 'aprobar_mano_obra')))
  with check ((select public.tiene_accion((select auth.uid()), 'aprobar_mano_obra')));
alter policy mano_obra_categorias_delete on public.mano_obra_categorias
  using ((select public.tiene_accion((select auth.uid()), 'aprobar_mano_obra')));
alter policy proveedores_insert on public.proveedores
  with check ((select public.tiene_accion((select auth.uid()), 'editar_proveedores')));
alter policy proveedores_update on public.proveedores
  using ((select public.tiene_accion((select auth.uid()), 'editar_proveedores')))
  with check ((select public.tiene_accion((select auth.uid()), 'editar_proveedores')));
alter policy proveedores_select on public.proveedores
  using ((select public.rol_compras((select auth.uid()))) or (select public.es_admin((select auth.uid()))));
alter policy informacion_bancaria_select on public.informacion_bancaria
  using ((select public.rol_compras((select auth.uid()))) or (select public.es_admin((select auth.uid()))));
alter policy perfiles_select_compras on public.perfiles
  using ((select public.rol_compras((select auth.uid()))));
alter policy proyectos_select_compras on public.proyectos
  using ((select public.rol_compras((select auth.uid()))));

-- ------------------------------------------------- proyectos
alter policy "ver proyectos permitidos" on public.proyectos
  using (id in (select public.proyectos_visibles((select auth.uid()))));

-- ------------------------------------------------- presupuestos (proyecto_id admite null)
alter policy "ver presupuestos de proyectos permitidos" on public.presupuestos
  using (
    proyecto_id in (select public.proyectos_visibles((select auth.uid())))
    or (proyecto_id is null and (select public.usuario_puede_ver_proyecto((select auth.uid()), null::uuid)))
  );
alter policy "editar presupuestos de proyectos con permiso" on public.presupuestos
  using (
    proyecto_id in (select public.proyectos_editables((select auth.uid())))
    or (proyecto_id is null and (select public.usuario_puede_editar_proyecto((select auth.uid()), null::uuid)))
  )
  with check (
    proyecto_id in (select public.proyectos_editables((select auth.uid())))
    or (proyecto_id is null and (select public.usuario_puede_editar_proyecto((select auth.uid()), null::uuid)))
  );

alter policy "ver items de presupuestos permitidos" on public.presupuesto_items
  using (exists (
    select 1 from public.presupuestos p
    where p.id = presupuesto_items.presupuesto_id
      and (
        p.proyecto_id in (select public.proyectos_visibles((select auth.uid())))
        or (p.proyecto_id is null and (select public.usuario_puede_ver_proyecto((select auth.uid()), null::uuid)))
      )
  ));
alter policy "editar items de presupuestos con permiso" on public.presupuesto_items
  using (exists (
    select 1 from public.presupuestos p
    where p.id = presupuesto_items.presupuesto_id
      and (
        p.proyecto_id in (select public.proyectos_editables((select auth.uid())))
        or (p.proyecto_id is null and (select public.usuario_puede_editar_proyecto((select auth.uid()), null::uuid)))
      )
  ))
  with check (exists (
    select 1 from public.presupuestos p
    where p.id = presupuesto_items.presupuesto_id
      and (
        p.proyecto_id in (select public.proyectos_editables((select auth.uid())))
        or (p.proyecto_id is null and (select public.usuario_puede_editar_proyecto((select auth.uid()), null::uuid)))
      )
  ));

alter policy "ver versiones de presupuestos permitidos" on public.presupuesto_versiones
  using (exists (
    select 1 from public.presupuestos p
    where p.id = presupuesto_versiones.presupuesto_id
      and (
        p.proyecto_id in (select public.proyectos_visibles((select auth.uid())))
        or (p.proyecto_id is null and (select public.usuario_puede_ver_proyecto((select auth.uid()), null::uuid)))
      )
  ));
alter policy "editar versiones de presupuestos con permiso" on public.presupuesto_versiones
  using (exists (
    select 1 from public.presupuestos p
    where p.id = presupuesto_versiones.presupuesto_id
      and (
        p.proyecto_id in (select public.proyectos_editables((select auth.uid())))
        or (p.proyecto_id is null and (select public.usuario_puede_editar_proyecto((select auth.uid()), null::uuid)))
      )
  ))
  with check (exists (
    select 1 from public.presupuestos p
    where p.id = presupuesto_versiones.presupuesto_id
      and (
        p.proyecto_id in (select public.proyectos_editables((select auth.uid())))
        or (p.proyecto_id is null and (select public.usuario_puede_editar_proyecto((select auth.uid()), null::uuid)))
      )
  ));

-- ------------------------------------------------- pedidos_insumos (líneas de requisición)
-- Antes: usuario_tiene_acceso_a_item(presupuesto_item_id), una llamada por fila.
alter policy pedidos_insumos_select on public.pedidos_insumos
  using (
    (select public.admin_insumos((select auth.uid())))
    or (select public.admin_proyectos((select auth.uid())))
    or exists (
      select 1
      from public.presupuesto_items pi
      join public.presupuestos p on p.id = pi.presupuesto_id
      where pi.id = pedidos_insumos.presupuesto_item_id
        and (
          p.proyecto_id in (select public.proyectos_visibles((select auth.uid())))
          or (p.proyecto_id is null and (select public.usuario_puede_ver_proyecto((select auth.uid()), null::uuid)))
        )
    )
  );
alter policy pedidos_insumos_insert on public.pedidos_insumos
  with check (
    solicitado_por = (select auth.uid())
    and (
      (select public.admin_insumos((select auth.uid())))
      or (select public.admin_proyectos((select auth.uid())))
      or exists (
        select 1
        from public.presupuesto_items pi
        join public.presupuestos p on p.id = pi.presupuesto_id
        where pi.id = pedidos_insumos.presupuesto_item_id
          and (
            p.proyecto_id in (select public.proyectos_visibles((select auth.uid())))
            or (p.proyecto_id is null and (select public.usuario_puede_ver_proyecto((select auth.uid()), null::uuid)))
          )
      )
    )
  );
alter policy pedidos_insumos_select_compras on public.pedidos_insumos
  using ((select public.rol_compras((select auth.uid()))));
alter policy pedidos_insumos_update on public.pedidos_insumos
  using ((select public.tiene_accion((select auth.uid()), 'aprobar_pedidos')));
alter policy pedidos_insumos_update_compras on public.pedidos_insumos
  using (estado = 'aprobado' and (select public.rol_compras((select auth.uid()))));

-- ------------------------------------------------- órdenes de compra
alter policy ordenes_compra_select on public.ordenes_compra
  using ((select public.rol_compras((select auth.uid()))));
alter policy ordenes_compra_select_proyecto on public.ordenes_compra
  using (proyecto_id in (select public.proyectos_visibles((select auth.uid()))));
alter policy ordenes_compra_insert on public.ordenes_compra
  with check (
    (select public.rol_compras((select auth.uid())))
    and estado = 'pendiente_aprobacion'
    and aprobada_por is null
    and aprobada_at is null
    and enviada = false
    and motivo_rechazo is null
  );
alter policy ordenes_compra_items_select on public.ordenes_compra_items
  using ((select public.rol_compras((select auth.uid()))));
alter policy ordenes_compra_items_select_proyecto on public.ordenes_compra_items
  using (exists (
    select 1 from public.ordenes_compra oc
    where oc.id = ordenes_compra_items.orden_compra_id
      and oc.proyecto_id in (select public.proyectos_visibles((select auth.uid())))
  ));

-- ------------------------------------------------- salidas
alter policy salidas_insumos_select on public.salidas_insumos
  using (proyecto_id in (select public.proyectos_visibles((select auth.uid()))));

-- ------------------------------------------------- Storage
alter policy contratistas_archivos_insert on storage.objects
  with check (bucket_id = 'contratistas' and (select public.tiene_accion((select auth.uid()), 'gestionar_contratistas')));
alter policy contratistas_archivos_delete on storage.objects
  using (
    bucket_id = 'contratistas'
    and (select public.tiene_accion((select auth.uid()), 'gestionar_contratistas'))
    and not exists (select 1 from public.contratista_documentos d where d.ruta = objects.name)
  );
alter policy contratos_archivos_insert on storage.objects
  with check (bucket_id = 'contratos' and (select public.tiene_accion((select auth.uid()), 'solicitar_contratos')));
alter policy contratos_archivos_delete on storage.objects
  using (
    bucket_id = 'contratos'
    and (select public.tiene_accion((select auth.uid()), 'solicitar_contratos'))
    and not exists (select 1 from public.contrato_documentos d where d.ruta = objects.name)
  );
