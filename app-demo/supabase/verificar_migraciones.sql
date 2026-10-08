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
) t
order by 1;
