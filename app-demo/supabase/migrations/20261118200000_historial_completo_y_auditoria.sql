-- Historial "para todo", fases 3 y 4 (decisión del usuario, 2026-10-20), y la
-- consulta de la pantalla de Auditoría del Administrador.
--
-- Va DESPUÉS de 20261118100000_historial_pagos_terceros_proveedores.sql.
--
-- Fase 3 (escriben en historial_eventos; quién = auth.uid(), sin sesión = sistema):
--   contratista          creado; editado (campos que cambiaron; los datos
--                        bancarios solo dicen que cambiaron, sin valores);
--                        documento subido / reemplazado / quitado.
--   contrato             minuta_guardada: cada vez que Jurídica guarda la
--                        minuta, con lo que cambió (antes y después). No se
--                        anota cuando el guardado es parte de enviar/aprobar.
--   entrada              registrada, editada (remisión/observaciones),
--                        linea_editada (cantidad de un insumo), anulada.
--   salida               registrada, editada (campos), anulada.
--   solicitud_insumo, solicitud_mano_obra, solicitud_equipo
--                        solicitada, aprobada, rechazada. Las solicitudes se
--                        BORRAN al resolverse: el historial queda (con la
--                        descripción) y se ve en Auditoría.
-- Fase 4:
--   presupuesto          creado, version_creada, version_descartada, descartado.
--   rol                  creado, renombrado, eliminado, permiso_agregado, permiso_quitado.
--   usuario              creado, renombrado, rol_cambiado, todos_proyectos,
--                        proyecto_asignado, proyecto_quitado.
--   (Cambios de contraseña: van por Supabase Auth, no pasan por la base.)
--
-- Lo que ya existía se reconstruye con sus columnas (marcado `reconstruido`):
-- contratistas (creado / última edición), entradas y salidas (registrada /
-- editada / anulada) y solicitudes pendientes (solicitada).
--
-- historial_entidad acepta los tipos nuevos (con el mismo permiso que la
-- pantalla donde se ven); rol, usuario, solicitudes y lo ya borrado solo lo ve
-- el Administrador. listar_auditoria(...) es la consulta de /admin/auditoria
-- (solo Administrador): historial_eventos + terceros_auditoria, con filtros y
-- páginas, y una referencia legible de cada cosa.

-- ------------------------------------------------------------ tipos válidos
alter table public.historial_eventos drop constraint if exists historial_eventos_entidad_tipo_check;
alter table public.historial_eventos add constraint historial_eventos_entidad_tipo_check
  check (entidad_tipo = any (array[
    'orden_compra', 'pedido', 'requisicion', 'contrato', 'acta', 'pago', 'proveedor',
    'contratista', 'entrada', 'salida',
    'solicitud_insumo', 'solicitud_mano_obra', 'solicitud_equipo',
    'presupuesto', 'rol', 'usuario'
  ]));

-- Para la pantalla de Auditoría (todo, más recientes primero).
create index if not exists historial_eventos_fecha_idx on public.historial_eventos (created_at desc, id);
create index if not exists terceros_auditoria_fecha_idx on public.terceros_auditoria (creado_en desc, id);

-- ------------------------------------------------------------ utilidades
-- {campo: {de, a}} con los campos que cambiaron entre dos filas (null = nada).
create or replace function public._jsonb_cambios(p_antes jsonb, p_despues jsonb, p_excluir text[] default '{}')
returns jsonb
language sql
immutable
set search_path to 'public'
as $function$
  select jsonb_object_agg(k, jsonb_build_object('de', p_antes -> k, 'a', p_despues -> k))
    from (select jsonb_object_keys(coalesce(p_despues, '{}'::jsonb)) as k
          union
          select jsonb_object_keys(coalesce(p_antes, '{}'::jsonb))) llaves
   where not (k = any (p_excluir))
     and (p_antes -> k) is distinct from (p_despues -> k)
$function$;
revoke all on function public._jsonb_cambios(jsonb, jsonb, text[]) from public, anon, authenticated;

create or replace function public._anotar_historial(
  p_tipo text, p_id uuid, p_evento text, p_datos jsonb default null, p_motivo text default null
) returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
  values (p_tipo, p_id, p_evento, auth.uid(), p_motivo, p_datos)
$function$;
revoke all on function public._anotar_historial(text, uuid, text, jsonb, text) from public, anon, authenticated;

