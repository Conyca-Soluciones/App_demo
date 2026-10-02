-- ---------------------------------------------------------------------------
-- Esquema REAL de la base de producción (proyecto Supabase "App-demo"),
-- sacado con solo lectura el 2026-10-02. Ver supabase/esquema/README.md.
-- No es una migración: no aplicar sobre la base real.
-- ---------------------------------------------------------------------------

-- Restricciones: PK, UNIQUE, CHECK y FK (en ese orden).
-- Van después de las funciones porque contratistas_nit_dv usa public.dv_nit().
alter table public.apu add constraint apu_pkey PRIMARY KEY (id);
alter table public.apu_import_revision add constraint apu_import_revision_pkey PRIMARY KEY (id);
alter table public.contratista_documentos add constraint contratista_documentos_pkey PRIMARY KEY (id);
alter table public.contratistas add constraint contratistas_pkey PRIMARY KEY (id);
alter table public.contrato_anexo_items add constraint contrato_anexo_items_pkey PRIMARY KEY (id);
alter table public.contrato_documentos add constraint contrato_documentos_pkey PRIMARY KEY (id);
alter table public.contrato_entregables add constraint contrato_entregables_pkey PRIMARY KEY (id);
alter table public.contrato_obligaciones add constraint contrato_obligaciones_pkey PRIMARY KEY (id);
alter table public.contratos add constraint contratos_pkey PRIMARY KEY (id);
alter table public.empresas add constraint empresas_pkey PRIMARY KEY (id);
alter table public.empresas_cuentas_bancarias add constraint empresas_cuentas_bancarias_pkey PRIMARY KEY (id);
alter table public.entradas_almacen add constraint entradas_almacen_pkey PRIMARY KEY (id);
alter table public.entradas_almacen_items add constraint entradas_almacen_items_pkey PRIMARY KEY (id);
alter table public.equipo_categorias add constraint equipo_categorias_pkey PRIMARY KEY (id);
alter table public.grupo_proyectos add constraint grupo_proyectos_pkey PRIMARY KEY (grupo_id, proyecto_id);
alter table public.grupos add constraint grupos_pkey PRIMARY KEY (id);
alter table public.historial_eventos add constraint historial_eventos_pkey PRIMARY KEY (id);
alter table public.historico_precios_compra add constraint historico_precios_compra_pkey PRIMARY KEY (id);
alter table public.informacion_bancaria add constraint informacion_bancaria_pkey PRIMARY KEY (id);
alter table public.item_apu add constraint item_apu_pkey PRIMARY KEY (id);
alter table public.maestro_insumos add constraint maestro_insumos_pkey PRIMARY KEY (id);
alter table public.mano_obra_categorias add constraint mano_obra_categorias_pkey PRIMARY KEY (id);
alter table public.notificaciones add constraint notificaciones_pkey PRIMARY KEY (id);
alter table public.ordenes_compra add constraint ordenes_compra_pkey PRIMARY KEY (id);
alter table public.ordenes_compra_items add constraint ordenes_compra_items_pkey PRIMARY KEY (id);
alter table public.pedidos_insumos add constraint pedidos_insumos_pkey PRIMARY KEY (id);
alter table public.perfiles add constraint perfiles_pkey PRIMARY KEY (id);
alter table public.presupuesto_items add constraint presupuesto_items_pkey PRIMARY KEY (id);
alter table public.presupuesto_versiones add constraint presupuesto_versiones_pkey PRIMARY KEY (id);
alter table public.presupuestos add constraint presupuestos_pkey PRIMARY KEY (id);
alter table public.proveedores add constraint proveedor_pkey PRIMARY KEY (unique_id);
alter table public.proyectos add constraint proyectos_pkey PRIMARY KEY (id);
alter table public.requisiciones add constraint requisiciones_pkey PRIMARY KEY (id);
alter table public.rol_permisos add constraint rol_permisos_pkey PRIMARY KEY (rol_id, permiso);
alter table public.roles add constraint roles_pkey PRIMARY KEY (id);
alter table public.salidas_insumos add constraint salidas_insumos_pkey PRIMARY KEY (id);
alter table public.solicitudes_equipo add constraint solicitudes_equipo_pkey PRIMARY KEY (id);
alter table public.solicitudes_insumos add constraint solicitudes_insumos_pkey PRIMARY KEY (id);
alter table public.solicitudes_mano_obra add constraint solicitudes_mano_obra_pkey PRIMARY KEY (id);
alter table public.transporte_precios add constraint transporte_precios_pkey PRIMARY KEY (id);
alter table public.usuario_grupos add constraint usuario_grupos_pkey PRIMARY KEY (usuario_id, grupo_id);
alter table public.usuario_proyectos add constraint usuario_proyectos_pkey PRIMARY KEY (usuario_id, proyecto_id);
alter table public.contratista_documentos add constraint contratista_documentos_ruta_key UNIQUE (ruta);
alter table public.contratista_documentos add constraint contratista_documentos_tipo_unico UNIQUE (contratista_id, tipo);
alter table public.contratistas add constraint contratistas_documento_unico UNIQUE (tipo_documento, numero_documento);
alter table public.contrato_anexo_items add constraint contrato_anexo_items_contrato_id_orden_key UNIQUE (contrato_id, orden);
alter table public.contrato_documentos add constraint contrato_documentos_contrato_id_tipo_key UNIQUE (contrato_id, tipo);
alter table public.contrato_documentos add constraint contrato_documentos_ruta_key UNIQUE (ruta);
alter table public.contrato_entregables add constraint contrato_entregables_contrato_id_orden_key UNIQUE (contrato_id, orden);
alter table public.contrato_obligaciones add constraint contrato_obligaciones_contrato_id_orden_key UNIQUE (contrato_id, orden);
alter table public.contratos add constraint contratos_numero_key UNIQUE (numero);
alter table public.grupos add constraint grupos_nombre_key UNIQUE (nombre);
alter table public.maestro_insumos add constraint maestro_insumos_codigo_key UNIQUE (codigo);
alter table public.ordenes_compra add constraint ordenes_compra_numero_key UNIQUE (numero);
alter table public.ordenes_compra_items add constraint ordenes_compra_items_orden_compra_id_pedido_insumo_id_key UNIQUE (orden_compra_id, pedido_insumo_id);
alter table public.pedidos_insumos add constraint pedidos_insumos_codigo_consecutivo_key UNIQUE (codigo_consecutivo);
alter table public.perfiles add constraint perfiles_username_key UNIQUE (username);
alter table public.presupuesto_versiones add constraint presupuesto_versiones_presupuesto_id_numero_key UNIQUE (presupuesto_id, numero);
alter table public.presupuestos add constraint presupuestos_proyecto_id_unique UNIQUE (proyecto_id);
alter table public.requisiciones add constraint requisiciones_numero_key UNIQUE (numero);
alter table public.roles add constraint roles_clave_key UNIQUE (clave);
alter table public.transporte_precios add constraint transporte_precios_revision_unica UNIQUE (apu_import_revision_id);
alter table public.apu_import_revision add constraint apu_import_revision_estado_check CHECK ((estado = ANY (ARRAY['auto_match'::text, 'pendiente'::text, 'solicitud_pendiente'::text, 'resuelto'::text, 'rechazado'::text])));
alter table public.contratista_documentos add constraint contratista_documentos_tamano_check CHECK ((tamano > 0));
alter table public.contratista_documentos add constraint contratista_documentos_tipo_check CHECK ((tipo = ANY (ARRAY['cedula'::text, 'rut'::text, 'certificacion_bancaria'::text, 'hoja_vida'::text, 'autorizacion_datos'::text, 'camara_comercio'::text, 'cedula_representante'::text, 'consulta_oficial_cumplimiento'::text])));
alter table public.contratistas add constraint contratistas_banco_check CHECK ((length(TRIM(BOTH FROM banco)) > 0));
alter table public.contratistas add constraint contratistas_ciudad_check CHECK ((length(TRIM(BOTH FROM ciudad)) > 0));
alter table public.contratistas add constraint contratistas_correo_check CHECK ((correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text));
alter table public.contratistas add constraint contratistas_digito_verificacion_check CHECK (((digito_verificacion >= 0) AND (digito_verificacion <= 9)));
alter table public.contratistas add constraint contratistas_direccion_check CHECK ((length(TRIM(BOTH FROM direccion)) > 0));
alter table public.contratistas add constraint contratistas_juridica_nit CHECK (((tipo_persona = 'juridica'::text) = (tipo_documento = 'NIT'::text)));
alter table public.contratistas add constraint contratistas_nit_dv CHECK (((tipo_documento <> 'NIT'::text) OR ((digito_verificacion IS NOT NULL) AND (numero_documento ~ '^[0-9]{5,15}$'::text) AND (digito_verificacion = dv_nit(numero_documento)))));
alter table public.contratistas add constraint contratistas_nombre_check CHECK ((length(TRIM(BOTH FROM nombre)) >= 3));
alter table public.contratistas add constraint contratistas_numero_cuenta_check CHECK ((numero_cuenta ~ '^[0-9]{4,20}$'::text));
alter table public.contratistas add constraint contratistas_numero_documento_check CHECK ((numero_documento ~ '^[0-9A-Z]{3,20}$'::text));
alter table public.contratistas add constraint contratistas_representante CHECK (((tipo_persona <> 'juridica'::text) OR ((length(TRIM(BOTH FROM COALESCE(representante_nombre, ''::text))) >= 3) AND (representante_tipo_documento IS NOT NULL) AND (representante_numero_documento IS NOT NULL))));
alter table public.contratistas add constraint contratistas_representante_numero_documento_check CHECK ((representante_numero_documento ~ '^[0-9A-Z]{3,20}$'::text));
alter table public.contratistas add constraint contratistas_representante_tipo_documento_check CHECK ((representante_tipo_documento = ANY (ARRAY['CC'::text, 'CE'::text, 'PPT'::text, 'PA'::text])));
alter table public.contratistas add constraint contratistas_telefono_check CHECK ((telefono ~ '^\+?[0-9]{7,15}$'::text));
alter table public.contratistas add constraint contratistas_tipo_cuenta_check CHECK ((tipo_cuenta = ANY (ARRAY['ahorros'::text, 'corriente'::text])));
alter table public.contratistas add constraint contratistas_tipo_documento_check CHECK ((tipo_documento = ANY (ARRAY['CC'::text, 'CE'::text, 'PPT'::text, 'PA'::text, 'NIT'::text])));
alter table public.contratistas add constraint contratistas_tipo_persona_check CHECK ((tipo_persona = ANY (ARRAY['natural'::text, 'juridica'::text])));
alter table public.contrato_anexo_items add constraint contrato_anexo_items_actividad_check CHECK ((length(TRIM(BOTH FROM actividad)) > 0));
alter table public.contrato_anexo_items add constraint contrato_anexo_items_cantidad_check CHECK ((cantidad > (0)::numeric));
alter table public.contrato_anexo_items add constraint contrato_anexo_items_unidad_check CHECK ((length(TRIM(BOTH FROM unidad)) > 0));
alter table public.contrato_anexo_items add constraint contrato_anexo_items_valor_unitario_check CHECK ((valor_unitario > (0)::numeric));
alter table public.contrato_documentos add constraint contrato_documentos_tamano_check CHECK ((tamano > 0));
alter table public.contrato_documentos add constraint contrato_documentos_tipo_check CHECK ((tipo = ANY (ARRAY['planilla_seguridad_social'::text, 'certificado_alturas'::text, 'certificado_competencia_laboral'::text, 'cronograma_actividades'::text, 'cotizacion_aprobada'::text, 'polizas'::text, 'relacion_personal'::text, 'certificado_tradicion_libertad'::text, 'autorizacion_propietario'::text, 'tarjeta_propiedad'::text, 'revision_tecnicomecanica'::text, 'soat'::text, 'licencia_conduccion'::text, 'tarjeta_profesional'::text, 'certificado_eps'::text, 'cotizacion'::text])));
alter table public.contrato_entregables add constraint contrato_entregables_texto_check CHECK ((length(TRIM(BOTH FROM texto)) > 0));
alter table public.contrato_obligaciones add constraint contrato_obligaciones_texto_check CHECK ((length(TRIM(BOTH FROM texto)) > 0));
alter table public.contratos add constraint contratos_anexo_tipo_check CHECK ((anexo_tipo = ANY (ARRAY['valor_global'::text, 'valores_unitarios'::text])));
alter table public.contratos add constraint contratos_anticipo CHECK (((tiene_anticipo AND (anticipo_porcentaje IS NOT NULL)) OR ((NOT tiene_anticipo) AND (anticipo_porcentaje IS NULL))));
alter table public.contratos add constraint contratos_anticipo_porcentaje_check CHECK (((anticipo_porcentaje > (0)::numeric) AND (anticipo_porcentaje <= (100)::numeric)));
alter table public.contratos add constraint contratos_correo_notificacion_check CHECK ((correo_notificacion ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text));
alter table public.contratos add constraint contratos_duracion_cantidad_check CHECK ((duracion_cantidad > 0));
alter table public.contratos add constraint contratos_duracion_unidad_check CHECK ((duracion_unidad = ANY (ARRAY['dias'::text, 'meses'::text])));
alter table public.contratos add constraint contratos_estado_check CHECK ((estado = ANY (ARRAY['pre_aprobacion'::text, 'devuelta'::text, 'rechazada'::text, 'aprobada'::text])));
alter table public.contratos add constraint contratos_forma_pago_check CHECK ((length(TRIM(BOTH FROM forma_pago)) > 0));
alter table public.contratos add constraint contratos_objeto_check CHECK ((objeto ~* '^\s*[a-záéíóúñü]+(ar|er|ir)\M'::text));
alter table public.contratos add constraint contratos_plazo CHECK ((((plazo_tipo = 'fechas'::text) AND (fecha_inicio IS NOT NULL) AND (fecha_fin IS NOT NULL) AND (fecha_fin >= fecha_inicio) AND (duracion_cantidad IS NULL) AND (duracion_unidad IS NULL)) OR ((plazo_tipo = 'duracion'::text) AND (duracion_cantidad IS NOT NULL) AND (duracion_unidad IS NOT NULL) AND (fecha_fin IS NULL))));
alter table public.contratos add constraint contratos_plazo_tipo_check CHECK ((plazo_tipo = ANY (ARRAY['fechas'::text, 'duracion'::text])));
alter table public.contratos add constraint contratos_tipo_check CHECK ((tipo = ANY (ARRAY['mano_obra'::text, 'obra'::text, 'arrendamiento'::text, 'alquiler_vehiculo'::text, 'prestacion_servicios'::text, 'suministro_instalacion'::text])));
alter table public.contratos add constraint contratos_valor_check CHECK ((valor > (0)::numeric));
alter table public.contratos add constraint contratos_valor_mensual_check CHECK ((valor_mensual > (0)::numeric));
alter table public.entradas_almacen_items add constraint entradas_almacen_items_cantidad_check CHECK ((cantidad > (0)::numeric));
alter table public.historial_eventos add constraint historial_eventos_entidad_tipo_check CHECK ((entidad_tipo = ANY (ARRAY['orden_compra'::text, 'pedido'::text, 'requisicion'::text, 'contrato'::text])));
alter table public.historico_precios_compra add constraint historico_precios_compra_iva_monto_check CHECK ((iva_monto >= (0)::numeric));
alter table public.historico_precios_compra add constraint historico_precios_compra_porcentaje_descuento_check CHECK (((porcentaje_descuento >= (0)::numeric) AND (porcentaje_descuento < (100)::numeric)));
alter table public.historico_precios_compra add constraint historico_precios_compra_precio_unitario_check CHECK ((precio_unitario > (0)::numeric));
alter table public.item_apu add constraint item_apu_recurso_unico_check CHECK ((num_nonnulls(insumo_id, mano_obra_categoria_id, porcentaje_mano_obra, equipo_categoria_id, transporte_precio_id) = 1));
alter table public.notificaciones add constraint notificaciones_entidad_tipo_check CHECK ((entidad_tipo = ANY (ARRAY['pedido_insumo'::text, 'orden_compra'::text, 'requisicion'::text, 'contrato'::text]))) NOT VALID;
alter table public.notificaciones add constraint notificaciones_tipo_check CHECK ((tipo = ANY (ARRAY['pedido_rechazado'::text, 'pedido_aprobado'::text, 'orden_compra_rechazada'::text, 'orden_compra_aprobada'::text, 'insumo_sobre_presupuesto'::text, 'orden_compra_precio_sobre_efectivo'::text, 'contrato_por_revisar'::text, 'contrato_aprobado'::text, 'contrato_devuelto'::text, 'contrato_rechazado'::text]))) NOT VALID;
alter table public.ordenes_compra add constraint ordenes_compra_enviada_requiere_aprobada CHECK (((NOT enviada) OR (estado = ANY (ARRAY['aprobada'::text, 'cancelada'::text]))));
alter table public.ordenes_compra add constraint ordenes_compra_estado_check CHECK ((estado = ANY (ARRAY['pendiente_aprobacion'::text, 'aprobada'::text, 'rechazada'::text, 'cancelada'::text])));
alter table public.ordenes_compra add constraint ordenes_compra_estado_entrega_check CHECK ((estado_entrega = ANY (ARRAY['sin_entregar'::text, 'entrega_parcial'::text, 'entregada'::text])));
alter table public.ordenes_compra_items add constraint ordenes_compra_items_cantidad_check CHECK ((cantidad > (0)::numeric));
alter table public.ordenes_compra_items add constraint ordenes_compra_items_porcentaje_descuento_check CHECK (((porcentaje_descuento >= (0)::numeric) AND (porcentaje_descuento <= (100)::numeric)));
alter table public.ordenes_compra_items add constraint ordenes_compra_items_porcentaje_iva_check CHECK (((porcentaje_iva >= (0)::numeric) AND (porcentaje_iva <= (100)::numeric)));
alter table public.ordenes_compra_items add constraint ordenes_compra_items_precio_unitario_check CHECK ((precio_unitario >= (0)::numeric));
alter table public.pedidos_insumos add constraint cantidad_comprar_no_excede_pedido CHECK (((cantidad_comprar IS NULL) OR (cantidad_comprar <= cantidad)));
alter table public.pedidos_insumos add constraint pedidos_insumos_cantidad_check CHECK ((cantidad > (0)::numeric));
alter table public.pedidos_insumos add constraint pedidos_insumos_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobado'::text, 'rechazado'::text, 'cancelado'::text])));
alter table public.presupuestos add constraint presupuestos_estado_check CHECK ((estado = ANY (ARRAY['Borrador'::text, 'En ejecucion'::text, 'Con movimientos'::text])));
alter table public.proveedores add constraint proveedores_estado_check CHECK ((estado = ANY (ARRAY['ACTIVO'::text, 'INACTIVO'::text])));
alter table public.proveedores add constraint proveedores_tipo_proveedor_check CHECK ((tipo_proveedor = ANY (ARRAY['NO DIRECTO'::text, 'DIRECTO PRECIO'::text, 'DIRECTO CREDITO'::text, 'DIRECTO'::text])));
alter table public.rol_permisos add constraint rol_permisos_permiso_check CHECK ((permiso ~ '^(tab|accion)\.[a-z0-9_.]+$'::text));
alter table public.salidas_insumos add constraint salidas_insumos_cantidad_check CHECK ((cantidad > (0)::numeric));
alter table public.solicitudes_equipo add constraint solicitudes_equipo_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobado'::text, 'rechazado'::text])));
alter table public.solicitudes_insumos add constraint solicitudes_insumos_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobado'::text, 'rechazado'::text])));
alter table public.solicitudes_mano_obra add constraint solicitudes_mano_obra_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobado'::text, 'rechazado'::text])));
alter table public.apu_import_revision add constraint apu_import_revision_apu_id_fkey FOREIGN KEY (apu_id) REFERENCES apu(id) ON DELETE CASCADE;
alter table public.apu_import_revision add constraint apu_import_revision_equipo_categoria_id_asignado_fkey FOREIGN KEY (equipo_categoria_id_asignado) REFERENCES equipo_categorias(id) ON DELETE SET NULL;
alter table public.apu_import_revision add constraint apu_import_revision_insumo_id_asignado_fkey FOREIGN KEY (insumo_id_asignado) REFERENCES maestro_insumos(id) ON DELETE SET NULL;
alter table public.apu_import_revision add constraint apu_import_revision_item_apu_id_fkey FOREIGN KEY (item_apu_id) REFERENCES item_apu(id) ON DELETE SET NULL;
alter table public.apu_import_revision add constraint apu_import_revision_mano_obra_categoria_id_asignado_fkey FOREIGN KEY (mano_obra_categoria_id_asignado) REFERENCES mano_obra_categorias(id) ON DELETE SET NULL;
alter table public.apu_import_revision add constraint apu_import_revision_presupuesto_item_id_fkey FOREIGN KEY (presupuesto_item_id) REFERENCES presupuesto_items(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.apu_import_revision add constraint apu_import_revision_solicitud_equipo_id_fkey FOREIGN KEY (solicitud_equipo_id) REFERENCES solicitudes_equipo(id) ON DELETE SET NULL;
alter table public.apu_import_revision add constraint apu_import_revision_solicitud_id_fkey FOREIGN KEY (solicitud_id) REFERENCES solicitudes_insumos(id) ON DELETE SET NULL;
alter table public.apu_import_revision add constraint apu_import_revision_solicitud_mano_obra_id_fkey FOREIGN KEY (solicitud_mano_obra_id) REFERENCES solicitudes_mano_obra(id) ON DELETE SET NULL;
alter table public.contratista_documentos add constraint contratista_documentos_contratista_id_fkey FOREIGN KEY (contratista_id) REFERENCES contratistas(id) ON DELETE CASCADE;
alter table public.contratista_documentos add constraint contratista_documentos_subido_por_fkey FOREIGN KEY (subido_por) REFERENCES perfiles(id);
alter table public.contratistas add constraint contratistas_created_by_fkey FOREIGN KEY (created_by) REFERENCES perfiles(id);
alter table public.contrato_anexo_items add constraint contrato_anexo_items_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES contratos(id) ON DELETE CASCADE;
alter table public.contrato_anexo_items add constraint contrato_anexo_items_presupuesto_item_id_fkey FOREIGN KEY (presupuesto_item_id) REFERENCES presupuesto_items(id);
alter table public.contrato_documentos add constraint contrato_documentos_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES contratos(id) ON DELETE CASCADE;
alter table public.contrato_documentos add constraint contrato_documentos_subido_por_fkey FOREIGN KEY (subido_por) REFERENCES perfiles(id);
alter table public.contrato_entregables add constraint contrato_entregables_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES contratos(id) ON DELETE CASCADE;
alter table public.contrato_obligaciones add constraint contrato_obligaciones_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES contratos(id) ON DELETE CASCADE;
alter table public.contratos add constraint contratos_contratista_id_fkey FOREIGN KEY (contratista_id) REFERENCES contratistas(id);
alter table public.contratos add constraint contratos_minuta_actualizada_por_fkey FOREIGN KEY (minuta_actualizada_por) REFERENCES perfiles(id);
alter table public.contratos add constraint contratos_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES proyectos(id);
alter table public.contratos add constraint contratos_resuelto_por_fkey FOREIGN KEY (resuelto_por) REFERENCES perfiles(id);
alter table public.contratos add constraint contratos_solicitado_por_fkey FOREIGN KEY (solicitado_por) REFERENCES perfiles(id);
alter table public.empresas_cuentas_bancarias add constraint empresas_cuentas_bancarias_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;
alter table public.entradas_almacen add constraint entradas_almacen_anulada_por_fkey FOREIGN KEY (anulada_por) REFERENCES perfiles(id);
alter table public.entradas_almacen add constraint entradas_almacen_editada_por_fkey FOREIGN KEY (editada_por) REFERENCES perfiles(id);
alter table public.entradas_almacen add constraint entradas_almacen_orden_compra_id_fkey FOREIGN KEY (orden_compra_id) REFERENCES ordenes_compra(id);
alter table public.entradas_almacen add constraint entradas_almacen_recibido_por_fkey FOREIGN KEY (recibido_por) REFERENCES perfiles(id);
alter table public.entradas_almacen_items add constraint entradas_almacen_items_entrada_id_fkey FOREIGN KEY (entrada_id) REFERENCES entradas_almacen(id) ON DELETE CASCADE;
alter table public.entradas_almacen_items add constraint entradas_almacen_items_orden_compra_item_id_fkey FOREIGN KEY (orden_compra_item_id) REFERENCES ordenes_compra_items(id);
alter table public.grupo_proyectos add constraint grupo_proyectos_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE CASCADE;
alter table public.grupo_proyectos add constraint grupo_proyectos_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE;
alter table public.historial_eventos add constraint historial_eventos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES perfiles(id) ON DELETE SET NULL;
alter table public.historico_precios_compra add constraint historico_precios_compra_insumo_id_fkey FOREIGN KEY (insumo_id) REFERENCES maestro_insumos(id) ON DELETE CASCADE;
alter table public.informacion_bancaria add constraint informacion_bancaria_id_fkey FOREIGN KEY (id) REFERENCES proveedores(unique_id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.item_apu add constraint item_apu_apu_id_fkey FOREIGN KEY (apu_id) REFERENCES apu(id) ON DELETE CASCADE;
alter table public.item_apu add constraint item_apu_equipo_categoria_id_fkey FOREIGN KEY (equipo_categoria_id) REFERENCES equipo_categorias(id) ON DELETE CASCADE;
alter table public.item_apu add constraint item_apu_insumo_id_fkey FOREIGN KEY (insumo_id) REFERENCES maestro_insumos(id);
alter table public.item_apu add constraint item_apu_mano_obra_categoria_id_fkey FOREIGN KEY (mano_obra_categoria_id) REFERENCES mano_obra_categorias(id) ON DELETE CASCADE;
alter table public.item_apu add constraint item_apu_transporte_precio_id_fkey FOREIGN KEY (transporte_precio_id) REFERENCES transporte_precios(id) ON DELETE CASCADE;
alter table public.notificaciones add constraint notificaciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES perfiles(id);
alter table public.ordenes_compra add constraint ordenes_compra_aprobada_por_fkey FOREIGN KEY (aprobada_por) REFERENCES perfiles(id);
alter table public.ordenes_compra add constraint ordenes_compra_cancelada_por_fkey FOREIGN KEY (cancelada_por) REFERENCES perfiles(id);
alter table public.ordenes_compra add constraint ordenes_compra_created_by_fkey FOREIGN KEY (created_by) REFERENCES perfiles(id);
alter table public.ordenes_compra add constraint ordenes_compra_desaprobada_por_fkey FOREIGN KEY (desaprobada_por) REFERENCES perfiles(id);
alter table public.ordenes_compra add constraint ordenes_compra_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(unique_id);
alter table public.ordenes_compra add constraint ordenes_compra_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.ordenes_compra_items add constraint ordenes_compra_items_orden_compra_id_fkey FOREIGN KEY (orden_compra_id) REFERENCES ordenes_compra(id) ON DELETE CASCADE;
alter table public.ordenes_compra_items add constraint ordenes_compra_items_pedido_insumo_id_fkey FOREIGN KEY (pedido_insumo_id) REFERENCES pedidos_insumos(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.pedidos_insumos add constraint pedidos_insumos_cancelado_por_fkey FOREIGN KEY (cancelado_por) REFERENCES perfiles(id);
alter table public.pedidos_insumos add constraint pedidos_insumos_desaprobado_por_fkey FOREIGN KEY (desaprobado_por) REFERENCES perfiles(id);
alter table public.pedidos_insumos add constraint pedidos_insumos_insumo_id_fkey FOREIGN KEY (insumo_id) REFERENCES maestro_insumos(id);
alter table public.pedidos_insumos add constraint pedidos_insumos_item_apu_id_fkey FOREIGN KEY (item_apu_id) REFERENCES item_apu(id);
alter table public.pedidos_insumos add constraint pedidos_insumos_orden_compra_id_fkey FOREIGN KEY (orden_compra_id) REFERENCES ordenes_compra(id);
alter table public.pedidos_insumos add constraint pedidos_insumos_presupuesto_item_id_fkey FOREIGN KEY (presupuesto_item_id) REFERENCES presupuesto_items(id);
alter table public.pedidos_insumos add constraint pedidos_insumos_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE;
alter table public.pedidos_insumos add constraint pedidos_insumos_rechazado_compras_por_fkey FOREIGN KEY (rechazado_compras_por) REFERENCES perfiles(id);
alter table public.pedidos_insumos add constraint pedidos_insumos_requisicion_fkey FOREIGN KEY (grupo_pedido_id) REFERENCES requisiciones(id);
alter table public.pedidos_insumos add constraint pedidos_insumos_resuelto_por_fkey FOREIGN KEY (resuelto_por) REFERENCES perfiles(id);
alter table public.pedidos_insumos add constraint pedidos_insumos_solicitado_por_fkey FOREIGN KEY (solicitado_por) REFERENCES perfiles(id);
alter table public.perfiles add constraint perfiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.perfiles add constraint perfiles_rol_id_fkey FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE SET NULL;
alter table public.presupuesto_items add constraint presupuesto_items_apu_id_fkey FOREIGN KEY (apu_id) REFERENCES apu(id);
alter table public.presupuesto_items add constraint presupuesto_items_padre_id_fkey FOREIGN KEY (padre_id) REFERENCES presupuesto_items(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.presupuesto_items add constraint presupuesto_items_presupuesto_id_fkey FOREIGN KEY (presupuesto_id) REFERENCES presupuestos(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.presupuesto_items add constraint presupuesto_items_version_id_fkey FOREIGN KEY (version_id) REFERENCES presupuesto_versiones(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.presupuesto_versiones add constraint presupuesto_versiones_presupuesto_id_fkey FOREIGN KEY (presupuesto_id) REFERENCES presupuestos(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.presupuestos add constraint presupuestos_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE;
alter table public.presupuestos add constraint presupuestos_version_actual_id_fkey FOREIGN KEY (version_actual_id) REFERENCES presupuesto_versiones(id);
alter table public.proyectos add constraint proyectos_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id);
alter table public.requisiciones add constraint requisiciones_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES proyectos(id);
alter table public.requisiciones add constraint requisiciones_solicitado_por_fkey FOREIGN KEY (solicitado_por) REFERENCES perfiles(id);
alter table public.rol_permisos add constraint rol_permisos_rol_id_fkey FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE CASCADE;
alter table public.salidas_insumos add constraint salidas_insumos_anulada_por_fkey FOREIGN KEY (anulada_por) REFERENCES perfiles(id);
alter table public.salidas_insumos add constraint salidas_insumos_editada_por_fkey FOREIGN KEY (editada_por) REFERENCES perfiles(id);
alter table public.salidas_insumos add constraint salidas_insumos_insumo_id_fkey FOREIGN KEY (insumo_id) REFERENCES maestro_insumos(id);
alter table public.salidas_insumos add constraint salidas_insumos_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE;
alter table public.salidas_insumos add constraint salidas_insumos_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES perfiles(id);
alter table public.solicitudes_equipo add constraint solicitudes_equipo_categoria_asignada_id_fkey FOREIGN KEY (categoria_asignada_id) REFERENCES equipo_categorias(id);
alter table public.solicitudes_equipo add constraint solicitudes_equipo_presupuesto_item_id_fkey FOREIGN KEY (presupuesto_item_id) REFERENCES presupuesto_items(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.solicitudes_equipo add constraint solicitudes_equipo_resuelto_por_fkey FOREIGN KEY (resuelto_por) REFERENCES perfiles(id);
alter table public.solicitudes_equipo add constraint solicitudes_equipo_solicitado_por_fkey FOREIGN KEY (solicitado_por) REFERENCES perfiles(id);
alter table public.solicitudes_insumos add constraint solicitudes_insumos_presupuesto_item_id_fkey FOREIGN KEY (presupuesto_item_id) REFERENCES presupuesto_items(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.solicitudes_insumos add constraint solicitudes_insumos_resuelto_por_fkey FOREIGN KEY (resuelto_por) REFERENCES auth.users(id);
alter table public.solicitudes_insumos add constraint solicitudes_insumos_solicitado_por_fkey FOREIGN KEY (solicitado_por) REFERENCES auth.users(id);
alter table public.solicitudes_mano_obra add constraint solicitudes_mano_obra_categoria_asignada_id_fkey FOREIGN KEY (categoria_asignada_id) REFERENCES mano_obra_categorias(id);
alter table public.solicitudes_mano_obra add constraint solicitudes_mano_obra_presupuesto_item_id_fkey FOREIGN KEY (presupuesto_item_id) REFERENCES presupuesto_items(id) ON DELETE CASCADE;
alter table public.solicitudes_mano_obra add constraint solicitudes_mano_obra_resuelto_por_fkey FOREIGN KEY (resuelto_por) REFERENCES perfiles(id);
alter table public.solicitudes_mano_obra add constraint solicitudes_mano_obra_solicitado_por_fkey FOREIGN KEY (solicitado_por) REFERENCES perfiles(id);
alter table public.transporte_precios add constraint transporte_precios_apu_import_revision_id_fkey FOREIGN KEY (apu_import_revision_id) REFERENCES apu_import_revision(id);
alter table public.transporte_precios add constraint transporte_precios_cargado_por_fkey FOREIGN KEY (cargado_por) REFERENCES perfiles(id);
alter table public.transporte_precios add constraint transporte_precios_presupuesto_item_id_fkey FOREIGN KEY (presupuesto_item_id) REFERENCES presupuesto_items(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.transporte_precios add constraint transporte_precios_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE;
alter table public.usuario_grupos add constraint usuario_grupos_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE CASCADE;
alter table public.usuario_grupos add constraint usuario_grupos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.usuario_proyectos add constraint usuario_proyectos_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE;
alter table public.usuario_proyectos add constraint usuario_proyectos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Índices que no salen de una restricción.
CREATE INDEX idx_apu_import_revision_apu_id ON public.apu_import_revision USING btree (apu_id);
CREATE INDEX idx_apu_import_revision_equipo_asignado ON public.apu_import_revision USING btree (equipo_categoria_id_asignado);
CREATE INDEX idx_apu_import_revision_insumo_asignado ON public.apu_import_revision USING btree (insumo_id_asignado);
CREATE INDEX idx_apu_import_revision_item ON public.apu_import_revision USING btree (presupuesto_item_id);
CREATE INDEX idx_apu_import_revision_item_apu_id ON public.apu_import_revision USING btree (item_apu_id);
CREATE INDEX idx_apu_import_revision_lote ON public.apu_import_revision USING btree (lote_import_id);
CREATE INDEX idx_apu_import_revision_mo_asignado ON public.apu_import_revision USING btree (mano_obra_categoria_id_asignado);
CREATE INDEX idx_apu_import_revision_solicitud ON public.apu_import_revision USING btree (solicitud_id);
CREATE INDEX idx_apu_import_revision_solicitud_equipo ON public.apu_import_revision USING btree (solicitud_equipo_id);
CREATE INDEX idx_apu_import_revision_solicitud_mo ON public.apu_import_revision USING btree (solicitud_mano_obra_id);
CREATE INDEX idx_contratista_documentos_subido_por ON public.contratista_documentos USING btree (subido_por);
CREATE INDEX idx_contratistas_created_by ON public.contratistas USING btree (created_by);
CREATE INDEX idx_contratistas_nombre ON public.contratistas USING btree (nombre);
CREATE INDEX idx_contrato_anexo_items_presupuesto_item ON public.contrato_anexo_items USING btree (presupuesto_item_id);
CREATE INDEX idx_contrato_documentos_subido_por ON public.contrato_documentos USING btree (subido_por);
CREATE INDEX idx_contratos_contratista ON public.contratos USING btree (contratista_id);
CREATE INDEX idx_contratos_estado ON public.contratos USING btree (estado);
CREATE INDEX idx_contratos_minuta_actualizada_por ON public.contratos USING btree (minuta_actualizada_por);
CREATE INDEX idx_contratos_proyecto_created ON public.contratos USING btree (proyecto_id, created_at DESC);
CREATE INDEX idx_contratos_resuelto_por ON public.contratos USING btree (resuelto_por);
CREATE INDEX idx_contratos_solicitado_por ON public.contratos USING btree (solicitado_por);
CREATE INDEX idx_empresas_cuentas_bancarias_empresa_id ON public.empresas_cuentas_bancarias USING btree (empresa_id);
CREATE UNIQUE INDEX idx_empresas_cuentas_bancarias_preferencial_unica ON public.empresas_cuentas_bancarias USING btree (empresa_id) WHERE preferencial;
CREATE INDEX entradas_almacen_orden_idx ON public.entradas_almacen USING btree (orden_compra_id);
CREATE INDEX idx_entradas_almacen_anulada_por ON public.entradas_almacen USING btree (anulada_por);
CREATE INDEX idx_entradas_almacen_editada_por ON public.entradas_almacen USING btree (editada_por);
CREATE INDEX idx_entradas_almacen_recibido_por ON public.entradas_almacen USING btree (recibido_por);
CREATE INDEX entradas_almacen_items_entrada_idx ON public.entradas_almacen_items USING btree (entrada_id);
CREATE INDEX entradas_almacen_items_oc_item_idx ON public.entradas_almacen_items USING btree (orden_compra_item_id);
CREATE INDEX idx_equipo_categorias_categoria_gist ON public.equipo_categorias USING gist (categoria gist_trgm_ops);
CREATE INDEX idx_equipo_categorias_categoria_trgm ON public.equipo_categorias USING gin (categoria gin_trgm_ops);
CREATE INDEX idx_grupo_proyectos_proyecto_id ON public.grupo_proyectos USING btree (proyecto_id);
CREATE INDEX historial_eventos_entidad_idx ON public.historial_eventos USING btree (entidad_tipo, entidad_id, created_at);
CREATE INDEX idx_historial_eventos_usuario_id ON public.historial_eventos USING btree (usuario_id);
CREATE INDEX idx_historico_precios_compra_fecha ON public.historico_precios_compra USING btree (fecha_compra);
CREATE INDEX idx_historico_precios_compra_insumo ON public.historico_precios_compra USING btree (insumo_id);
CREATE INDEX idx_item_apu_apu_id ON public.item_apu USING btree (apu_id);
CREATE INDEX idx_item_apu_equipo_categoria_id ON public.item_apu USING btree (equipo_categoria_id);
CREATE INDEX idx_item_apu_insumo_id ON public.item_apu USING btree (insumo_id);
CREATE INDEX idx_item_apu_mano_obra_categoria_id ON public.item_apu USING btree (mano_obra_categoria_id);
CREATE INDEX idx_item_apu_transporte_precio_id ON public.item_apu USING btree (transporte_precio_id);
CREATE INDEX idx_maestro_insumos_codigo_trgm ON public.maestro_insumos USING gin (((codigo)::text) gin_trgm_ops);
CREATE INDEX idx_maestro_insumos_descripcion_gist ON public.maestro_insumos USING gist (descripcion gist_trgm_ops);
CREATE INDEX maestro_insumos_descripcion_trgm_idx ON public.maestro_insumos USING gin (descripcion gin_trgm_ops);
CREATE INDEX idx_mano_obra_categorias_categoria_gist ON public.mano_obra_categorias USING gist (categoria gist_trgm_ops);
CREATE INDEX idx_mano_obra_categorias_categoria_trgm ON public.mano_obra_categorias USING gin (categoria gin_trgm_ops);
CREATE INDEX idx_notificaciones_usuario_created_at ON public.notificaciones USING btree (usuario_id, created_at DESC);
CREATE INDEX idx_notificaciones_usuario_no_leidas ON public.notificaciones USING btree (usuario_id) WHERE (leida = false);
CREATE INDEX idx_ordenes_compra_aprobada_por ON public.ordenes_compra USING btree (aprobada_por);
CREATE INDEX idx_ordenes_compra_cancelada_por ON public.ordenes_compra USING btree (cancelada_por);
CREATE INDEX idx_ordenes_compra_created_by ON public.ordenes_compra USING btree (created_by);
CREATE INDEX idx_ordenes_compra_desaprobada_por ON public.ordenes_compra USING btree (desaprobada_por);
CREATE INDEX idx_ordenes_compra_estado ON public.ordenes_compra USING btree (estado);
CREATE INDEX idx_ordenes_compra_proveedor_id ON public.ordenes_compra USING btree (proveedor_id);
CREATE INDEX idx_ordenes_compra_proyecto_id ON public.ordenes_compra USING btree (proyecto_id);
CREATE INDEX idx_ordenes_compra_items_pedido_insumo_id ON public.ordenes_compra_items USING btree (pedido_insumo_id);
CREATE INDEX idx_pedidos_insumos_cancelado_por ON public.pedidos_insumos USING btree (cancelado_por);
CREATE INDEX idx_pedidos_insumos_created_at ON public.pedidos_insumos USING btree (created_at);
CREATE INDEX idx_pedidos_insumos_desaprobado_por ON public.pedidos_insumos USING btree (desaprobado_por);
CREATE INDEX idx_pedidos_insumos_fecha_requerida ON public.pedidos_insumos USING btree (fecha_requerida);
CREATE INDEX idx_pedidos_insumos_insumo ON public.pedidos_insumos USING btree (insumo_id);
CREATE INDEX idx_pedidos_insumos_item_apu_id ON public.pedidos_insumos USING btree (item_apu_id);
CREATE INDEX idx_pedidos_insumos_item_insumo_comprometido ON public.pedidos_insumos USING btree (presupuesto_item_id, insumo_id) WHERE (estado = ANY (ARRAY['pendiente'::text, 'aprobado'::text]));
CREATE INDEX idx_pedidos_insumos_observaciones_trgm ON public.pedidos_insumos USING gin (observaciones gin_trgm_ops);
CREATE INDEX idx_pedidos_insumos_orden_compra_id ON public.pedidos_insumos USING btree (orden_compra_id);
CREATE INDEX idx_pedidos_insumos_pendientes ON public.pedidos_insumos USING btree (created_at DESC) WHERE (estado = 'pendiente'::text);
CREATE INDEX idx_pedidos_insumos_presupuesto_item ON public.pedidos_insumos USING btree (presupuesto_item_id);
CREATE INDEX idx_pedidos_insumos_proyecto_id ON public.pedidos_insumos USING btree (proyecto_id);
CREATE INDEX idx_pedidos_insumos_rechazado_compras_por ON public.pedidos_insumos USING btree (rechazado_compras_por);
CREATE INDEX idx_pedidos_insumos_resuelto_at ON public.pedidos_insumos USING btree (resuelto_at);
CREATE INDEX idx_pedidos_insumos_resuelto_por ON public.pedidos_insumos USING btree (resuelto_por);
CREATE INDEX idx_pedidos_insumos_solicitado_por ON public.pedidos_insumos USING btree (solicitado_por, created_at DESC);
CREATE INDEX pedidos_insumos_grupo_idx ON public.pedidos_insumos USING btree (grupo_pedido_id);
CREATE INDEX idx_perfiles_nombre_trgm ON public.perfiles USING gin (nombre gin_trgm_ops);
CREATE INDEX idx_perfiles_rol_id ON public.perfiles USING btree (rol_id);
CREATE INDEX idx_presupuesto_items_apu_id ON public.presupuesto_items USING btree (apu_id);
CREATE INDEX idx_presupuesto_items_codigo ON public.presupuesto_items USING btree (presupuesto_id, codigo text_pattern_ops);
CREATE INDEX idx_presupuesto_items_codigo_trgm ON public.presupuesto_items USING gin (codigo gin_trgm_ops);
CREATE INDEX idx_presupuesto_items_descripcion_con_apu_gist ON public.presupuesto_items USING gist (descripcion gist_trgm_ops) WHERE (apu_id IS NOT NULL);
CREATE INDEX idx_presupuesto_items_padre_id ON public.presupuesto_items USING btree (padre_id);
CREATE INDEX idx_presupuesto_items_presupuesto_id ON public.presupuesto_items USING btree (presupuesto_id);
CREATE INDEX idx_presupuesto_items_version_id ON public.presupuesto_items USING btree (version_id);
CREATE INDEX presupuesto_items_descripcion_trgm_idx ON public.presupuesto_items USING gin (descripcion gin_trgm_ops);
CREATE INDEX idx_presupuestos_version_actual_id ON public.presupuestos USING btree (version_actual_id);
CREATE INDEX idx_proveedores_activo_nombre_trgm ON public.proveedores USING gin (nombre gin_trgm_ops) WHERE (estado = 'ACTIVO'::text);
CREATE INDEX idx_proveedores_nombre_trgm ON public.proveedores USING gin (nombre gin_trgm_ops);
CREATE UNIQUE INDEX proveedores_id_prov_key ON public.proveedores USING btree (id_prov);
CREATE INDEX idx_proyectos_empresa_id ON public.proyectos USING btree (empresa_id);
CREATE UNIQUE INDEX proyectos_codigo_unique_idx ON public.proyectos USING btree (codigo) WHERE (codigo IS NOT NULL);
CREATE INDEX idx_requisiciones_created ON public.requisiciones USING btree (created_at DESC);
CREATE INDEX idx_requisiciones_proyecto_created ON public.requisiciones USING btree (proyecto_id, created_at DESC);
CREATE INDEX idx_requisiciones_solicitado_created ON public.requisiciones USING btree (solicitado_por, created_at DESC);
CREATE INDEX idx_salidas_insumos_anulada_por ON public.salidas_insumos USING btree (anulada_por);
CREATE INDEX idx_salidas_insumos_editada_por ON public.salidas_insumos USING btree (editada_por);
CREATE INDEX idx_salidas_insumos_insumo_id ON public.salidas_insumos USING btree (insumo_id);
CREATE INDEX idx_salidas_insumos_registrado_por ON public.salidas_insumos USING btree (registrado_por);
CREATE INDEX salidas_insumos_proyecto_insumo_idx ON public.salidas_insumos USING btree (proyecto_id, insumo_id);
CREATE INDEX idx_solicitudes_equipo_categoria_asignada_id ON public.solicitudes_equipo USING btree (categoria_asignada_id);
CREATE INDEX idx_solicitudes_equipo_estado ON public.solicitudes_equipo USING btree (estado);
CREATE INDEX idx_solicitudes_equipo_item ON public.solicitudes_equipo USING btree (presupuesto_item_id);
CREATE INDEX idx_solicitudes_equipo_resuelto_por ON public.solicitudes_equipo USING btree (resuelto_por);
CREATE INDEX idx_solicitudes_equipo_solicitado_por ON public.solicitudes_equipo USING btree (solicitado_por);
CREATE INDEX idx_solicitudes_insumos_resuelto_por ON public.solicitudes_insumos USING btree (resuelto_por);
CREATE INDEX idx_solicitudes_insumos_solicitado_por ON public.solicitudes_insumos USING btree (solicitado_por);
CREATE INDEX solicitudes_insumos_estado_idx ON public.solicitudes_insumos USING btree (estado);
CREATE INDEX solicitudes_insumos_presupuesto_item_id_idx ON public.solicitudes_insumos USING btree (presupuesto_item_id);
CREATE INDEX idx_solicitudes_mano_obra_categoria_asignada_id ON public.solicitudes_mano_obra USING btree (categoria_asignada_id);
CREATE INDEX idx_solicitudes_mano_obra_estado ON public.solicitudes_mano_obra USING btree (estado);
CREATE INDEX idx_solicitudes_mano_obra_item ON public.solicitudes_mano_obra USING btree (presupuesto_item_id);
CREATE INDEX idx_solicitudes_mano_obra_resuelto_por ON public.solicitudes_mano_obra USING btree (resuelto_por);
CREATE INDEX idx_solicitudes_mano_obra_solicitado_por ON public.solicitudes_mano_obra USING btree (solicitado_por);
CREATE INDEX idx_transporte_precios_cargado_por ON public.transporte_precios USING btree (cargado_por);
CREATE INDEX idx_transporte_precios_item ON public.transporte_precios USING btree (presupuesto_item_id);
CREATE INDEX idx_transporte_precios_proyecto ON public.transporte_precios USING btree (proyecto_id);
CREATE INDEX idx_usuario_grupos_grupo_id ON public.usuario_grupos USING btree (grupo_id);
CREATE INDEX idx_usuario_proyectos_proyecto_id ON public.usuario_proyectos USING btree (proyecto_id);

-- Vistas.
create or replace view public.requisiciones_vista with (security_invoker = true) as
 SELECT r.id,
    r.numero,
    r.proyecto_id,
    pr.codigo AS proyecto_codigo,
    pr.nombre AS proyecto_nombre,
    r.solicitado_por,
    pf.nombre AS solicitante_nombre,
    r.fecha_requerida,
    r.urgente,
    r.observaciones,
    r.soporte_url,
    r.created_at,
    l.n_lineas,
        CASE
            WHEN l.n_lineas = 0 OR l.n_cancelado = l.n_lineas THEN 'cancelada'::text
            WHEN l.n_pendiente > 0 THEN 'pendiente'::text
            WHEN l.n_aprobado > 0 THEN 'aprobada'::text
            ELSE 'rechazada'::text
        END AS estado,
        CASE
            WHEN l.n_pendiente > 0 OR l.n_aprobado = 0 THEN NULL::text
            WHEN l.n_activas = 0 THEN 'rechazada_compras'::text
            WHEN l.n_por_comprar = 0 THEN 'completa'::text
            ELSE 'pendiente'::text
        END AS estado_compra
   FROM requisiciones r
     LEFT JOIN proyectos pr ON pr.id = r.proyecto_id
     LEFT JOIN perfiles pf ON pf.id = r.solicitado_por
     CROSS JOIN LATERAL ( SELECT count(*)::integer AS n_lineas,
            count(*) FILTER (WHERE p.estado = 'cancelado'::text)::integer AS n_cancelado,
            count(*) FILTER (WHERE p.estado = 'pendiente'::text)::integer AS n_pendiente,
            count(*) FILTER (WHERE p.estado = 'aprobado'::text)::integer AS n_aprobado,
            count(*) FILTER (WHERE p.estado = 'aprobado'::text AND p.rechazado_compras_at IS NULL)::integer AS n_activas,
            count(*) FILTER (WHERE p.estado = 'aprobado'::text AND p.rechazado_compras_at IS NULL AND _comprado_pedido(p.id) < p.cantidad)::integer AS n_por_comprar
           FROM pedidos_insumos p
          WHERE p.grupo_pedido_id = r.id) l;;

-- Triggers.
CREATE TRIGGER trg_historial_orden_compra AFTER INSERT OR UPDATE ON public.ordenes_compra FOR EACH ROW EXECUTE FUNCTION trg_historial_orden_compra();
CREATE TRIGGER trg_notificar_insumo_sobre_presupuesto AFTER UPDATE OF estado ON public.ordenes_compra FOR EACH ROW WHEN (((old.estado IS DISTINCT FROM 'aprobada'::text) AND (new.estado = 'aprobada'::text))) EXECUTE FUNCTION notificar_insumo_sobre_presupuesto();
CREATE TRIGGER trg_notificar_resolucion_oc AFTER UPDATE ON public.ordenes_compra FOR EACH ROW EXECUTE FUNCTION notificar_resolucion_oc();
CREATE TRIGGER trg_notificar_precio_sobre_efectivo_oc_item AFTER INSERT ON public.ordenes_compra_items FOR EACH ROW EXECUTE FUNCTION notificar_precio_sobre_efectivo_oc_item();
CREATE TRIGGER trg_autocompletar_proyecto_id_pedido BEFORE INSERT OR UPDATE OF presupuesto_item_id ON public.pedidos_insumos FOR EACH ROW EXECUTE FUNCTION autocompletar_proyecto_id_pedido();
CREATE TRIGGER trg_historial_pedido AFTER INSERT OR UPDATE ON public.pedidos_insumos FOR EACH ROW EXECUTE FUNCTION trg_historial_pedido();
CREATE TRIGGER trg_notificar_resolucion_pedido AFTER UPDATE ON public.pedidos_insumos FOR EACH ROW EXECUTE FUNCTION notificar_resolucion_pedido();
CREATE TRIGGER trg_verificar_orden_compra_editable BEFORE UPDATE OF cantidad_comprar, orden_compra_id ON public.pedidos_insumos FOR EACH ROW EXECUTE FUNCTION verificar_orden_compra_editable();
CREATE TRIGGER trg_verificar_proyecto_orden_compra BEFORE INSERT OR UPDATE OF orden_compra_id ON public.pedidos_insumos FOR EACH ROW EXECUTE FUNCTION verificar_proyecto_orden_compra();
CREATE TRIGGER trg_completar_email_perfil BEFORE INSERT ON public.perfiles FOR EACH ROW EXECUTE FUNCTION completar_email_perfil();
CREATE TRIGGER trigger_eliminar_apu_huerfano AFTER DELETE ON public.presupuesto_items FOR EACH ROW EXECUTE FUNCTION eliminar_apu_huerfano();
CREATE TRIGGER trg_verificar_salida_no_supera_disponible BEFORE INSERT OR UPDATE OF cantidad, insumo_id, proyecto_id ON public.salidas_insumos FOR EACH ROW EXECUTE FUNCTION verificar_salida_no_supera_disponible();
CREATE TRIGGER trg_sincronizar_apu_import_revision_equipo AFTER UPDATE ON public.solicitudes_equipo FOR EACH ROW EXECUTE FUNCTION sincronizar_apu_import_revision_equipo();
CREATE TRIGGER trigger_sincronizar_apu_import_revision AFTER UPDATE ON public.solicitudes_insumos FOR EACH ROW EXECUTE FUNCTION sincronizar_apu_import_revision();
CREATE TRIGGER trigger_sincronizar_apu_import_revision_mano_obra AFTER UPDATE ON public.solicitudes_mano_obra FOR EACH ROW EXECUTE FUNCTION sincronizar_apu_import_revision_mano_obra();
