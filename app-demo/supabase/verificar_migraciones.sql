-- Verifica en Supabase (SQL Editor) cuáles migraciones recientes ya están aplicadas.
-- No modifica nada: solo consulta. Cada fila dice si el objeto que crea (o quita)
-- esa migración existe en la base. `aplicada = true` en todas = no falta ninguna.
--
-- Las migraciones se ejecutan a mano (no hay registro en una tabla), por eso la
-- verificación mira los objetos: tablas, columnas, funciones y triggers.

select * from (
  select '20261004050000_logo_empresas' as migracion,
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'empresas' and column_name = 'logo_url') as aplicada
  union all
  select '20261006050000_registro_requisiciones_tab (necesita algún rol con la pestaña Elaboración de requisiciones)',
         exists (select 1 from public.rol_permisos where permiso = 'tab.tecnico.registro_pedidos')
  union all
  select '20261006150000_cancelar_pedido_solo_propio',
         exists (select 1 from pg_proc where proname = 'cancelar_pedido'
                 and pg_get_functiondef(oid) like '%solicitado_por is distinct from auth.uid()%')
  union all
  select '20261007000000_notificaciones_aprobacion_rechazo',
         exists (select 1 from pg_proc where proname = 'notificar_una')
         and exists (select 1 from pg_trigger where tgname = 'trg_notificar_resolucion_oc')
  union all
  select '20261007100000_quitar_notificaciones_duplicadas (los triggers viejos ya no deben existir)',
         not exists (select 1 from pg_trigger
                     where tgname in ('trg_notificar_pedido_rechazado', 'trg_notificar_pedido_rechazado_tecnico',
                                      'trg_notificar_orden_compra_rechazada'))
  union all
  select '20261008000000_requisiciones',
         exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'requisiciones')
         and exists (select 1 from information_schema.views where table_schema = 'public' and table_name = 'requisiciones_vista')
         and exists (select 1 from pg_proc where proname = 'crear_requisicion')
         and exists (select 1 from pg_proc where proname = 'resolver_requisicion')
         and exists (select 1 from pg_proc where proname = 'modificar_requisicion')
  union all
  select '20261009000000_quitar_enviada (marcar_orden_enviada ya no debe existir)',
         not exists (select 1 from pg_proc where proname = 'marcar_orden_enviada')
  union all
  select '20261010000000_entradas_por_orden',
         exists (select 1 from pg_proc where proname = 'entradas_por_orden')
  union all
  select '20261010100000_rendimiento_requisiciones (de Sofia)',
         exists (select 1 from pg_proc where proname = 'insumos_presupuesto_por_ids')
  union all
  select '20261011000000_revision_requisiciones (candado de cupo + comprado_pedidos con RLS)',
         exists (select 1 from pg_proc where proname = 'crear_requisicion'
                 and pg_get_functiondef(oid) like '%pg_advisory_xact_lock%')
         and exists (select 1 from pg_proc where proname = 'comprado_pedidos' and prosecdef = false)
  union all
  select '20261012000000_listar_ordenes_entradas',
         exists (select 1 from pg_proc where proname = 'listar_ordenes_entradas')
  union all
  select '20261015000000_minuta_contratos',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'contratos' and column_name = 'minuta_datos')
  union all
  select '20261016000001_solicitud_valor_mensual',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'contratos' and column_name = 'valor_mensual')
  union all
  select '20261017000001_acceso_proyecto_funciones',
         exists (select 1 from pg_proc where proname = '_resumen_ejecucion_proyecto')
         and exists (select 1 from pg_proc where proname = '_registrar_salida_almacen')
  union all
  select '20261024000000_requisiciones_y_almacen_por_proyecto (aplicar junto con el deploy)',
         exists (select 1 from pg_proc where proname = 'rechazar_pedido_compras')
         and exists (select 1 from pg_proc where proname = '_inventario_proyecto')
  union all
  select '20261025000000_unidades_presentacion',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'item_apu' and column_name = 'factor_unidad')
         and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'maestro_insumos' and column_name = 'contenido')
  union all
  select '20261026000000_unidades_compras',
         exists (select 1 from pg_trigger where tgname = 'trg_pedido_unidad_desde_apu')
  union all
  select '20261023000000_ayf_rls_initplan',
         exists (select 1 from pg_policies where tablename = 'terceros' and policyname = 'terceros_update'
                 and qual like '%( SELECT auth.uid() AS uid)%')
  union all
  select '20261027000000_redondeo_valor_total',
         exists (select 1 from pg_proc where proname = 'recalcular_valor_apus'
                 and pg_get_functiondef(oid) like '%round(t.total * pi.cantidad, 2)%')
  union all
  select '20261028000000_contratos_rls_initplan',
         exists (select 1 from pg_policies where tablename = 'contratistas' and policyname = 'contratistas_select'
                 and qual like '%( SELECT auth.uid() AS uid)%')
  union all
  select '20261028100000_pg_trgm_esquema_extensions (y las búsquedas con extensions en el search_path)',
         exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
                 where e.extname = 'pg_trgm' and n.nspname = 'extensions')
         and exists (select 1 from pg_proc where proname = 'buscar_insumos_candidatos_lote'
                     and array_to_string(proconfig, ',') like '%extensions%')
  union all
  select '20261101000000_volumen_inventario_y_solicitudes',
         exists (select 1 from pg_proc where proname = 'inventario_proyecto_completo')
         and exists (select 1 from pg_proc where proname = 'borrar_solicitud_resuelta')
         and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'apu_import_revision' and column_name = 'motivo_rechazo')
  union all
  select '20261102000000_pagos_programados_cron',
         exists (select 1 from pg_proc where proname = '_liberar_pagos_programados')
         and exists (select 1 from pg_extension where extname = 'pg_cron')
  union all
  select '20261103000000_import_presupuesto_abandonado',
         exists (select 1 from pg_proc where proname = 'descartar_import_abandonado')
         and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'presupuesto_versiones' and column_name = 'import_latido_at')
  union all
  select '20261104000000_salidas_registradas',
         exists (select 1 from pg_proc where proname = 'listar_salidas_registradas')
  union all
  select '20261105000000_saldo_programado_inmediato',
         exists (select 1 from pg_trigger where tgname = 'trg_pago_programado_vencido')
  union all
  select '20261106000000_import_abandonado_plazo',
         exists (select 1 from pg_proc where proname = 'descartar_import_abandonado'
                 and prosrc like '%2 minutes%')
  union all
  select '20261107000000_seguridad_apu',
         exists (select 1 from pg_policies where tablename = 'item_apu' and policyname = 'item_apu_insert')
         and not exists (select 1 from pg_policies where tablename = 'apu'
                         and policyname = 'autenticados leen y modifican apu')
  union all
  select '20261108000000_buscar_insumos_presupuesto_rapido',
         exists (select 1 from pg_proc where proname = 'buscar_insumos_presupuesto'
                 and prosrc like '%offset 0%')
  union all
  select '20261108100000_estado_requisiciones_guardado',
         exists (select 1 from pg_trigger where tgname = 'estado_req_pedidos_upd')
         and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'requisiciones' and column_name = 'estado_compra')
  union all
  select '20261109000000_datos_minuta_solicitud',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'contratos' and column_name = 'datos_tipo')
         and exists (select 1 from pg_proc where proname = 'crear_contratista' and prosrc like '%cedula_expedida_en%')
         and exists (select 1 from pg_proc where proname = '_guardar_solicitud_contrato' and prosrc like '%domicilio_departamento%')
  union all
  select '20261109100000_editar_contratista',
         exists (select 1 from pg_proc where proname = 'editar_contratista')
         and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'contratistas' and column_name = 'updated_by')
  union all
  select '20261110000000_actas_contratos',
         exists (select 1 from pg_proc where proname = 'crear_acta')
         and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'contratos' and column_name = 'numero_contrato')
  union all
  select '20261110100000_aprobacion_actas',
         -- (crear_acta se reescribió después: se mira lo que esta migración crea)
         exists (select 1 from pg_proc where proname = '_consumido_actas_contrato')
         and exists (select 1 from pg_proc where proname = 'listar_actas_aprobacion')
  union all
  select '20261110200000_editar_actas_avisos',
         -- (el aviso pasó de resolver_acta a _aprobar_acta en 20261112100000)
         exists (select 1 from pg_proc where proname = 'editar_acta')
         and exists (select 1 from pg_proc where proname in ('resolver_acta', '_aprobar_acta')
                     and prosrc like '%acta_aprobada%')
  union all
  select '20261110300000_editar_acta_solo_creador',
         exists (select 1 from pg_proc where proname = 'editar_acta' and prosrc like '%Solo quien hizo el acta%')
  union all
  select '20261111000000_aprobacion_minutas',
         exists (select 1 from pg_proc where proname = 'resolver_minuta_contrato')
         -- (la regla de minuta aprobada vive ahora en contrato_para_acta)
         and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'contratos' and column_name = 'minuta_estado')
         and exists (select 1 from roles where clave = 'subgerencia')
  union all
  select '20261111100000_preaprobar_y_enviar_minuta',
         exists (select 1 from pg_proc where proname = 'preaprobar_y_enviar_minuta')
  union all
  select '20261112000000_actas_sobre_contrato',
         exists (select 1 from pg_proc where proname = 'contrato_para_acta')
         and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'pagos' and column_name = 'acta_id')
  union all
  select '20261112100000_actas_aprobacion_por_pago',
         exists (select 1 from pg_trigger where tgname = 'trg_acta_sigue_pago')
  union all
  select '20261112200000_historial_actas_otra_vez',
         position('''acta''' in pg_get_functiondef('public.historial_entidad(text,uuid)'::regprocedure)) > 0
         and position('o.id <> v.id' in pg_get_functiondef('public.detalle_acta(uuid)'::regprocedure)) = 0
  union all
  select '20261112300000_acta_exige_factura',
         position('exige.' in pg_get_functiondef('public._pago_de_acta(uuid)'::regprocedure)) > 0
  union all
  select '20261112400000_rendimiento_rls_actas',
         exists (select 1 from pg_policies where tablename = 'actas' and policyname = 'actas_select'
                 and qual like '%proyectos_visibles%' and qual not like '%puede_ver_actas%')
  union all
  select '20261112000000_control_proyecto',
         exists (select 1 from pg_proc where proname = 'control_proyecto')
  union all
  select '20261112100000_visualizacion_ver_contratos',
         exists (select 1 from pg_policies where policyname = 'contratos_select' and qual like '%admin.visualizacion%')
  union all
  select '20261113000000_contratos_generales',
         exists (select 1 from pg_proc where proname = 'crear_contrato_general')
         and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'contratos' and column_name = 'clase')
  union all
  select '20261113100000_contratos_generales_tipo',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'contratos' and column_name = 'tipo_detalle')
  union all
  select '20261114000000_presupuesto_con_iva',
         exists (select 1 from pg_proc where proname = 'precios_presupuesto_insumos')
  union all
  select '20261114100000_maestro_iva_doble',
         exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'maestro_insumos_respaldo_iva_20261015')
  union all
  select '20261114200000_borrar_insumos_iva_dudoso',
         exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'respaldo_borrado_20261015')
  union all
  select '20261115000000_vr_neto_automatico',
         exists (select 1 from pg_trigger where tgname = 'maestro_insumos_vr_neto')
  union all
  select '20261115100000_seguridad_documentos_y_datos_bancarios',
         exists (select 1 from pg_proc where proname = 'datos_bancarios_contratistas')
         and exists (select 1 from pg_policies where policyname = 'contrato_documentos_select'
                     and qual like '%contratos.aprobar_minutas%')
  union all
  select '20261115200000_columnas_bancarias',
         not has_column_privilege('authenticated', 'public.contratistas', 'numero_cuenta', 'select')
  union all
  select '20261115300000_control_proyecto_excedentes',
         position('exc_lineas' in pg_get_functiondef('public.control_proyecto(uuid)'::regprocedure)) > 0
  union all
  select '20261116000000_insumo_rechazado_y_resolicitar_pago',
         exists (select 1 from pg_trigger where tgname = 'trg_notificar_insumo_rechazado')
         and exists (select 1 from pg_proc where proname = 'resolicitar_pago')
         and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'solicitudes_insumos' and column_name = 'cantidad')
  union all
  select '20261117000000_enviar_insumos_sin_sugerencias',
         exists (select 1 from pg_proc where proname = 'enviar_insumos_sin_sugerencias')
  union all
  select '20261117100000_recuperar_insumos_borrados',
         exists (select 1 from public.maestro_insumos where usuario_modificacion = 'recuperado 2026-10-18')
  union all
  select '20261118000000_solicitud_mano_obra_plantilla_04',
         position('in (''obra'', ''mano_obra'')' in pg_get_functiondef(
           'public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure)) > 0
  union all
  select '20261119000000_otrosis',
         to_regclass('public.otrosis') is not null
         and exists (select 1 from pg_proc where proname = 'resolver_otrosi')
         and exists (select 1 from public.rol_permisos where permiso = 'tab.contratos.aprobar_otrosi')
  union all
  select '20261120000000_ver_contrato_otrosi',
         exists (select 1 from pg_proc where proname = 'contrato_para_ver_otrosi')
) t
order by 1;
