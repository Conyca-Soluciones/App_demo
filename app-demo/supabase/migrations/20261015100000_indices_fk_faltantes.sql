-- Índices para las llaves foráneas que no tenían (asesor de rendimiento de
-- Supabase, 2026-10-02). Sin índice, filtrar por esa columna (ej. Entradas por
-- "quién recibió", permisos por rol) o borrar/cambiar la fila referenciada
-- recorre la tabla entera. Se crean solo si no existe ya un índice que empiece
-- por esa columna.

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('entradas_almacen', 'anulada_por'), ('entradas_almacen', 'editada_por'), ('entradas_almacen', 'recibido_por'),
      ('historial_eventos', 'usuario_id'),
      ('ordenes_compra', 'aprobada_por'), ('ordenes_compra', 'cancelada_por'), ('ordenes_compra', 'desaprobada_por'),
      ('pedidos_insumos', 'cancelado_por'), ('pedidos_insumos', 'desaprobado_por'),
      ('pedidos_insumos', 'rechazado_compras_por'), ('pedidos_insumos', 'resuelto_por'),
      ('perfiles', 'rol_id'),
      ('presupuestos', 'version_actual_id'),
      ('salidas_insumos', 'anulada_por'), ('salidas_insumos', 'editada_por'), ('salidas_insumos', 'registrado_por'),
      ('solicitudes_equipo', 'categoria_asignada_id'), ('solicitudes_equipo', 'resuelto_por'), ('solicitudes_equipo', 'solicitado_por'),
      ('solicitudes_insumos', 'resuelto_por'), ('solicitudes_insumos', 'solicitado_por'),
      ('solicitudes_mano_obra', 'categoria_asignada_id'), ('solicitudes_mano_obra', 'resuelto_por'), ('solicitudes_mano_obra', 'solicitado_por'),
      ('transporte_precios', 'cargado_por')
    ) as t(tabla, columna)
  loop
    if not exists (
      select 1 from pg_indexes
      where schemaname = 'public' and tablename = r.tabla
        and indexdef ~ ('\(' || r.columna || '[,)\s]')
    ) then
      execute format('create index %I on public.%I (%I)', 'idx_' || r.tabla || '_' || r.columna, r.tabla, r.columna);
    end if;
  end loop;
end $$;