-- ============================================================== FASE 3
-- ------------------------------------------------------------ contratistas
create or replace function public._historial_contratista()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cambios jsonb;
begin
  if tg_op = 'INSERT' then
    perform public._anotar_historial('contratista', new.id, 'creado',
      jsonb_build_object('nombre', new.nombre, 'documento', new.tipo_documento || ' ' || new.numero_documento));
    return null;
  end if;

  v_cambios := public._jsonb_cambios(to_jsonb(old), to_jsonb(new),
    array['id', 'created_by', 'created_at', 'updated_at', 'updated_by', 'banco', 'tipo_cuenta', 'numero_cuenta']);
  -- Los datos bancarios solo los ve quien tiene ver_datos_bancarios: aquí solo consta que cambiaron.
  if (new.banco, new.tipo_cuenta, new.numero_cuenta) is distinct from (old.banco, old.tipo_cuenta, old.numero_cuenta) then
    v_cambios := coalesce(v_cambios, '{}'::jsonb)
      || jsonb_build_object('datos_bancarios', jsonb_build_object('de', '(reservado)', 'a', '(reservado)'));
  end if;
  if v_cambios is not null then
    perform public._anotar_historial('contratista', new.id, 'editado', jsonb_build_object('cambios', v_cambios));
  end if;
  return null;
end;
$function$;
revoke all on function public._historial_contratista() from public, anon, authenticated;

drop trigger if exists trg_historial_contratista on public.contratistas;
create trigger trg_historial_contratista
  after insert or update on public.contratistas
  for each row execute function public._historial_contratista();

-- Documentos: editar_contratista borra el documento del tipo y sube el nuevo en
-- la misma transacción; las dos mitades se juntan en un solo "reemplazado".
-- Los documentos que se suben al crear el contratista no se anotan uno a uno
-- (ya consta "creado").
create or replace function public._historial_contratista_documento()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_evento uuid;
begin
  if tg_op = 'DELETE' then
    perform public._anotar_historial('contratista', old.contratista_id, 'documento_quitado',
      jsonb_build_object('tipo', old.tipo, 'archivo', old.nombre_archivo));
    return null;
  end if;

  if exists (select 1 from public.contratistas c where c.id = new.contratista_id and c.created_at = now()) then
    return null;
  end if;

  select h.id into v_evento
    from public.historial_eventos h
   where h.entidad_tipo = 'contratista' and h.entidad_id = new.contratista_id
     and h.evento = 'documento_quitado' and h.created_at = now()
     and h.datos ->> 'tipo' = new.tipo
   limit 1;

  if v_evento is not null then
    update public.historial_eventos
       set evento = 'documento_reemplazado',
           datos = datos || jsonb_build_object('archivo_nuevo', new.nombre_archivo)
     where id = v_evento;
  else
    perform public._anotar_historial('contratista', new.contratista_id, 'documento_subido',
      jsonb_build_object('tipo', new.tipo, 'archivo', new.nombre_archivo));
  end if;
  return null;
end;
$function$;
revoke all on function public._historial_contratista_documento() from public, anon, authenticated;

drop trigger if exists trg_historial_contratista_documento on public.contratista_documentos;
create trigger trg_historial_contratista_documento
  after insert or delete on public.contratista_documentos
  for each row execute function public._historial_contratista_documento();

-- ------------------------------------------------------------ minutas
create or replace function public._historial_minuta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cambios jsonb;
begin
  -- Enviar o resolver la minuta también reescribe minuta_datos: eso ya tiene su
  -- propio evento (minuta_enviada, minuta_aprobada...).
  if new.minuta_estado is distinct from old.minuta_estado then
    return null;
  end if;
  v_cambios := public._jsonb_cambios(old.minuta_datos, new.minuta_datos);
  if v_cambios is not null then
    perform public._anotar_historial('contrato', new.id, 'minuta_guardada', jsonb_build_object('cambios', v_cambios));
  end if;
  return null;
end;
$function$;
revoke all on function public._historial_minuta() from public, anon, authenticated;

drop trigger if exists trg_historial_minuta on public.contratos;
create trigger trg_historial_minuta
  after update of minuta_datos on public.contratos
  for each row
  when (old.minuta_datos is distinct from new.minuta_datos)
  execute function public._historial_minuta();

-- ------------------------------------------------------------ entradas
create or replace function public._historial_entrada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cambios jsonb;
begin
  if tg_op = 'INSERT' then
    perform public._anotar_historial('entrada', new.id, 'registrada',
      jsonb_build_object('numero', new.numero, 'remision', new.remision,
                         'orden', (select o.numero from public.ordenes_compra o where o.id = new.orden_compra_id)));
    return null;
  end if;

  if new.anulada_at is not null and old.anulada_at is null then
    perform public._anotar_historial('entrada', new.id, 'anulada', null, new.motivo_anulacion);
    return null;
  end if;

  v_cambios := public._jsonb_cambios(
    jsonb_build_object('remision', old.remision, 'observaciones', old.observaciones),
    jsonb_build_object('remision', new.remision, 'observaciones', new.observaciones));
  if v_cambios is not null then
    perform public._anotar_historial('entrada', new.id, 'editada', jsonb_build_object('cambios', v_cambios));
  end if;
  return null;
end;
$function$;
revoke all on function public._historial_entrada() from public, anon, authenticated;

drop trigger if exists trg_historial_entrada on public.entradas_almacen;
create trigger trg_historial_entrada
  after insert or update on public.entradas_almacen
  for each row execute function public._historial_entrada();

