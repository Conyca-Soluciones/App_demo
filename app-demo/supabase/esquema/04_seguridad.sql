-- ---------------------------------------------------------------------------
-- Esquema REAL de la base de producción (proyecto Supabase "App-demo"),
-- sacado con solo lectura el 2026-10-02. Ver supabase/esquema/README.md.
-- No es una migración: no aplicar sobre la base real.
-- ---------------------------------------------------------------------------

-- RLS activado en todas las tablas de public.
alter table public.apu enable row level security;
alter table public.apu_import_revision enable row level security;
alter table public.contratista_documentos enable row level security;
alter table public.contratistas enable row level security;
alter table public.contrato_anexo_items enable row level security;
alter table public.contrato_documentos enable row level security;
alter table public.contrato_entregables enable row level security;
alter table public.contrato_obligaciones enable row level security;
alter table public.contratos enable row level security;
alter table public.empresas enable row level security;
alter table public.empresas_cuentas_bancarias enable row level security;
alter table public.entradas_almacen enable row level security;
alter table public.entradas_almacen_items enable row level security;
alter table public.equipo_categorias enable row level security;
alter table public.grupo_proyectos enable row level security;
alter table public.grupos enable row level security;
alter table public.historial_eventos enable row level security;
alter table public.historico_precios_compra enable row level security;
alter table public.informacion_bancaria enable row level security;
alter table public.item_apu enable row level security;
alter table public.maestro_insumos enable row level security;
alter table public.mano_obra_categorias enable row level security;
alter table public.notificaciones enable row level security;
alter table public.ordenes_compra enable row level security;
alter table public.ordenes_compra_items enable row level security;
alter table public.pedidos_insumos enable row level security;
alter table public.perfiles enable row level security;
alter table public.presupuesto_items enable row level security;
alter table public.presupuesto_versiones enable row level security;
alter table public.presupuestos enable row level security;
alter table public.proveedores enable row level security;
alter table public.proyectos enable row level security;
alter table public.requisiciones enable row level security;
alter table public.rol_permisos enable row level security;
alter table public.roles enable row level security;
alter table public.salidas_insumos enable row level security;
alter table public.solicitudes_equipo enable row level security;
alter table public.solicitudes_insumos enable row level security;
alter table public.solicitudes_mano_obra enable row level security;
alter table public.transporte_precios enable row level security;
alter table public.usuario_grupos enable row level security;
alter table public.usuario_proyectos enable row level security;

-- Políticas (public y storage).
create policy "autenticados leen y modifican apu" on public.apu as PERMISSIVE for ALL to public
  using ((( SELECT auth.uid() AS uid) IS NOT NULL))
  with check ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy "autenticados leen y modifican apu_import_revision" on public.apu_import_revision as PERMISSIVE for ALL to public
  using ((( SELECT auth.uid() AS uid) IS NOT NULL))
  with check ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy contratista_documentos_select on public.contratista_documentos as PERMISSIVE for SELECT to authenticated
  using ((( SELECT tiene_pestana(auth.uid(), 'contratos.contratistas'::text) AS tiene_pestana) OR ( SELECT tiene_pestana(auth.uid(), 'contratos.preaprobacion'::text) AS tiene_pestana) OR ( SELECT tiene_accion(auth.uid(), 'gestionar_contratistas'::text) AS tiene_accion) OR ( SELECT tiene_accion(auth.uid(), 'solicitar_contratos'::text) AS tiene_accion)));
create policy contratistas_select on public.contratistas as PERMISSIVE for SELECT to authenticated
  using ((( SELECT tiene_pestana(auth.uid(), 'contratos.contratistas'::text) AS tiene_pestana) OR ( SELECT tiene_pestana(auth.uid(), 'contratos.preaprobacion'::text) AS tiene_pestana) OR ( SELECT tiene_accion(auth.uid(), 'gestionar_contratistas'::text) AS tiene_accion) OR ( SELECT tiene_accion(auth.uid(), 'solicitar_contratos'::text) AS tiene_accion)));
create policy contrato_anexo_items_select on public.contrato_anexo_items as PERMISSIVE for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM contratos c
  WHERE (c.id = contrato_anexo_items.contrato_id))));
create policy contrato_documentos_select on public.contrato_documentos as PERMISSIVE for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM contratos c
  WHERE (c.id = contrato_documentos.contrato_id))));
create policy contrato_entregables_select on public.contrato_entregables as PERMISSIVE for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM contratos c
  WHERE (c.id = contrato_entregables.contrato_id))));
create policy contrato_obligaciones_select on public.contrato_obligaciones as PERMISSIVE for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM contratos c
  WHERE (c.id = contrato_obligaciones.contrato_id))));
create policy contratos_select on public.contratos as PERMISSIVE for SELECT to authenticated
  using (((( SELECT tiene_pestana(auth.uid(), 'contratos.solicitar'::text) AS tiene_pestana) OR ( SELECT tiene_pestana(auth.uid(), 'contratos.preaprobacion'::text) AS tiene_pestana) OR ( SELECT tiene_pestana(auth.uid(), 'contratos.contratos'::text) AS tiene_pestana)) AND (proyecto_id IN ( SELECT proyectos_visibles(( SELECT auth.uid() AS uid)) AS proyectos_visibles))));
