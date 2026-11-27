-- Editar un insumo desde la Maestra de insumos (decisiones del usuario, 2026-11-27):
--   * Edita quien tiene la acción aprobar_insumos: es la política
--     maestro_insumos_update de siempre (20261005100000), no cambia.
--   * El código del insumo queda FIJO: lo exige un disparador (antes la
--     política dejaba cambiarlo).
--   * Cambiar el precio no toca los APU (vr_neto lo sigue calculando
--     maestro_insumos_vr_neto).
--   * Cada cambio queda en el historial (tipo 'insumo'): ventana del insumo y
--     Admin › Auditoría. La referencia de la Auditoría sale de datos.descripcion.
-- Reversa: supabase/reversa/20270101007800_editar_insumo_maestra.sql
begin;

-- ---------------------------------------------------------------- historial: tipo 'insumo'
alter table public.historial_eventos drop constraint historial_eventos_entidad_tipo_check;
alter table public.historial_eventos add constraint historial_eventos_entidad_tipo_check
  check (entidad_tipo = any (array[
    'acta', 'caja_menor', 'contratista', 'contrato', 'entrada', 'insumo', 'orden_compra', 'otrosi',
    'pago', 'pedido', 'presupuesto', 'proveedor', 'requisicion', 'requisicion_admin', 'rol',
    'salida', 'solicitud_equipo', 'solicitud_insumo', 'solicitud_mano_obra', 'usuario'
  ]));

-- ---------------------------------------------------------------- código fijo
create or replace function public._insumo_codigo_fijo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.codigo is distinct from old.codigo then
    raise exception 'El código del insumo no se puede cambiar.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_insumo_codigo_fijo on public.maestro_insumos;
create trigger trg_insumo_codigo_fijo
  before update of codigo on public.maestro_insumos
  for each row execute function public._insumo_codigo_fijo();

-- ---------------------------------------------------------------- historial del insumo
-- creado: al entrar al maestro (aprobar una solicitud, carga). editado: los
-- campos que cambiaron, de -> a (sin vr_neto, que sale del precio y el IVA, ni
-- los datos de quién/cuándo modificó, que ya dice el evento).
create or replace function public._historial_insumo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cambios jsonb;
  v_ref text := new.codigo::text || ' · ' || new.descripcion;
begin
  if tg_op = 'INSERT' then
    insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('insumo', new.id, 'creado', auth.uid(), jsonb_build_object('descripcion', v_ref));
    return null;
  end if;

  v_cambios := public._jsonb_cambios(
    to_jsonb(old), to_jsonb(new),
    array['id', 'created_at', 'vr_neto', 'usuario_modificacion', 'fecha_modificacion']
  );
  if v_cambios is not null then
    insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('insumo', new.id, 'editado', auth.uid(),
            jsonb_build_object('descripcion', v_ref, 'cambios', v_cambios));
  end if;
  return null;
end;
$$;

drop trigger if exists trg_historial_insumo on public.maestro_insumos;
create trigger trg_historial_insumo
  after insert or update on public.maestro_insumos
  for each row execute function public._historial_insumo();

-- ---------------------------------------------------------------- quién ve el historial
-- Quien ve la Maestra o aprueba insumos (el Administrador ve todo, como siempre).
do $$
declare
  v text := pg_get_functiondef('public.historial_entidad(text, uuid)'::regprocedure);
  v_buscar text := E'  elsif p_tipo in (''rol'', ''usuario'',';
begin
  if position('p_tipo = ''insumo''' in v) > 0 then return; end if;
  if position(v_buscar in v) = 0 then
    raise exception 'historial_entidad cambió: no se encontró el texto a parchar.';
  end if;
  execute replace(v, v_buscar,
    E'  elsif p_tipo = ''insumo'' then\n'
    || E'    v_ok := public.tiene_pestana(v_uid, ''almacen.insumos'')\n'
    || E'         or public.tiene_pestana(v_uid, ''almacen.aprobar_insumos'')\n'
    || E'         or public.tiene_accion(v_uid, ''aprobar_insumos'');\n'
    || v_buscar);
end;
$$;

commit;