create or replace function public._historial_entrada_linea()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public._anotar_historial('entrada', new.entrada_id, 'linea_editada',
    jsonb_build_object(
      'insumo', (select mi.descripcion
                   from public.ordenes_compra_items oci
                   join public.pedidos_insumos pe on pe.id = oci.pedido_insumo_id
                   join public.maestro_insumos mi on mi.id = pe.insumo_id
                  where oci.id = new.orden_compra_item_id),
      'de', old.cantidad, 'a', new.cantidad));
  return null;
end;
$function$;
revoke all on function public._historial_entrada_linea() from public, anon, authenticated;

drop trigger if exists trg_historial_entrada_linea on public.entradas_almacen_items;
create trigger trg_historial_entrada_linea
  after update of cantidad on public.entradas_almacen_items
  for each row
  when (old.cantidad is distinct from new.cantidad)
  execute function public._historial_entrada_linea();

-- ------------------------------------------------------------ salidas
create or replace function public._historial_salida()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cambios jsonb;
begin
  if tg_op = 'INSERT' then
    perform public._anotar_historial('salida', new.id, 'registrada',
      jsonb_build_object('insumo', (select descripcion from public.maestro_insumos where id = new.insumo_id),
                         'cantidad', new.cantidad, 'retira', new.retira));
    return null;
  end if;

  if new.anulada_at is not null and old.anulada_at is null then
    perform public._anotar_historial('salida', new.id, 'anulada', null, new.motivo_anulacion);
    return null;
  end if;

  v_cambios := public._jsonb_cambios(
    jsonb_build_object('cantidad', old.cantidad, 'retira', old.retira, 'observaciones', old.observaciones, 'fecha', old.fecha),
    jsonb_build_object('cantidad', new.cantidad, 'retira', new.retira, 'observaciones', new.observaciones, 'fecha', new.fecha));
  if v_cambios is not null then
    perform public._anotar_historial('salida', new.id, 'editada', jsonb_build_object('cambios', v_cambios));
  end if;
  return null;
end;
$function$;
revoke all on function public._historial_salida() from public, anon, authenticated;

drop trigger if exists trg_historial_salida on public.salidas_insumos;
create trigger trg_historial_salida
  after insert or update on public.salidas_insumos
  for each row execute function public._historial_salida();

-- ------------------------------------------------------------ solicitudes
-- Una sola función para las tres tablas; el tipo sale del nombre de la tabla.
create or replace function public._historial_solicitud()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tipo text := case tg_table_name
                   when 'solicitudes_insumos' then 'solicitud_insumo'
                   when 'solicitudes_mano_obra' then 'solicitud_mano_obra'
                   else 'solicitud_equipo' end;
  v_item text;
begin
  if tg_op = 'INSERT' then
    select pi.codigo || coalesce(' · ' || pr.codigo, '') into v_item
      from public.presupuesto_items pi
      left join public.presupuestos p on p.id = pi.presupuesto_id
      left join public.proyectos pr on pr.id = p.proyecto_id
     where pi.id = new.presupuesto_item_id;
    perform public._anotar_historial(v_tipo, new.id, 'solicitada',
      jsonb_build_object('descripcion', new.descripcion, 'item', v_item));
    return null;
  end if;

  if new.estado is distinct from old.estado and new.estado in ('aprobado', 'rechazado') then
    perform public._anotar_historial(v_tipo, new.id,
      case new.estado when 'aprobado' then 'aprobada' else 'rechazada' end,
      jsonb_build_object('descripcion', new.descripcion),
      new.motivo_rechazo);
  end if;
  return null;
end;
$function$;
revoke all on function public._historial_solicitud() from public, anon, authenticated;

drop trigger if exists trg_historial_solicitud on public.solicitudes_insumos;
create trigger trg_historial_solicitud
  after insert or update of estado on public.solicitudes_insumos
  for each row execute function public._historial_solicitud();
drop trigger if exists trg_historial_solicitud on public.solicitudes_mano_obra;
create trigger trg_historial_solicitud
  after insert or update of estado on public.solicitudes_mano_obra
  for each row execute function public._historial_solicitud();
drop trigger if exists trg_historial_solicitud on public.solicitudes_equipo;
create trigger trg_historial_solicitud
  after insert or update of estado on public.solicitudes_equipo
  for each row execute function public._historial_solicitud();

-- ============================================================== FASE 4
-- ------------------------------------------------------------ presupuestos
create or replace function public._historial_presupuesto()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fila record;
begin
  if tg_op = 'DELETE' then v_fila := old; else v_fila := new; end if;
  perform public._anotar_historial('presupuesto', v_fila.id,
    case tg_op when 'INSERT' then 'creado' else 'descartado' end,
    jsonb_build_object('nombre', v_fila.nombre,
                       'proyecto', (select codigo from public.proyectos where id = v_fila.proyecto_id)));
  return null;
end;
$function$;
revoke all on function public._historial_presupuesto() from public, anon, authenticated;

