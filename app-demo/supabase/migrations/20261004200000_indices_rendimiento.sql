-- Índices que faltaban (auditoría de rendimiento, 2026-09-30). Solo índices:
-- no cambia datos, funciones ni políticas. Ver REPORTE-cambios-y-rendimiento.md.
--
-- Con qué se detectó:
--   * pg_stat_statements: recalcular_valor_apu es lo que más tiempo consume
--     de la app (9.830 llamadas, 24 ms promedio). Su UPDATE final filtra
--     presupuesto_items por apu_id, que no tenía índice.
--   * pg_stat_user_tables: apu_import_revision, maestro_insumos y
--     presupuesto_items con miles de seq scans (40M, 29M y 14M filas leídas).
--   * Llaves foráneas sin índice: al borrar la fila padre (ej. un APU, un
--     insumo, un presupuesto en cascada) Postgres revisa la tabla hija
--     COMPLETA por cada fila borrada -- O(padres × hijos). Con índice, cada
--     revisión es O(log n). Explica los DELETE de presupuestos de 0,2-3,9 s.

-- ---- Búsquedas por similitud (ORDER BY columna <-> término LIMIT n) --------
-- Ese orden SOLO lo puede resolver un índice GiST de trigramas; los GIN que
-- ya existían no sirven para ordenar, así que cada búsqueda leía y ordenaba
-- la tabla entera (EXPLAIN: Seq Scan + Sort, 93 ms sobre 1.794 insumos).
-- Usado por buscar_insumos_candidatos / buscar_items_apu_candidatos /
-- buscar_mano_obra_candidatos / buscar_equipo_candidatos.
create index if not exists idx_maestro_insumos_descripcion_gist
  on public.maestro_insumos using gist (descripcion gist_trgm_ops);
create index if not exists idx_presupuesto_items_descripcion_con_apu_gist
  on public.presupuesto_items using gist (descripcion gist_trgm_ops) where apu_id is not null;
create index if not exists idx_mano_obra_categorias_categoria_gist
  on public.mano_obra_categorias using gist (categoria gist_trgm_ops);
create index if not exists idx_equipo_categorias_categoria_gist
  on public.equipo_categorias using gist (categoria gist_trgm_ops);

-- ---- presupuesto_items ---------------------------------------------------
-- recalcular_valor_apu (UPDATE ... WHERE apu_id = ?), contarUsosDeApu, etc.
create index if not exists idx_presupuesto_items_apu_id on public.presupuesto_items (apu_id);
-- FK a sí misma: borrar un ítem revisa sus hijos.
create index if not exists idx_presupuesto_items_padre_id on public.presupuesto_items (padre_id);

-- ---- item_apu: FKs hacia los catálogos -------------------------------------
create index if not exists idx_item_apu_insumo_id on public.item_apu (insumo_id);
create index if not exists idx_item_apu_mano_obra_categoria_id on public.item_apu (mano_obra_categoria_id);
create index if not exists idx_item_apu_equipo_categoria_id on public.item_apu (equipo_categoria_id);
create index if not exists idx_item_apu_transporte_precio_id on public.item_apu (transporte_precio_id);

-- ---- apu_import_revision (la tabla con más lecturas completas) ------------
create index if not exists idx_apu_import_revision_apu_id on public.apu_import_revision (apu_id);
create index if not exists idx_apu_import_revision_item_apu_id on public.apu_import_revision (item_apu_id);
create index if not exists idx_apu_import_revision_insumo_asignado on public.apu_import_revision (insumo_id_asignado);
create index if not exists idx_apu_import_revision_mo_asignado on public.apu_import_revision (mano_obra_categoria_id_asignado);
create index if not exists idx_apu_import_revision_equipo_asignado on public.apu_import_revision (equipo_categoria_id_asignado);
create index if not exists idx_apu_import_revision_solicitud_mo on public.apu_import_revision (solicitud_mano_obra_id);
create index if not exists idx_apu_import_revision_solicitud_equipo on public.apu_import_revision (solicitud_equipo_id);

-- ---- Pedidos / almacén -----------------------------------------------------
create index if not exists idx_pedidos_insumos_item_apu_id on public.pedidos_insumos (item_apu_id);
-- El índice existente (proyecto_id, insumo_id) no sirve para buscar solo por insumo.
create index if not exists idx_salidas_insumos_insumo_id on public.salidas_insumos (insumo_id);

-- ---- Solicitudes de equipo (47k seq scans; mano de obra ya los tenía) ------
create index if not exists idx_solicitudes_equipo_estado on public.solicitudes_equipo (estado);
create index if not exists idx_solicitudes_equipo_item on public.solicitudes_equipo (presupuesto_item_id);

-- ---- Permisos (obtener_permisos_usuario / verProyectos) --------------------
-- Las PK son (usuario_id, proyecto_id) / (grupo_id, proyecto_id) /
-- (usuario_id, grupo_id): no sirven para buscar por la SEGUNDA columna.
create index if not exists idx_usuario_proyectos_proyecto_id on public.usuario_proyectos (proyecto_id);
create index if not exists idx_grupo_proyectos_proyecto_id on public.grupo_proyectos (proyecto_id);
create index if not exists idx_usuario_grupos_grupo_id on public.usuario_grupos (grupo_id);
