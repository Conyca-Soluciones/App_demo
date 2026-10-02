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
) t
order by 1;