drop trigger if exists trg_historial_presupuesto on public.presupuestos;
create trigger trg_historial_presupuesto
  after insert or delete on public.presupuestos
  for each row execute function public._historial_presupuesto();

create or replace function public._historial_presupuesto_version()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fila record;
begin
  if tg_op = 'DELETE' then v_fila := old; else v_fila := new; end if;
  perform public._anotar_historial('presupuesto', v_fila.presupuesto_id,
    case tg_op when 'INSERT' then 'version_creada' else 'version_descartada' end,
    jsonb_build_object('numero', v_fila.numero, 'nombre', v_fila.nombre));
  return null;
end;
$function$;
revoke all on function public._historial_presupuesto_version() from public, anon, authenticated;

drop trigger if exists trg_historial_presupuesto_version on public.presupuesto_versiones;
create trigger trg_historial_presupuesto_version
  after insert or delete on public.presupuesto_versiones
  for each row execute function public._historial_presupuesto_version();

-- ------------------------------------------------------------ roles
create or replace function public._historial_rol()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    perform public._anotar_historial('rol', new.id, 'creado', jsonb_build_object('nombre', new.nombre));
  elsif tg_op = 'DELETE' then
    perform public._anotar_historial('rol', old.id, 'eliminado', jsonb_build_object('nombre', old.nombre));
  elsif new.nombre is distinct from old.nombre then
    perform public._anotar_historial('rol', new.id, 'renombrado', jsonb_build_object('de', old.nombre, 'a', new.nombre));
  end if;
  return null;
end;
$function$;
revoke all on function public._historial_rol() from public, anon, authenticated;

drop trigger if exists trg_historial_rol on public.roles;
create trigger trg_historial_rol
  after insert or update or delete on public.roles
  for each row execute function public._historial_rol();

create or replace function public._historial_rol_permiso()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fila record;
begin
  if tg_op = 'DELETE' then v_fila := old; else v_fila := new; end if;
  perform public._anotar_historial('rol', v_fila.rol_id,
    case tg_op when 'INSERT' then 'permiso_agregado' else 'permiso_quitado' end,
    jsonb_build_object('permiso', v_fila.permiso,
                       'rol', (select nombre from public.roles where id = v_fila.rol_id)));
  return null;
end;
$function$;
revoke all on function public._historial_rol_permiso() from public, anon, authenticated;

drop trigger if exists trg_historial_rol_permiso on public.rol_permisos;
create trigger trg_historial_rol_permiso
  after insert or delete on public.rol_permisos
  for each row execute function public._historial_rol_permiso();

-- ------------------------------------------------------------ usuarios
create or replace function public._historial_usuario()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    perform public._anotar_historial('usuario', new.id, 'creado',
      jsonb_build_object('nombre', new.nombre,
                         'rol', (select nombre from public.roles where id = new.rol_id)));
    return null;
  end if;
  if new.rol_id is distinct from old.rol_id then
    perform public._anotar_historial('usuario', new.id, 'rol_cambiado',
      jsonb_build_object('de', (select nombre from public.roles where id = old.rol_id),
                         'a', (select nombre from public.roles where id = new.rol_id)));
  end if;
  if new.todos_los_proyectos is distinct from old.todos_los_proyectos then
    perform public._anotar_historial('usuario', new.id, 'todos_proyectos',
      jsonb_build_object('a', new.todos_los_proyectos));
  end if;
  if new.nombre is distinct from old.nombre then
    perform public._anotar_historial('usuario', new.id, 'renombrado',
      jsonb_build_object('de', old.nombre, 'a', new.nombre));
  end if;
  return null;
end;
$function$;
revoke all on function public._historial_usuario() from public, anon, authenticated;

drop trigger if exists trg_historial_usuario on public.perfiles;
create trigger trg_historial_usuario
  after insert or update of rol_id, todos_los_proyectos, nombre on public.perfiles
  for each row execute function public._historial_usuario();

create or replace function public._historial_usuario_proyecto()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fila record;
begin
  if tg_op = 'DELETE' then v_fila := old; else v_fila := new; end if;
  perform public._anotar_historial('usuario', v_fila.usuario_id,
    case tg_op when 'INSERT' then 'proyecto_asignado' else 'proyecto_quitado' end,
    jsonb_build_object('proyecto', (select codigo || ' · ' || nombre from public.proyectos where id = v_fila.proyecto_id)));
  return null;
end;
$function$;
revoke all on function public._historial_usuario_proyecto() from public, anon, authenticated;

drop trigger if exists trg_historial_usuario_proyecto on public.usuario_proyectos;
create trigger trg_historial_usuario_proyecto
  after insert or delete on public.usuario_proyectos
  for each row execute function public._historial_usuario_proyecto();

