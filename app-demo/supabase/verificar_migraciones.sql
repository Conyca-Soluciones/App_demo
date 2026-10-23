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
  select '20261118000000_perfiles_nombre_y_rol_visibles',
         exists (select 1 from pg_policies where tablename = 'perfiles' and policyname = 'perfiles_select_nombre_rol')
         and not has_column_privilege('authenticated', 'public.perfiles', 'email', 'select')
         and exists (select 1 from pg_policies where tablename = 'roles' and policyname = 'roles_select_autenticados')
  union all
  select '20261118100000_historial_pagos_terceros_proveedores',
         exists (select 1 from pg_trigger where tgname = 'trg_historial_pago')
         and exists (select 1 from pg_trigger where tgname = 'trg_historial_proveedor')
         and position('usuario_rol' in pg_get_functiondef('public.historial_entidad(text,uuid)'::regprocedure)) > 0
  union all
  select '20261118200000_historial_completo_y_auditoria',
         exists (select 1 from pg_proc where proname = 'listar_auditoria')
         and exists (select 1 from pg_trigger where tgname = 'trg_historial_contratista')
         and exists (select 1 from pg_trigger where tgname = 'trg_historial_usuario')
         and position('''contratista''' in pg_get_functiondef('public.historial_entidad(text,uuid)'::regprocedure)) > 0
  union all
  select '20261118300000_proveedores_lectura_minima',
         exists (select 1 from pg_policies where tablename = 'proveedores' and policyname = 'proveedores_select_de_ordenes')
         and not has_table_privilege('anon', 'public.proveedores', 'select')
  union all
  select '20261118400000_rls_minima_compras_almacen',
         exists (select 1 from pg_policies where tablename = 'ordenes_compra' and policyname = 'ordenes_compra_select_de_pagos')
  union all
  select '20261118410000_rls_minima_presupuestos_apu',
         exists (select 1 from pg_policies where tablename = 'presupuesto_items' and policyname = 'presupuesto_items_select_de_contratos')
         and not exists (select 1 from pg_policies where tablename = 'maestro_insumos' and policyname = 'autenticados leen y crean insumos')
  union all
  select '20261118420000_rls_minima_ayf_empresas',
         exists (select 1 from pg_policies where tablename = 'empresas_cuentas_bancarias'
                 and policyname = 'empresas_cuentas_bancarias_select' and qual like '%es_admin%')
  union all
  select '20261118430000_tablas_sin_anon',
         not has_table_privilege('anon', 'public.pagos', 'select')
  union all
  select '20261118500000_permisos_por_proyecto',
         not exists (select 1 from pg_policies where tablename = 'proyectos' and policyname = 'proyectos_select_compras')
         and exists (select 1 from pg_proc where proname = '_crear_orden_compra_sin_proyecto')
         and exists (select 1 from pg_proc where proname = '_exigir_proyecto')
  union all
  select '20261118600000_item_apu_por_proyecto_para_requisiciones',
         exists (select 1 from pg_policies where tablename = 'item_apu' and policyname = 'item_apu_select_de_requisiciones')
  union all
  select '20261118700000_contratistas_a_terceros',
         exists (select 1 from pg_trigger where tgname = 'trg_contratista_a_tercero')
         and exists (select 1 from pg_proc where proname = 'guardar_banco')
         and exists (select 1 from pg_policies where policyname = 'contratistas_certificacion_verificar')
  union all
  select '20261202000000_soportes_oc_actas_entradas',
         to_regclass('public.orden_compra_soportes') is not null
         and to_regclass('public.entrada_soportes') is not null
         and exists (select 1 from pg_proc where proname = 'crear_orden_compra_con_soporte')
         and not has_function_privilege('authenticated', 'public.crear_orden_compra(uuid,uuid,text,date,text,text,text,text,text,text,jsonb,numeric,text,date)', 'execute')
         and position('cuenta_cobro' in pg_get_functiondef('public._pago_de_acta(uuid)'::regprocedure)) > 0
  union all
  select '20261127000000_mis_pendientes',
         exists (select 1 from pg_proc where proname = 'mis_pendientes')
         and exists (select 1 from pg_proc where proname = 'contar_mis_pendientes')
         and not has_function_privilege('authenticated', 'public._pendientes_de(uuid)', 'execute')
  union all
  select '20261126000000_avance_anterior_actas_sin_porcentaje',
         position('coalesce(a.porcentaje_avance' in pg_get_functiondef('public.contrato_para_acta(uuid,uuid)'::regprocedure)) > 0
         and position('coalesce(o.porcentaje_avance' in pg_get_functiondef('public.detalle_acta(uuid)'::regprocedure)) > 0
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
  union all
  select '20261121000000_otrosis_en_contrato',
         exists (select 1 from pg_proc where proname = 'otrosis_de_contrato')
         and exists (select 1 from pg_proc where proname = 'otrosis_aprobados')
  union all
  select '20261122000000_historial_otrosis_en_contrato',
         exists (select 1 from pg_proc where proname = 'historial_otrosis_de_contrato')
  union all
  select '20261123000000_otrosi_prorroga_y_valor',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'otrosis' and column_name = 'nueva_fecha_fin')
         and exists (select 1 from pg_proc where proname = '_validar_prorroga_otrosi')
         and exists (select 1 from pg_proc where proname = '_valor_contrato')
  union all
  select '20261124000000_tope_mano_obra_y_actividades_otrosi',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'otrosis' and column_name = 'actividades')
         and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'contrato_anexo_items' and column_name = 'otrosi_id')
         and exists (select 1 from pg_proc where proname = 'actividades_para_otrosi')
  union all
  select '20261125000000_control_proyecto_valor_vigente',
         exists (select 1 from pg_proc where proname = 'control_proyecto'
                  and pg_get_functiondef(oid) like '%_valor_contrato(c.id)%')
  union all
  select '20261126000000_polizas',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'contratos' and column_name = 'poliza_estado')
         and exists (select 1 from pg_proc where proname = 'resolver_poliza')
         and exists (select 1 from pg_trigger where tgname = 'trg_poliza_al_aprobar_minuta')
         and exists (select 1 from pg_proc where proname = 'contrato_para_acta'
                  and pg_get_functiondef(oid) like '%poliza_estado%')
  union all
  select '20261127000000_acta_poliza',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'contrato_polizas' and column_name = 'acta_datos')
         and exists (select 1 from pg_proc where proname = 'guardar_acta_poliza')
  union all
  select '20261128000000_contrato_para_acta_poliza_y_avance',
         position('poliza_estado' in pg_get_functiondef('public.contrato_para_acta(uuid,uuid)'::regprocedure)) > 0
         and position('coalesce(a.porcentaje_avance' in pg_get_functiondef('public.contrato_para_acta(uuid,uuid)'::regprocedure)) > 0
  union all
  select '20261129000000_firmas',
         to_regclass('public.firmas_usuario') is not null
         and to_regclass('public.documentos_firmados') is not null
         and exists (select 1 from pg_trigger where tgname = 'trg_firmar_poliza_aprobada')
         and exists (select 1 from pg_proc where proname = 'subir_acta_firmada_contratista')
         and exists (select 1 from storage.buckets where id = 'documentos_firmados')
  union all
  select '20261130000000_pendientes_firma_y_polizas',
         exists (select 1 from pg_proc where proname = '_pendientes_de'
                  and pg_get_functiondef(oid) like '%mi_firma%' and pg_get_functiondef(oid) like '%poliza_por_revisar%')
  union all
  select '20261130100000_firmas_ordenes_compra',
         exists (select 1 from pg_trigger where tgname = 'trg_firmar_oc_aprobada')
         and exists (select 1 from pg_proc where proname = '_pendientes_de' and pg_get_functiondef(oid) like '%or public.tiene_accion(p_uid, ''aprobar_oc'')%')
  union all
  select '20261201000000_representantes_legales',
         to_regclass('public.empresa_representantes') is not null
         and exists (select 1 from pg_trigger where tgname = 'trg_firmar_representante_contrato')
         and exists (select 1 from pg_proc where proname = 'guardar_firma_representante')
  union all
  select '20261202000000_requisiciones_administrativas',
         to_regclass('public.requisiciones_admin') is not null
         and exists (select 1 from pg_proc where proname = 'listar_requisiciones_admin')
         and exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'pagos' and column_name = 'requisicion_admin_item_id')
         and exists (select 1 from pg_proc where proname = '_pendientes_de' and pg_get_functiondef(oid) like '%req_admin_por_aprobar%')
  union all
  select '20261203000000_requisiciones_admin_aprobacion_conjunta',
         exists (select 1 from pg_proc where proname = 'aprobar_requisicion_admin')
         and exists (select 1 from pg_proc where proname = 'lote_requisicion_admin')
         and not exists (select 1 from pg_proc where proname = 'resolver_requisicion_admin')
         and position('requisicion_admin_id is not null' in pg_get_functiondef('public.aprobar_pago(uuid)'::regprocedure)) > 0
  union all
  select '20261204000000_oc_se_aprueba_en_pagos',
         exists (select 1 from pg_trigger where tgname = 'trg_oc_sigue_pago')
         and position('A&F' in pg_get_functiondef('public.aprobar_orden_compra(uuid)'::regprocedure)) > 0
         and not exists (select 1 from public.rol_permisos where permiso in ('accion.aprobar_oc', 'tab.compras.aprobar_oc'))
  union all
  select '20261205000000_remisiones_entradas_visibles',
         exists (select 1 from pg_policy where polname = 'entradas_almacen_select')
  union all
  select '20261206000000_cuenta_cambiada_en_pagos',
         exists (select 1 from pg_trigger where tgname = 'trg_cuenta_tercero_sigue_pagos')
         and exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'pagos' and column_name = 'cuenta_modificada')
  union all
  select '20261207000000_apu_por_proyecto',
         exists (select 1 from pg_proc where proname = '_apus_de_proyectos_ajenos')
         and exists (select 1 from pg_policy where polname = 'item_apu_update'
                      and pg_get_expr(polqual, polrelid) like '%_apus_de_proyectos_ajenos%')
  union all
  select '20261208000000_poliza_segun_solicitud',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'contratos' and column_name = 'requiere_poliza')
         and position('no_aplica' in pg_get_functiondef('public._guardar_acta(uuid,uuid,jsonb)'::regprocedure)) > 0
  union all
  select '20261209000000_requisicion_exige_pestana',
         position('tecnico.pedidos' in pg_get_functiondef('public.crear_requisicion(jsonb,date,boolean,text,text)'::regprocedure)) > 0
  union all
  select '20261209100000_contratos_sin_poliza_existentes',
         not exists (select 1 from public.contratos
                      where numero_contrato in ('CJ-10-2026', 'CJ-1-2026') and poliza_estado in ('pendiente', 'recibida'))
  union all
  -- 20261203000000/20261203100000/20261204000000 (liquidación de pagos) los
  -- deshace 20261205000000: cuentan como aplicadas si ya se quitaron.
  select '20261205000000_quitar_liquidacion_pagos',
         exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'respaldo_liquidacion_20261022')
         and not exists (select 1 from pg_proc where proname = 'liquidar_pago')
  union all
  select '20261210000000_consolidados_separados',
         exists (select 1 from pg_proc where proname = '_consolidados_visibles')
         and not exists (select 1 from public.rol_permisos where permiso = 'tab.ayf.consolidado')
  union all
  select '20261211000000_roles_contabilidad',
         exists (select 1 from public.roles where clave = 'contabilidad_bogota')
         and exists (select 1 from public.roles where clave = 'contabilidad_barranquilla')
  union all
  select '20261212000000_consolidado_gerencia',
         exists (select 1 from pg_proc where proname = 'opciones_consolidado_gerencia')
         and exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'requisicion_admin_items' and column_name = 'soporte_ruta')
         and exists (select 1 from storage.buckets where id = 'requisiciones_admin')
  union all
  select '20261213000000_soporte_req_admin_obligatorio',
         exists (select 1 from pg_proc where proname = '_validar_soporte_req_admin'
                    and prosrc like '%adjunta el soporte%')
  union all
  select '20261214000000_titular_cuenta_pagos',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pagos' and column_name = 'titular_tercero_id')
         and exists (select 1 from pg_proc where proname = 'crear_orden_compra_con_soporte'
                        and pg_get_function_identity_arguments(oid) like '%p_titular%')
         and exists (select 1 from pg_proc where proname = 'crear_acta' and prosrc like '%_fijar_titular_acta%')
  union all
  select '20261215000000_liquidacion_consolidado',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pagos' and column_name = 'liquidacion_estado')
         and exists (select 1 from pg_proc where proname = 'liquidar_pagos_lote')
         and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'pago_comentarios')
) t
order by 1;