create policy empresas_delete on public.empresas as PERMISSIVE for DELETE to public
  using (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin));
create policy empresas_insert on public.empresas as PERMISSIVE for INSERT to public
  with check (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin));
create policy empresas_select on public.empresas as PERMISSIVE for SELECT to public
  using ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy empresas_update on public.empresas as PERMISSIVE for UPDATE to public
  using (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin))
  with check (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin));
create policy empresas_cuentas_bancarias_delete on public.empresas_cuentas_bancarias as PERMISSIVE for DELETE to public
  using (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin));
create policy empresas_cuentas_bancarias_insert on public.empresas_cuentas_bancarias as PERMISSIVE for INSERT to public
  with check (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin));
create policy empresas_cuentas_bancarias_select on public.empresas_cuentas_bancarias as PERMISSIVE for SELECT to public
  using ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy empresas_cuentas_bancarias_update on public.empresas_cuentas_bancarias as PERMISSIVE for UPDATE to public
  using (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin))
  with check (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin));
create policy equipo_categorias_delete on public.equipo_categorias as PERMISSIVE for DELETE to authenticated
  using (( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'aprobar_mano_obra'::text) AS tiene_accion));
create policy equipo_categorias_insert on public.equipo_categorias as PERMISSIVE for INSERT to authenticated
  with check (( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'aprobar_mano_obra'::text) AS tiene_accion));
create policy equipo_categorias_select on public.equipo_categorias as PERMISSIVE for SELECT to authenticated
  using (true);
create policy equipo_categorias_update on public.equipo_categorias as PERMISSIVE for UPDATE to authenticated
  using (( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'aprobar_mano_obra'::text) AS tiene_accion))
  with check (( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'aprobar_mano_obra'::text) AS tiene_accion));
create policy "solo admin modifica grupo_proyectos" on public.grupo_proyectos as PERMISSIVE for ALL to public
  using (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin))
  with check (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin));
create policy "ver grupo_proyectos de los grupos propios, o admin" on public.grupo_proyectos as PERMISSIVE for SELECT to public
  using ((( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin) OR (EXISTS ( SELECT 1
   FROM usuario_grupos ug
  WHERE ((ug.usuario_id = ( SELECT auth.uid() AS uid)) AND (ug.grupo_id = grupo_proyectos.grupo_id))))));
create policy "cualquier autenticado lee grupos" on public.grupos as PERMISSIVE for SELECT to public
  using ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy "solo admin modifica grupos" on public.grupos as PERMISSIVE for ALL to public
  using (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin))
  with check (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin));
create policy "admin_insumos borra historico de precios" on public.historico_precios_compra as PERMISSIVE for DELETE to public
  using (( SELECT admin_insumos(( SELECT auth.uid() AS uid)) AS admin_insumos));
create policy "admin_insumos inserta historico de precios" on public.historico_precios_compra as PERMISSIVE for INSERT to public
  with check (( SELECT admin_insumos(( SELECT auth.uid() AS uid)) AS admin_insumos));
create policy "autenticados leen historico de precios" on public.historico_precios_compra as PERMISSIVE for SELECT to public
  using ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy informacion_bancaria_select on public.informacion_bancaria as PERMISSIVE for SELECT to public
  using ((( SELECT rol_compras(( SELECT auth.uid() AS uid)) AS rol_compras) OR ( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin)));
create policy "autenticados leen y modifican item_apu" on public.item_apu as PERMISSIVE for ALL to public
  using ((( SELECT auth.uid() AS uid) IS NOT NULL))
  with check ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy "admin_insumos inserta insumos" on public.maestro_insumos as PERMISSIVE for INSERT to public
  with check (( SELECT admin_insumos(( SELECT auth.uid() AS uid)) AS admin_insumos));
create policy "autenticados leen y crean insumos" on public.maestro_insumos as PERMISSIVE for SELECT to public
  using ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy maestro_insumos_update on public.maestro_insumos as PERMISSIVE for UPDATE to authenticated
  using (( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'aprobar_insumos'::text) AS tiene_accion))
  with check (( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'aprobar_insumos'::text) AS tiene_accion));
create policy "solo admin borra insumos" on public.maestro_insumos as PERMISSIVE for DELETE to public
  using (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin));
create policy mano_obra_categorias_delete on public.mano_obra_categorias as PERMISSIVE for DELETE to authenticated
  using (( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'aprobar_mano_obra'::text) AS tiene_accion));
create policy mano_obra_categorias_insert on public.mano_obra_categorias as PERMISSIVE for INSERT to authenticated
  with check (( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'aprobar_mano_obra'::text) AS tiene_accion));
create policy mano_obra_categorias_select on public.mano_obra_categorias as PERMISSIVE for SELECT to authenticated
  using (true);
create policy mano_obra_categorias_update on public.mano_obra_categorias as PERMISSIVE for UPDATE to authenticated
  using (( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'aprobar_mano_obra'::text) AS tiene_accion))
  with check (( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'aprobar_mano_obra'::text) AS tiene_accion));
create policy notificaciones_select_propias on public.notificaciones as PERMISSIVE for SELECT to public
  using ((usuario_id = ( SELECT auth.uid() AS uid)));