-- ============================================================ RECONSTRUIR
-- Lo que ya existía, con lo que guardan sus columnas. Solo si esa entidad no
-- tiene historial todavía (se puede correr más de una vez).
insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos, created_at)
select 'contratista', c.id, e.evento, e.usuario_id, null, jsonb_build_object('reconstruido', true) || e.datos, e.cuando
  from public.contratistas c
  cross join lateral (values
    ('creado', c.created_by, jsonb_build_object('nombre', c.nombre, 'documento', c.tipo_documento || ' ' || c.numero_documento), c.created_at),
    ('editado', c.updated_by, '{}'::jsonb, case when c.updated_at > c.created_at + interval '1 second' then c.updated_at end)
  ) as e(evento, usuario_id, datos, cuando)
 where e.cuando is not null
   and not exists (select 1 from public.historial_eventos h where h.entidad_tipo = 'contratista' and h.entidad_id = c.id);

insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos, created_at)
select 'entrada', en.id, e.evento, e.usuario_id, e.motivo, jsonb_build_object('reconstruido', true) || e.datos, e.cuando
  from public.entradas_almacen en
  cross join lateral (values
    ('registrada', en.recibido_por, null::text,
     jsonb_build_object('numero', en.numero, 'remision', en.remision,
                        'orden', (select o.numero from public.ordenes_compra o where o.id = en.orden_compra_id)),
     en.created_at),
    ('editada', en.editada_por, null, '{}'::jsonb, en.editada_at),
    ('anulada', en.anulada_por, en.motivo_anulacion, '{}'::jsonb, en.anulada_at)
  ) as e(evento, usuario_id, motivo, datos, cuando)
 where e.cuando is not null
   and not exists (select 1 from public.historial_eventos h where h.entidad_tipo = 'entrada' and h.entidad_id = en.id);

insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos, created_at)
select 'salida', s.id, e.evento, e.usuario_id, e.motivo, jsonb_build_object('reconstruido', true) || e.datos, e.cuando
  from public.salidas_insumos s
  cross join lateral (values
    ('registrada', s.registrado_por, null::text,
     jsonb_build_object('insumo', (select descripcion from public.maestro_insumos where id = s.insumo_id),
                        'cantidad', coalesce(s.cantidad_original, s.cantidad), 'retira', s.retira),
     s.created_at),
    ('editada', s.editada_por, null,
     case when s.cantidad_original is not null and s.cantidad_original <> s.cantidad
          then jsonb_build_object('cambios', jsonb_build_object('cantidad', jsonb_build_object('de', s.cantidad_original, 'a', s.cantidad)))
          else '{}'::jsonb end,
     s.editada_at),
    ('anulada', s.anulada_por, s.motivo_anulacion, '{}'::jsonb, s.anulada_at)
  ) as e(evento, usuario_id, motivo, datos, cuando)
 where e.cuando is not null
   and not exists (select 1 from public.historial_eventos h where h.entidad_tipo = 'salida' and h.entidad_id = s.id);

insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos, created_at)
select x.tipo, x.id, 'solicitada', x.solicitado_por,
       jsonb_build_object('reconstruido', true, 'descripcion', x.descripcion), x.created_at
  from (
    select 'solicitud_insumo' as tipo, id, solicitado_por, descripcion, created_at from public.solicitudes_insumos
    union all
    select 'solicitud_mano_obra', id, solicitado_por, descripcion, created_at from public.solicitudes_mano_obra
    union all
    select 'solicitud_equipo', id, solicitado_por, descripcion, created_at from public.solicitudes_equipo
  ) x
 where not exists (select 1 from public.historial_eventos h where h.entidad_tipo = x.tipo and h.entidad_id = x.id);

