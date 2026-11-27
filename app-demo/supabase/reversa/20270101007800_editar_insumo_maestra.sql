-- Reversa de 20270101007800: sin historial de insumos ni código fijo.
-- Los eventos 'insumo' ya escritos se borran (si no, el CHECK de siempre falla).
begin;

drop trigger if exists trg_historial_insumo on public.maestro_insumos;
drop function if exists public._historial_insumo();
drop trigger if exists trg_insumo_codigo_fijo on public.maestro_insumos;
drop function if exists public._insumo_codigo_fijo();

do $$
declare
  v text := pg_get_functiondef('public.historial_entidad(text, uuid)'::regprocedure);
  v_quitar text := E'  elsif p_tipo = ''insumo'' then\n'
    || E'    v_ok := public.tiene_pestana(v_uid, ''almacen.insumos'')\n'
    || E'         or public.tiene_pestana(v_uid, ''almacen.aprobar_insumos'')\n'
    || E'         or public.tiene_accion(v_uid, ''aprobar_insumos'');\n';
begin
  if position(v_quitar in v) > 0 then
    execute replace(v, v_quitar, '');
  end if;
end;
$$;

delete from public.historial_eventos where entidad_tipo = 'insumo';
alter table public.historial_eventos drop constraint historial_eventos_entidad_tipo_check;
alter table public.historial_eventos add constraint historial_eventos_entidad_tipo_check
  check (entidad_tipo = any (array[
    'acta', 'caja_menor', 'contratista', 'contrato', 'entrada', 'orden_compra', 'otrosi',
    'pago', 'pedido', 'presupuesto', 'proveedor', 'requisicion', 'requisicion_admin', 'rol',
    'salida', 'solicitud_equipo', 'solicitud_insumo', 'solicitud_mano_obra', 'usuario'
  ]));

commit;