create policy notificaciones_update_propias on public.notificaciones as PERMISSIVE for UPDATE to public
  using ((usuario_id = ( SELECT auth.uid() AS uid)))
  with check ((usuario_id = ( SELECT auth.uid() AS uid)));
create policy ordenes_compra_insert on public.ordenes_compra as PERMISSIVE for INSERT to public
  with check ((( SELECT rol_compras(( SELECT auth.uid() AS uid)) AS rol_compras) AND (estado = 'pendiente_aprobacion'::text) AND (aprobada_por IS NULL) AND (aprobada_at IS NULL) AND (enviada = false) AND (motivo_rechazo IS NULL)));
create policy ordenes_compra_select on public.ordenes_compra as PERMISSIVE for SELECT to public
  using (( SELECT rol_compras(( SELECT auth.uid() AS uid)) AS rol_compras));
create policy ordenes_compra_select_proyecto on public.ordenes_compra as PERMISSIVE for SELECT to public
  using ((proyecto_id IN ( SELECT proyectos_visibles(( SELECT auth.uid() AS uid)) AS proyectos_visibles)));
create policy ordenes_compra_items_select on public.ordenes_compra_items as PERMISSIVE for SELECT to public
  using (( SELECT rol_compras(( SELECT auth.uid() AS uid)) AS rol_compras));
create policy ordenes_compra_items_select_proyecto on public.ordenes_compra_items as PERMISSIVE for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM ordenes_compra oc
  WHERE ((oc.id = ordenes_compra_items.orden_compra_id) AND (oc.proyecto_id IN ( SELECT proyectos_visibles(( SELECT auth.uid() AS uid)) AS proyectos_visibles))))));
create policy pedidos_insumos_insert on public.pedidos_insumos as PERMISSIVE for INSERT to public
  with check (((solicitado_por = ( SELECT auth.uid() AS uid)) AND (( SELECT admin_insumos(( SELECT auth.uid() AS uid)) AS admin_insumos) OR ( SELECT admin_proyectos(( SELECT auth.uid() AS uid)) AS admin_proyectos) OR (EXISTS ( SELECT 1
   FROM (presupuesto_items pi
     JOIN presupuestos p ON ((p.id = pi.presupuesto_id)))
  WHERE ((pi.id = pedidos_insumos.presupuesto_item_id) AND ((p.proyecto_id IN ( SELECT proyectos_visibles(( SELECT auth.uid() AS uid)) AS proyectos_visibles)) OR ((p.proyecto_id IS NULL) AND ( SELECT usuario_puede_ver_proyecto(( SELECT auth.uid() AS uid), NULL::uuid) AS usuario_puede_ver_proyecto)))))))));
create policy pedidos_insumos_select on public.pedidos_insumos as PERMISSIVE for SELECT to public
  using ((( SELECT admin_insumos(( SELECT auth.uid() AS uid)) AS admin_insumos) OR ( SELECT admin_proyectos(( SELECT auth.uid() AS uid)) AS admin_proyectos) OR (EXISTS ( SELECT 1
   FROM (presupuesto_items pi
     JOIN presupuestos p ON ((p.id = pi.presupuesto_id)))
  WHERE ((pi.id = pedidos_insumos.presupuesto_item_id) AND ((p.proyecto_id IN ( SELECT proyectos_visibles(( SELECT auth.uid() AS uid)) AS proyectos_visibles)) OR ((p.proyecto_id IS NULL) AND ( SELECT usuario_puede_ver_proyecto(( SELECT auth.uid() AS uid), NULL::uuid) AS usuario_puede_ver_proyecto))))))));
create policy pedidos_insumos_select_compras on public.pedidos_insumos as PERMISSIVE for SELECT to public
  using (( SELECT rol_compras(( SELECT auth.uid() AS uid)) AS rol_compras));
create policy pedidos_insumos_update on public.pedidos_insumos as PERMISSIVE for UPDATE to public
  using (( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'aprobar_pedidos'::text) AS tiene_accion));
create policy pedidos_insumos_update_compras on public.pedidos_insumos as PERMISSIVE for UPDATE to public
  using (((estado = 'aprobado'::text) AND ( SELECT rol_compras(( SELECT auth.uid() AS uid)) AS rol_compras)));
create policy perfiles_select_compras on public.perfiles as PERMISSIVE for SELECT to public
  using (( SELECT rol_compras(( SELECT auth.uid() AS uid)) AS rol_compras));
create policy "solo admin actualiza perfiles" on public.perfiles as PERMISSIVE for UPDATE to public
  using (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin))
  with check (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin));
create policy "solo admin borra perfiles" on public.perfiles as PERMISSIVE for DELETE to public
  using (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin));
create policy "solo admin crea perfiles" on public.perfiles as PERMISSIVE for INSERT to public
  with check (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin));
create policy "ver propio perfil o admin ve todos" on public.perfiles as PERMISSIVE for SELECT to public
  using (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin)));