-- ------------------------------------------------------ historial_entidad
create or replace function public.historial_entidad(p_tipo text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_ok boolean;
  v_uid uuid := auth.uid();
begin
  if p_tipo = 'orden_compra' then
    select (public.rol_compras(v_uid) or public.usuario_puede_ver_proyecto(v_uid, o.proyecto_id))
      into v_ok from public.ordenes_compra o where o.id = p_id;
  elsif p_tipo = 'pedido' then
    select (public.usuario_tiene_acceso_a_item(p.presupuesto_item_id) or public.rol_compras(v_uid))
      into v_ok from public.pedidos_insumos p where p.id = p_id;
  elsif p_tipo = 'requisicion' then
    select exists (
      select 1 from public.pedidos_insumos p
      where p.grupo_pedido_id = p_id
        and (public.usuario_tiene_acceso_a_item(p.presupuesto_item_id)
             or public.rol_compras(v_uid)
             or public.tiene_accion(v_uid, 'aprobar_pedidos'))
    ) into v_ok;
  elsif p_tipo = 'contrato' then
    select (
      public.tiene_pestana(v_uid, 'contratos.solicitar')
      or public.tiene_pestana(v_uid, 'contratos.preaprobacion')
      or public.tiene_pestana(v_uid, 'contratos.contratos')
      or public.tiene_pestana(v_uid, 'contratos.aprobar_minutas')
      or public.tiene_pestana(v_uid, 'admin.visualizacion')
    ) and public.usuario_puede_ver_proyecto(v_uid, c.proyecto_id)
      into v_ok from public.contratos c where c.id = p_id;
  elsif p_tipo = 'acta' then
    select public.puede_ver_actas(c.proyecto_id)
      into v_ok from public.actas a join public.contratos c on c.id = a.contrato_id where a.id = p_id;
  elsif p_tipo = 'pago' then
    select (public.tiene_pestana(v_uid, 'ayf.aprobacion_pagos') or public.tiene_pestana(v_uid, 'ayf.consolidado'))
      into v_ok from public.pagos where id = p_id;
  elsif p_tipo = 'tercero' then
    select (public.tiene_pestana(v_uid, 'ayf.terceros')
            or public.tiene_pestana(v_uid, 'ayf.aprobacion_pagos')
            or public.tiene_pestana(v_uid, 'ayf.consolidado'))
      into v_ok from public.terceros where id = p_id;
  elsif p_tipo = 'proveedor' then
    select (public.rol_compras(v_uid) or public.es_admin(v_uid) or public.tiene_pestana(v_uid, 'almacen.proveedores'))
      into v_ok from public.proveedores where unique_id = p_id;
  elsif p_tipo = 'contratista' then
    select (public.tiene_pestana(v_uid, 'contratos.contratistas')
            or public.tiene_pestana(v_uid, 'contratos.preaprobacion')
            or public.tiene_pestana(v_uid, 'contratos.aprobar_minutas')
            or public.tiene_pestana(v_uid, 'admin.visualizacion')
            or public.tiene_accion(v_uid, 'gestionar_contratistas')
            or public.tiene_accion(v_uid, 'solicitar_contratos'))
      into v_ok from public.contratistas where id = p_id;
  elsif p_tipo = 'entrada' then
    select ((public.tiene_pestana(v_uid, 'almacen.entradas') or public.rol_compras(v_uid))
            and public.usuario_puede_ver_proyecto(v_uid, o.proyecto_id))
      into v_ok
      from public.entradas_almacen e join public.ordenes_compra o on o.id = e.orden_compra_id
     where e.id = p_id;
  elsif p_tipo = 'salida' then
    select (public.tiene_pestana(v_uid, 'almacen.salidas') and public.usuario_puede_ver_proyecto(v_uid, s.proyecto_id))
      into v_ok from public.salidas_insumos s where s.id = p_id;
  elsif p_tipo = 'presupuesto' then
    select public.usuario_puede_ver_proyecto(v_uid, p.proyecto_id)
      into v_ok from public.presupuestos p where p.id = p_id;
  elsif p_tipo in ('rol', 'usuario', 'solicitud_insumo', 'solicitud_mano_obra', 'solicitud_equipo') then
    v_ok := false;  -- solo el Administrador (abajo)
  else
    raise exception 'Tipo de historial desconocido.';
  end if;

  -- El Administrador ve todo, también lo que ya se borró (presupuesto descartado...).
  if not coalesce(v_ok, false) and not public.es_admin(v_uid) then
    raise exception 'No tienes permiso para ver este historial.';
  end if;

  if p_tipo = 'requisicion' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre, 'usuario_rol', r.nombre,
               'motivo', h.motivo,
               'datos', case when h.entidad_tipo = 'pedido'
                             then coalesce(h.datos, '{}'::jsonb) || jsonb_build_object('insumo', mi.descripcion)
                             else h.datos end,
               'created_at', h.created_at
             ) order by h.created_at, h.id)
        from public.historial_eventos h
        left join public.perfiles pf on pf.id = h.usuario_id
        left join public.roles r on r.id = pf.rol_id
        left join public.pedidos_insumos pe on h.entidad_tipo = 'pedido' and pe.id = h.entidad_id
        left join public.maestro_insumos mi on mi.id = pe.insumo_id
       where (h.entidad_tipo = 'requisicion' and h.entidad_id = p_id)
          or (h.entidad_tipo = 'pedido' and h.evento = 'rechazado_por_compras'
              and pe.grupo_pedido_id = p_id)
    ), '[]'::jsonb);
  end if;

  if p_tipo = 'tercero' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ev.id::text, 'evento', ev.evento, 'usuario_nombre', pf.nombre, 'usuario_rol', r.nombre,
               'motivo', null, 'datos', ev.datos, 'created_at', ev.creado_en
             ) order by ev.creado_en, ev.id)
        from public._eventos_terceros_auditoria(
               array(select a.id from public.terceros_auditoria a
                      where (a.tabla = 'terceros' and a.registro_id = p_id)
                         or (a.tabla = 'terceros_cuentas'
                             and a.registro_id in (select c.id from public.terceros_cuentas c where c.tercero_id = p_id)))
             ) ev
        left join public.perfiles pf on pf.id = ev.usuario_id
        left join public.roles r on r.id = pf.rol_id
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre, 'usuario_rol', r.nombre,
             'motivo', h.motivo, 'datos', h.datos, 'created_at', h.created_at
           ) order by h.created_at, h.id)
      from public.historial_eventos h
      left join public.perfiles pf on pf.id = h.usuario_id
      left join public.roles r on r.id = pf.rol_id
     where h.entidad_tipo = p_tipo and h.entidad_id = p_id
  ), '[]'::jsonb);