create policy "editar items de presupuestos con permiso" on public.presupuesto_items as PERMISSIVE for ALL to public
  using ((EXISTS ( SELECT 1
   FROM presupuestos p
  WHERE ((p.id = presupuesto_items.presupuesto_id) AND ((p.proyecto_id IN ( SELECT proyectos_editables(( SELECT auth.uid() AS uid)) AS proyectos_editables)) OR ((p.proyecto_id IS NULL) AND ( SELECT usuario_puede_editar_proyecto(( SELECT auth.uid() AS uid), NULL::uuid) AS usuario_puede_editar_proyecto)))))))
  with check ((EXISTS ( SELECT 1
   FROM presupuestos p
  WHERE ((p.id = presupuesto_items.presupuesto_id) AND ((p.proyecto_id IN ( SELECT proyectos_editables(( SELECT auth.uid() AS uid)) AS proyectos_editables)) OR ((p.proyecto_id IS NULL) AND ( SELECT usuario_puede_editar_proyecto(( SELECT auth.uid() AS uid), NULL::uuid) AS usuario_puede_editar_proyecto)))))));
create policy "ver items de presupuestos permitidos" on public.presupuesto_items as PERMISSIVE for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM presupuestos p
  WHERE ((p.id = presupuesto_items.presupuesto_id) AND ((p.proyecto_id IN ( SELECT proyectos_visibles(( SELECT auth.uid() AS uid)) AS proyectos_visibles)) OR ((p.proyecto_id IS NULL) AND ( SELECT usuario_puede_ver_proyecto(( SELECT auth.uid() AS uid), NULL::uuid) AS usuario_puede_ver_proyecto)))))));
create policy "editar versiones de presupuestos con permiso" on public.presupuesto_versiones as PERMISSIVE for ALL to public
  using ((EXISTS ( SELECT 1
   FROM presupuestos p
  WHERE ((p.id = presupuesto_versiones.presupuesto_id) AND ((p.proyecto_id IN ( SELECT proyectos_editables(( SELECT auth.uid() AS uid)) AS proyectos_editables)) OR ((p.proyecto_id IS NULL) AND ( SELECT usuario_puede_editar_proyecto(( SELECT auth.uid() AS uid), NULL::uuid) AS usuario_puede_editar_proyecto)))))))
  with check ((EXISTS ( SELECT 1
   FROM presupuestos p
  WHERE ((p.id = presupuesto_versiones.presupuesto_id) AND ((p.proyecto_id IN ( SELECT proyectos_editables(( SELECT auth.uid() AS uid)) AS proyectos_editables)) OR ((p.proyecto_id IS NULL) AND ( SELECT usuario_puede_editar_proyecto(( SELECT auth.uid() AS uid), NULL::uuid) AS usuario_puede_editar_proyecto)))))));
create policy "ver versiones de presupuestos permitidos" on public.presupuesto_versiones as PERMISSIVE for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM presupuestos p
  WHERE ((p.id = presupuesto_versiones.presupuesto_id) AND ((p.proyecto_id IN ( SELECT proyectos_visibles(( SELECT auth.uid() AS uid)) AS proyectos_visibles)) OR ((p.proyecto_id IS NULL) AND ( SELECT usuario_puede_ver_proyecto(( SELECT auth.uid() AS uid), NULL::uuid) AS usuario_puede_ver_proyecto)))))));
create policy "editar presupuestos de proyectos con permiso" on public.presupuestos as PERMISSIVE for ALL to public
  using (((proyecto_id IN ( SELECT proyectos_editables(( SELECT auth.uid() AS uid)) AS proyectos_editables)) OR ((proyecto_id IS NULL) AND ( SELECT usuario_puede_editar_proyecto(( SELECT auth.uid() AS uid), NULL::uuid) AS usuario_puede_editar_proyecto))))
  with check (((proyecto_id IN ( SELECT proyectos_editables(( SELECT auth.uid() AS uid)) AS proyectos_editables)) OR ((proyecto_id IS NULL) AND ( SELECT usuario_puede_editar_proyecto(( SELECT auth.uid() AS uid), NULL::uuid) AS usuario_puede_editar_proyecto))));
create policy "ver presupuestos de proyectos permitidos" on public.presupuestos as PERMISSIVE for SELECT to public
  using (((proyecto_id IN ( SELECT proyectos_visibles(( SELECT auth.uid() AS uid)) AS proyectos_visibles)) OR ((proyecto_id IS NULL) AND ( SELECT usuario_puede_ver_proyecto(( SELECT auth.uid() AS uid), NULL::uuid) AS usuario_puede_ver_proyecto))));
create policy proveedores_insert on public.proveedores as PERMISSIVE for INSERT to authenticated
  with check (( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'editar_proveedores'::text) AS tiene_accion));
create policy proveedores_select on public.proveedores as PERMISSIVE for SELECT to public
  using ((( SELECT rol_compras(( SELECT auth.uid() AS uid)) AS rol_compras) OR ( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin)));
create policy proveedores_update on public.proveedores as PERMISSIVE for UPDATE to authenticated
  using (( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'editar_proveedores'::text) AS tiene_accion))
  with check (( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'editar_proveedores'::text) AS tiene_accion));
create policy proyectos_select_compras on public.proyectos as PERMISSIVE for SELECT to public
  using (( SELECT rol_compras(( SELECT auth.uid() AS uid)) AS rol_compras));
create policy "solo admin modifica proyectos" on public.proyectos as PERMISSIVE for ALL to public
  using (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin))
  with check (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin));