end;
$function$;

-- Traducción de filas de terceros_auditoria a eventos (la usan historial_entidad
-- y listar_auditoria). Recibe los id de auditoría a traducir.
create or replace function public._eventos_terceros_auditoria(p_ids bigint[])
returns table (id bigint, tercero_id uuid, usuario_id uuid, creado_en timestamptz, evento text, datos jsonb)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.id,
         case when a.tabla = 'terceros' then a.registro_id
              else (coalesce(a.despues, a.antes) ->> 'tercero_id')::uuid end,
         a.usuario_id, a.creado_en,
         case
           when a.tabla = 'terceros' then
             case a.accion when 'INSERT' then 'tercero_creado' when 'DELETE' then 'tercero_borrado' else 'tercero_editado' end
           when a.accion = 'INSERT' then 'cuenta_agregada'
           when a.accion = 'DELETE' then 'cuenta_borrada'
           when (a.antes ->> 'banco_id', a.antes ->> 'tipo_cuenta', a.antes ->> 'numero_cuenta')
                is distinct from (a.despues ->> 'banco_id', a.despues ->> 'tipo_cuenta', a.despues ->> 'numero_cuenta')
             then 'cuenta_modificada'
           when a.despues ->> 'estado' is distinct from a.antes ->> 'estado' then
             case a.despues ->> 'estado' when 'ACTIVO' then 'cuenta_verificada'
                                         when 'INACTIVO' then 'cuenta_inactivada'
                                         else 'cuenta_pendiente' end
           else 'cuenta_editada'
         end,
         case
           when a.tabla = 'terceros' and a.accion = 'UPDATE' then
             jsonb_build_object('cambios', public._jsonb_cambios(a.antes, a.despues, array['id', 'creado_por', 'creado_en']))
           when a.tabla = 'terceros' then
             jsonb_build_object('razon_social', coalesce(a.despues, a.antes) ->> 'razon_social')
           else
             jsonb_build_object(
               'cuenta', coalesce(bd.nombre, 'Banco') || ' · ' || (coalesce(a.despues, a.antes) ->> 'tipo_cuenta')
                         || ' ' || (coalesce(a.despues, a.antes) ->> 'numero_cuenta'),
               'cuenta_antes', case when a.accion = 'UPDATE'
                                    and (a.antes ->> 'banco_id', a.antes ->> 'tipo_cuenta', a.antes ->> 'numero_cuenta')
                                        is distinct from (a.despues ->> 'banco_id', a.despues ->> 'tipo_cuenta', a.despues ->> 'numero_cuenta')
                               then coalesce(ba.nombre, 'Banco') || ' · ' || (a.antes ->> 'tipo_cuenta') || ' ' || (a.antes ->> 'numero_cuenta')
                               end,
               'estado', coalesce(a.despues, a.antes) ->> 'estado')
         end
    from public.terceros_auditoria a
    left join public.bancos bd on bd.id = (coalesce(a.despues, a.antes) ->> 'banco_id')::uuid
    left join public.bancos ba on ba.id = (a.antes ->> 'banco_id')::uuid
   where a.id = any (p_ids)
$function$;
revoke all on function public._eventos_terceros_auditoria(bigint[]) from public, anon, authenticated;

-- -------------------------------------------------------- listar_auditoria
-- Pantalla Auditoría (/admin/auditoria), solo Administrador. Todo lo que quedó
-- en historial_eventos y terceros_auditoria, más reciente primero, con
-- filtros opcionales. Devuelve p_limite filas como mucho desde p_offset (la
-- pantalla pide una de más para saber si hay página siguiente). Cada fila trae
-- una referencia legible ("OC 45", "Acta 2 · CJ-17-2026", el nombre del
-- proveedor...) calculada solo para la página pedida.
create or replace function public.listar_auditoria(
  p_tipo text default null,
  p_usuario uuid default null,
  p_desde date default null,
  p_hasta date default null,
  p_offset integer default 0,
  p_limite integer default 51
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_desde timestamptz := case when p_desde is null then null
                              else (p_desde::timestamp at time zone 'America/Bogota') end;
  v_hasta timestamptz := case when p_hasta is null then null
                              else ((p_hasta + 1)::timestamp at time zone 'America/Bogota') end;
  v_n integer := least(greatest(coalesce(p_limite, 51), 1), 201) + greatest(coalesce(p_offset, 0), 0);
begin
  if not public.es_admin(auth.uid()) then
    raise exception 'Solo el Administrador ve la auditoría.';
  end if;

  return coalesce((
    with base as (
      (select h.id::text as id, h.entidad_tipo as tipo, h.entidad_id, h.evento, h.usuario_id,
              h.motivo, h.datos, h.created_at
         from public.historial_eventos h
        where (p_tipo is null or h.entidad_tipo = p_tipo)
          and (p_usuario is null or h.usuario_id = p_usuario)
          and (v_desde is null or h.created_at >= v_desde)
          and (v_hasta is null or h.created_at < v_hasta)
        order by h.created_at desc, h.id
        limit v_n)
      union all
      (select 't' || a.id::text, 'tercero', null::uuid, null, a.usuario_id, null, null, a.creado_en
         from public.terceros_auditoria a
        where (p_tipo is null or p_tipo = 'tercero')
          and (p_usuario is null or a.usuario_id = p_usuario)
          and (v_desde is null or a.creado_en >= v_desde)
          and (v_hasta is null or a.creado_en < v_hasta)
        order by a.creado_en desc, a.id
        limit v_n)
    ),
    pagina as (
      select * from base
       order by created_at desc, id
      offset greatest(coalesce(p_offset, 0), 0)
       limit least(greatest(coalesce(p_limite, 51), 1), 201)
    ),
    -- Las filas de terceros se traducen a eventos solo para la página.
    terceros_ev as (
      select 't' || ev.id::text as id, ev.tercero_id, ev.evento, ev.datos
        from public._eventos_terceros_auditoria(
               array(select substr(p.id, 2)::bigint from pagina p where p.tipo = 'tercero')) ev
    ),
    filas as (
      select p.id, p.tipo,
             coalesce(p.entidad_id, te.tercero_id) as entidad_id,
             coalesce(p.evento, te.evento) as evento,
             p.motivo,
             coalesce(p.datos, te.datos) as datos,
             p.created_at, p.usuario_id
        from pagina p
        left join terceros_ev te on te.id = p.id
    )
    select jsonb_agg(jsonb_build_object(
             'id', f.id, 'tipo', f.tipo, 'entidad_id', f.entidad_id, 'evento', f.evento,
             'motivo', f.motivo, 'datos', f.datos, 'created_at', f.created_at,
             'usuario_nombre', pf.nombre, 'usuario_rol', r.nombre,
             'referencia', coalesce(
               case f.tipo
                 when 'orden_compra' then (select 'OC ' || o.numero from public.ordenes_compra o where o.id = f.entidad_id)
                 when 'requisicion' then (select 'Requisición ' || q.numero from public.requisiciones q where q.id = f.entidad_id)
                 when 'pedido' then (select mi.descripcion from public.pedidos_insumos pe
                                       join public.maestro_insumos mi on mi.id = pe.insumo_id where pe.id = f.entidad_id)
                 when 'contrato' then (select coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero) from public.contratos c where c.id = f.entidad_id)
                 when 'acta' then (select 'Acta ' || a.numero || ' · ' || coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero)
                                     from public.actas a join public.contratos c on c.id = a.contrato_id where a.id = f.entidad_id)
                 when 'pago' then (select coalesce('OC ' || o.numero, 'Acta ' || a.numero || ' · ' || coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero), pg.concepto)
                                     from public.pagos pg
                                     left join public.ordenes_compra o on o.id = pg.orden_compra_id
                                     left join public.actas a on a.id = pg.acta_id
                                     left join public.contratos c on c.id = a.contrato_id
                                    where pg.id = f.entidad_id)
                 when 'proveedor' then (select pv.nombre from public.proveedores pv where pv.unique_id = f.entidad_id)
                 when 'tercero' then (select t.razon_social from public.terceros t where t.id = f.entidad_id)
                 when 'contratista' then (select k.nombre from public.contratistas k where k.id = f.entidad_id)
                 when 'entrada' then (select 'Entrada ' || e.numero || coalesce(' · OC ' || o.numero, '')
                                        from public.entradas_almacen e
                                        left join public.ordenes_compra o on o.id = e.orden_compra_id
                                       where e.id = f.entidad_id)
                 when 'salida' then (select mi.descripcion from public.salidas_insumos s
                                       join public.maestro_insumos mi on mi.id = s.insumo_id where s.id = f.entidad_id)
                 when 'presupuesto' then (select pr.codigo from public.presupuestos p
                                            join public.proyectos pr on pr.id = p.proyecto_id where p.id = f.entidad_id)
                 when 'rol' then (select ro.nombre from public.roles ro where ro.id = f.entidad_id)
                 when 'usuario' then (select u.nombre from public.perfiles u where u.id = f.entidad_id)
               end,
               f.datos ->> 'descripcion', f.datos ->> 'nombre', f.datos ->> 'proyecto', f.datos ->> 'rol')
           ) order by f.created_at desc, f.id)
      from filas f
      left join public.perfiles pf on pf.id = f.usuario_id
      left join public.roles r on r.id = pf.rol_id
  ), '[]'::jsonb);
end;
$function$;