create policy "ver proyectos permitidos" on public.proyectos as PERMISSIVE for SELECT to public
  using ((id IN ( SELECT proyectos_visibles(( SELECT auth.uid() AS uid)) AS proyectos_visibles)));
create policy requisiciones_select on public.requisiciones as PERMISSIVE for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM pedidos_insumos p
  WHERE (p.grupo_pedido_id = requisiciones.id))));
create policy salidas_insumos_select on public.salidas_insumos as PERMISSIVE for SELECT to public
  using ((proyecto_id IN ( SELECT proyectos_visibles(( SELECT auth.uid() AS uid)) AS proyectos_visibles)));
create policy "admin_mano_obra resuelve solicitudes_equipo" on public.solicitudes_equipo as PERMISSIVE for UPDATE to public
  using (( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'aprobar_mano_obra'::text) AS tiene_accion));
create policy "autenticados crean sus propias solicitudes_equipo" on public.solicitudes_equipo as PERMISSIVE for INSERT to public
  with check (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (solicitado_por = ( SELECT auth.uid() AS uid))));
create policy "autenticados leen solicitudes_equipo" on public.solicitudes_equipo as PERMISSIVE for SELECT to public
  using ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy "admin_insumos actualiza solicitudes" on public.solicitudes_insumos as PERMISSIVE for UPDATE to public
  using (( SELECT admin_insumos(( SELECT auth.uid() AS uid)) AS admin_insumos))
  with check (( SELECT admin_insumos(( SELECT auth.uid() AS uid)) AS admin_insumos));
create policy "admin_insumos borra solicitudes" on public.solicitudes_insumos as PERMISSIVE for DELETE to public
  using (( SELECT admin_insumos(( SELECT auth.uid() AS uid)) AS admin_insumos));
create policy "autenticados crean solicitudes" on public.solicitudes_insumos as PERMISSIVE for INSERT to public
  with check ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy "autenticados ven solicitudes" on public.solicitudes_insumos as PERMISSIVE for SELECT to public
  using ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy "admin_mano_obra resuelve solicitudes_mano_obra" on public.solicitudes_mano_obra as PERMISSIVE for UPDATE to public
  using (( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'aprobar_mano_obra'::text) AS tiene_accion));
create policy "autenticados crean sus propias solicitudes_mano_obra" on public.solicitudes_mano_obra as PERMISSIVE for INSERT to public
  with check (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (solicitado_por = ( SELECT auth.uid() AS uid))));
create policy "autenticados leen solicitudes_mano_obra" on public.solicitudes_mano_obra as PERMISSIVE for SELECT to public
  using ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy "autenticados leen y modifican transporte_precios" on public.transporte_precios as PERMISSIVE for ALL to public
  using ((( SELECT auth.uid() AS uid) IS NOT NULL))
  with check ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy "solo admin modifica usuario_grupos" on public.usuario_grupos as PERMISSIVE for ALL to public
  using (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin))
  with check (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin));
create policy "ver los grupos propios, o admin ve todos" on public.usuario_grupos as PERMISSIVE for SELECT to public
  using (((usuario_id = ( SELECT auth.uid() AS uid)) OR ( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin)));
create policy "solo admin modifica usuario_proyectos" on public.usuario_proyectos as PERMISSIVE for ALL to public
  using (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin))
  with check (( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin));
create policy "ver los proyectos individuales propios, o admin" on public.usuario_proyectos as PERMISSIVE for SELECT to public
  using (((usuario_id = ( SELECT auth.uid() AS uid)) OR ( SELECT es_admin(( SELECT auth.uid() AS uid)) AS es_admin)));
create policy contratistas_archivos_delete on storage.objects as PERMISSIVE for DELETE to authenticated
  using (((bucket_id = 'contratistas'::text) AND ( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'gestionar_contratistas'::text) AS tiene_accion) AND (NOT (EXISTS ( SELECT 1
   FROM contratista_documentos d
  WHERE (d.ruta = objects.name))))));
create policy contratistas_archivos_insert on storage.objects as PERMISSIVE for INSERT to authenticated
  with check (((bucket_id = 'contratistas'::text) AND ( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'gestionar_contratistas'::text) AS tiene_accion)));
create policy contratistas_archivos_select on storage.objects as PERMISSIVE for SELECT to authenticated
  using (((bucket_id = 'contratistas'::text) AND (( SELECT tiene_pestana(auth.uid(), 'contratos.contratistas'::text) AS tiene_pestana) OR ( SELECT tiene_pestana(auth.uid(), 'contratos.preaprobacion'::text) AS tiene_pestana) OR ( SELECT tiene_accion(auth.uid(), 'gestionar_contratistas'::text) AS tiene_accion))));
create policy contratos_archivos_delete on storage.objects as PERMISSIVE for DELETE to authenticated
  using (((bucket_id = 'contratos'::text) AND ( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'solicitar_contratos'::text) AS tiene_accion) AND (NOT (EXISTS ( SELECT 1
   FROM contrato_documentos d
  WHERE (d.ruta = objects.name))))));
create policy contratos_archivos_insert on storage.objects as PERMISSIVE for INSERT to authenticated
  with check (((bucket_id = 'contratos'::text) AND ( SELECT tiene_accion(( SELECT auth.uid() AS uid), 'solicitar_contratos'::text) AS tiene_accion)));
create policy contratos_archivos_select on storage.objects as PERMISSIVE for SELECT to authenticated
  using (((bucket_id = 'contratos'::text) AND (EXISTS ( SELECT 1
   FROM contratos c
  WHERE ((c.id)::text = (storage.foldername(objects.name))[1])))));

-- Buckets de Storage.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('contratistas', 'contratistas', false, 10485760, '{application/pdf,image/jpeg,image/png}') on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('contratos', 'contratos', false, 10485760, '{application/pdf,image/jpeg,image/png}') on conflict (id) do nothing;

-- Permisos de ejecución de funciones. Supabase da EXECUTE a public/anon/authenticated
-- por defecto; esto deja solo lo que hay en producción.
revoke all on function _comprado_pedido(uuid) from public, anon;
grant execute on function _comprado_pedido(uuid) to authenticated;
revoke all on function _comprometido_insumo_item(uuid,uuid) from public, anon;
grant execute on function _comprometido_insumo_item(uuid,uuid) to authenticated;
revoke all on function _contratado_item(uuid,text) from public, anon, authenticated;
revoke all on function _disponible_insumo_proyecto(uuid,uuid) from public, anon, authenticated;
revoke all on function _evento_requisicion(uuid,text,text,jsonb) from public, anon, authenticated;
revoke all on function _exigir_administrador() from public, anon;
grant execute on function _exigir_administrador() to authenticated;
revoke all on function _guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean) from public, anon, authenticated;
revoke all on function _notificar_aprobadores_contrato(uuid,text,text) from public, anon, authenticated;
revoke all on function _puede_gestionar_entradas() from public, anon;
grant execute on function _puede_gestionar_entradas() to authenticated;
revoke all on function _recalcular_estado_entrega(uuid) from public, anon, authenticated;
revoke all on function _recibido_linea_oc(uuid) from public, anon, authenticated;
revoke all on function _registrar_salida_almacen(uuid,jsonb,text,text) from public, anon, authenticated;
revoke all on function _resumen_capitulos_proyecto_base(uuid) from public, anon, authenticated;
revoke all on function _resumen_ejecucion_proyecto(uuid) from public, anon, authenticated;
revoke all on function _resumen_ejecucion_proyecto_base(uuid) from public, anon, authenticated;
revoke all on function admin_insumos(uuid) from public, anon;
grant execute on function admin_insumos(uuid) to authenticated;
revoke all on function admin_proyectos(uuid) from public, anon;
grant execute on function admin_proyectos(uuid) to authenticated;
revoke all on function admin_usuarios(uuid) from public, anon;
grant execute on function admin_usuarios(uuid) to authenticated;
revoke all on function anular_entrada_almacen(uuid,text) from public, anon;
grant execute on function anular_entrada_almacen(uuid,text) to authenticated;
revoke all on function anular_salida_almacen(uuid,text) from public, anon;
grant execute on function anular_salida_almacen(uuid,text) to authenticated;
revoke all on function aprobar_orden_compra(uuid) from public, anon;
grant execute on function aprobar_orden_compra(uuid) to authenticated;
revoke all on function asignar_rol_usuario(uuid,uuid) from public, anon;
grant execute on function asignar_rol_usuario(uuid,uuid) to authenticated;
revoke all on function autocompletar_proyecto_id_pedido() from public, anon, authenticated;
revoke all on function buscar_equipo_candidatos(text,integer) from public, anon;
grant execute on function buscar_equipo_candidatos(text,integer) to authenticated;
revoke all on function buscar_insumos_candidatos(text,text[],integer) from public, anon;
grant execute on function buscar_insumos_candidatos(text,text[],integer) to authenticated;
revoke all on function buscar_insumos_candidatos_lote(text[],integer) from public, anon;
grant execute on function buscar_insumos_candidatos_lote(text[],integer) to authenticated;
revoke all on function buscar_insumos_presupuesto(uuid,text,integer) from public, anon;
grant execute on function buscar_insumos_presupuesto(uuid,text,integer) to authenticated;
revoke all on function buscar_items_apu_candidatos(text,integer) from public, anon;
grant execute on function buscar_items_apu_candidatos(text,integer) to authenticated;
revoke all on function buscar_mano_obra_candidatos(text,integer) from public, anon;
grant execute on function buscar_mano_obra_candidatos(text,integer) to authenticated;
revoke all on function cancelar_orden_compra(uuid,text) from public, anon;
grant execute on function cancelar_orden_compra(uuid,text) to authenticated;
revoke all on function cancelar_pedido(uuid,text) from public, anon;
grant execute on function cancelar_pedido(uuid,text) to authenticated;
revoke all on function cancelar_requisicion(uuid,text) from public, anon;
grant execute on function cancelar_requisicion(uuid,text) to authenticated;
revoke all on function completar_email_perfil() from public, anon, authenticated;
revoke all on function comprado_pedidos(uuid[]) from public, anon;
grant execute on function comprado_pedidos(uuid[]) to authenticated;
revoke all on function crear_contratista(uuid,jsonb,jsonb) from public, anon;
grant execute on function crear_contratista(uuid,jsonb,jsonb) to authenticated;
revoke all on function crear_orden_compra(uuid,uuid,text,date,text,text,text,text,text,text,jsonb) from public, anon;
grant execute on function crear_orden_compra(uuid,uuid,text,date,text,text,text,text,text,text,jsonb) to authenticated;
revoke all on function crear_requisicion(jsonb,date,boolean,text,text) from public, anon;
grant execute on function crear_requisicion(jsonb,date,boolean,text,text) to authenticated;
revoke all on function crear_rol(text) from public, anon;
grant execute on function crear_rol(text) to authenticated;
revoke all on function crear_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function crear_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;
revoke all on function desaprobar_orden_compra(uuid,text) from public, anon;
grant execute on function desaprobar_orden_compra(uuid,text) to authenticated;
revoke all on function desaprobar_pedido(uuid,text) from public, anon;
grant execute on function desaprobar_pedido(uuid,text) to authenticated;
revoke all on function desaprobar_requisicion(uuid,text) from public, anon;
grant execute on function desaprobar_requisicion(uuid,text) to authenticated;
revoke all on function detalle_orden_para_entrada(uuid) from public, anon;
grant execute on function detalle_orden_para_entrada(uuid) to authenticated;
revoke all on function disponible_insumo_item(uuid,uuid) from public, anon;
grant execute on function disponible_insumo_item(uuid,uuid) to authenticated;
revoke all on function disponible_insumos_items(uuid[],uuid[]) from public, anon;
grant execute on function disponible_insumos_items(uuid[],uuid[]) to authenticated;
revoke all on function documentos_tipo_contrato(text) from public;  -- en producción anon sí la puede ejecutar
grant execute on function documentos_tipo_contrato(text) to authenticated;
revoke all on function dv_nit(text) from public;  -- en producción anon sí la puede ejecutar
grant execute on function dv_nit(text) to authenticated;
revoke all on function editar_entrada_almacen(uuid,text,text,jsonb) from public, anon;
grant execute on function editar_entrada_almacen(uuid,text,text,jsonb) to authenticated;
revoke all on function editar_salida_almacen(uuid,numeric,text,text) from public, anon;
grant execute on function editar_salida_almacen(uuid,numeric,text,text) to authenticated;
revoke all on function eliminar_apu_huerfano() from public, anon, authenticated;
revoke all on function eliminar_rol(uuid) from public, anon;
grant execute on function eliminar_rol(uuid) to authenticated;
revoke all on function email_por_username(text) from public, anon, authenticated;
revoke all on function entradas_por_orden(uuid[]) from public, anon;
grant execute on function entradas_por_orden(uuid[]) to authenticated;
revoke all on function es_admin(uuid) from public, anon;
grant execute on function es_admin(uuid) to authenticated;
revoke all on function establecer_permiso_rol(uuid,text,boolean) from public, anon;
grant execute on function establecer_permiso_rol(uuid,text,boolean) to authenticated;
revoke all on function establecer_proyectos_usuario(uuid,boolean,uuid[]) from public, anon;
grant execute on function establecer_proyectos_usuario(uuid,boolean,uuid[]) to authenticated;
revoke all on function guardar_minuta_contrato(uuid,jsonb) from public, anon;
grant execute on function guardar_minuta_contrato(uuid,jsonb) to authenticated;
revoke all on function historial_entidad(text,uuid) from public, anon;
grant execute on function historial_entidad(text,uuid) to authenticated;
revoke all on function insumos_presupuesto_por_ids(uuid,uuid[]) from public, anon;
grant execute on function insumos_presupuesto_por_ids(uuid,uuid[]) to authenticated;
revoke all on function inventario_proyecto(uuid) from public, anon;
grant execute on function inventario_proyecto(uuid) to authenticated;
revoke all on function items_presupuesto_para_contrato(uuid) from public, anon;
grant execute on function items_presupuesto_para_contrato(uuid) to authenticated;
revoke all on function listar_ordenes_entradas(integer,text,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer) from public, anon;
grant execute on function listar_ordenes_entradas(integer,text,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer) to authenticated;
revoke all on function listar_ordenes_entradas(uuid,integer,text,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer) from public, anon;
grant execute on function listar_ordenes_entradas(uuid,integer,text,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer) to authenticated;
revoke all on function listar_ordenes_para_entrada(boolean,uuid) from public, anon;
grant execute on function listar_ordenes_para_entrada(boolean,uuid) to authenticated;
revoke all on function listar_roles_con_permisos() from public, anon;
grant execute on function listar_roles_con_permisos() to authenticated;
revoke all on function listar_salidas_proyecto(uuid) from public, anon;
grant execute on function listar_salidas_proyecto(uuid) to authenticated;
revoke all on function listar_usuarios_accesos() from public, anon;
grant execute on function listar_usuarios_accesos() to authenticated;
revoke all on function modificar_pedido(uuid,numeric,date,boolean,text) from public, anon;
grant execute on function modificar_pedido(uuid,numeric,date,boolean,text) to authenticated;
revoke all on function modificar_requisicion(uuid,jsonb,date,boolean,text) from public, anon;
grant execute on function modificar_requisicion(uuid,jsonb,date,boolean,text) to authenticated;
revoke all on function notificar_insumo_sobre_presupuesto() from public, anon, authenticated;
revoke all on function notificar_precio_sobre_efectivo_oc_item() from public, anon, authenticated;
revoke all on function notificar_resolucion_oc() from public, anon, authenticated;
revoke all on function notificar_resolucion_pedido() from public, anon, authenticated;
revoke all on function notificar_una(uuid,text,text,uuid,text,text) from public, anon, authenticated;
revoke all on function obtener_permisos_usuario(uuid) from public, anon;
grant execute on function obtener_permisos_usuario(uuid) to authenticated;
revoke all on function ordenes_compra_con_sobrecosto_precio(uuid[]) from public, anon;
grant execute on function ordenes_compra_con_sobrecosto_precio(uuid[]) to authenticated;
revoke all on function permisos_rol_usuario(uuid) from public, anon;
grant execute on function permisos_rol_usuario(uuid) to authenticated;
revoke all on function precio_promedio_compra_insumo(uuid) from public, anon, authenticated;
revoke all on function precios_efectivos_insumos(uuid[]) from public, anon;
grant execute on function precios_efectivos_insumos(uuid[]) to authenticated;
revoke all on function proyectos_editables(uuid) from public, anon;
grant execute on function proyectos_editables(uuid) to authenticated;
revoke all on function proyectos_visibles(uuid) from public, anon;
grant execute on function proyectos_visibles(uuid) to authenticated;
revoke all on function recalcular_valor_apu(uuid) from public, anon;
grant execute on function recalcular_valor_apu(uuid) to authenticated;
revoke all on function recalcular_valor_apus(uuid[]) from public, anon;
grant execute on function recalcular_valor_apus(uuid[]) to authenticated;
revoke all on function rechazar_orden_compra(uuid,text) from public, anon;
grant execute on function rechazar_orden_compra(uuid,text) to authenticated;
revoke all on function reenviar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function reenviar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;
revoke all on function registrar_entrada_almacen(uuid,text,text,jsonb) from public, anon;
grant execute on function registrar_entrada_almacen(uuid,text,text,jsonb) to authenticated;
revoke all on function registrar_salida_almacen(uuid,jsonb,text,text) from public, anon;
grant execute on function registrar_salida_almacen(uuid,jsonb,text,text) to authenticated;
revoke all on function resolver_requisicion(uuid,text,text) from public, anon;
grant execute on function resolver_requisicion(uuid,text,text) to authenticated;
revoke all on function resolver_solicitud_contrato(uuid,text,text) from public, anon;
grant execute on function resolver_solicitud_contrato(uuid,text,text) to authenticated;
revoke all on function resumen_capitulos_proyecto(uuid) from public, anon;
grant execute on function resumen_capitulos_proyecto(uuid) to authenticated;
revoke all on function resumen_ejecucion_proyecto(uuid) from public, anon;
grant execute on function resumen_ejecucion_proyecto(uuid) to authenticated;
revoke all on function rol_compras(uuid) from public, anon;
grant execute on function rol_compras(uuid) to authenticated;
revoke all on function sincronizar_apu_import_revision() from public, anon, authenticated;
revoke all on function sincronizar_apu_import_revision_equipo() from public, anon, authenticated;
revoke all on function sincronizar_apu_import_revision_mano_obra() from public, anon, authenticated;
revoke all on function sincronizar_email_perfil() from public, anon, authenticated;
revoke all on function test_fase1_compras() from public, anon, authenticated;
revoke all on function tiene_accion(uuid,text) from public, anon;
grant execute on function tiene_accion(uuid,text) to authenticated;
revoke all on function tiene_pestana(uuid,text) from public, anon;
grant execute on function tiene_pestana(uuid,text) to authenticated;
revoke all on function tiene_scope_admin(uuid,text) from public, anon;
grant execute on function tiene_scope_admin(uuid,text) to authenticated;
revoke all on function trg_historial_orden_compra() from public, anon, authenticated;
revoke all on function trg_historial_pedido() from public, anon, authenticated;
revoke all on function usuario_puede_editar_proyecto(uuid,uuid) from public, anon;
grant execute on function usuario_puede_editar_proyecto(uuid,uuid) to authenticated;
revoke all on function usuario_puede_ver_proyecto(uuid,uuid) from public, anon;
grant execute on function usuario_puede_ver_proyecto(uuid,uuid) to authenticated;
revoke all on function usuario_tiene_acceso_a_item(uuid) from public, anon;
grant execute on function usuario_tiene_acceso_a_item(uuid) to authenticated;
revoke all on function usuario_ve_todos_proyectos(uuid) from public, anon;
grant execute on function usuario_ve_todos_proyectos(uuid) to authenticated;
revoke all on function verificar_orden_compra_editable() from public, anon, authenticated;
revoke all on function verificar_proyecto_orden_compra() from public, anon, authenticated;
revoke all on function verificar_salida_no_supera_disponible() from public, anon, authenticated;
revoke all on function vincular_apus_masivo(jsonb) from public, anon;
grant execute on function vincular_apus_masivo(jsonb) to authenticated;

-- Permisos de tabla: anon y authenticated tienen los de Supabase por defecto
-- (DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE) en todas las tablas, salvo:
grant all on all tables in schema public to anon, authenticated;
grant usage on schema public to anon, authenticated;
revoke update on public.ordenes_compra from authenticated;
revoke delete, insert, update on public.requisiciones from authenticated;
