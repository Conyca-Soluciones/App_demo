-- Requisiciones extraordinarias (decisión del usuario, 2026-11-05).
--
-- Cuando el ingeniero necesita MÁS de lo que el presupuesto contempla para un
-- insumo en un ítem, la pide a Gerencia con "Solicitar a Gerencia": una
-- requisición marcada `extraordinaria`, de uno o varios insumos (cada uno en
-- su ítem, esté o no en el APU del ítem), con cantidades y justificación. No
-- revisa el cupo (se puede pedir por encima), pero SÍ lo descuenta como
-- cualquier requisición mientras esté pendiente o aprobada (decisión del
-- usuario: si se usa por error cuando todavía había cupo, el cupo debe bajar).
-- `_comprometido_insumo_item` no cambia.
--
-- Es una requisición normal en todo lo demás (número, líneas en
-- pedidos_insumos, estado, historial, Compras, almacén); solo cambia quién la
-- aprueba:
--   - normales: acción `aprobar_pedidos` (Gerencia técnica), como siempre;
--   - extraordinarias: acción nueva `aprobar_requisiciones_extraordinarias`
--     (Gerencia), pestaña nueva `tecnico.aprobar_extraordinarias`.
-- Gerencia deja de aprobar las normales (se le quitan la pestaña y las
-- acciones de requisiciones normales).
--
-- Va después de 20261225000000. Parcha sobre la versión VIVA (texto exacto,
-- falla si no lo encuentra) `modificar_requisicion` y `_pendientes_de`.

-- ---------------------------------------------------------------- columnas
alter table public.requisiciones
  add column if not exists extraordinaria boolean not null default false,
  add column if not exists justificacion text;

alter table public.requisiciones drop constraint if exists requisiciones_extraordinaria_justificacion_check;
alter table public.requisiciones add constraint requisiciones_extraordinaria_justificacion_check
  check (not extraordinaria or nullif(trim(justificacion), '') is not null);

create index if not exists idx_requisiciones_extraordinarias
  on public.requisiciones (estado, created_at) where extraordinaria;

-- La vista suma las dos columnas al final (create or replace solo deja agregar al final).
create or replace view public.requisiciones_vista
with (security_invoker = true) as
select r.id,
       r.numero,
       r.proyecto_id,
       pr.codigo as proyecto_codigo,
       pr.nombre as proyecto_nombre,
       r.solicitado_por,
       pf.nombre as solicitante_nombre,
       r.fecha_requerida,
       r.urgente,
       r.observaciones,
       r.soporte_url,
       r.created_at,
       r.n_lineas,
       r.estado,
       r.estado_compra,
       r.extraordinaria,
       r.justificacion
  from requisiciones r
  left join proyectos pr on pr.id = r.proyecto_id
  left join perfiles pf on pf.id = r.solicitado_por;

-- ---------------------------------------------------------------- notificaciones
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo = any (array[
  'pedido_rechazado', 'pedido_aprobado', 'orden_compra_rechazada', 'orden_compra_aprobada',
  'insumo_sobre_presupuesto', 'orden_compra_precio_sobre_efectivo', 'contrato_por_revisar',
  'contrato_aprobado', 'contrato_devuelto', 'contrato_rechazado', 'acta_aprobada', 'acta_rechazada',
  'minuta_por_revisar', 'minuta_aprobada', 'minuta_devuelta', 'contrato_vencido',
  'contrato_vencido_juridica', 'insumo_rechazado', 'otrosi_por_revisar', 'otrosi_por_aprobar',
  'otrosi_devuelto', 'otrosi_rechazado', 'otrosi_aprobado', 'otrosi_devuelto_subgerencia',
  'poliza_pendiente', 'poliza_por_revisar', 'poliza_aprobada', 'poliza_devuelta',
  'requisicion_admin_aprobada', 'requisicion_admin_rechazada',
  'requisicion_extraordinaria'
]::text[])) not valid;

-- ---------------------------------------------------------------- crear
-- p_lineas: [{presupuesto_item_id, insumo_id, cantidad}], 1 a 50, sin repetir
-- insumo + ítem, todos del mismo proyecto y de la versión vigente. El insumo
-- puede NO estar en el APU del ítem (se rompió algo y hay que comprar un
-- material que el ítem no tenía): entonces la línea va sin item_apu_id (la
-- unidad es la del maestro) y Gerencia lo ve marcado.
drop function if exists public.crear_requisicion_extraordinaria(uuid, uuid, numeric, date, boolean, text);
create or replace function public.crear_requisicion_extraordinaria(
  p_lineas jsonb,
  p_fecha_requerida date,
  p_urgente boolean,
  p_justificacion text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_numero bigint;
  v_just text := nullif(trim(p_justificacion), '');
  v_total int;
  v_proyectos int;
  v_proyecto uuid;
  v_lineas jsonb;
  l record;
begin
  if v_uid is null then raise exception 'No autenticado.'; end if;
  if not public.tiene_pestana(v_uid, 'tecnico.pedidos') then
    raise exception 'No tienes permiso para crear requisiciones (pestaña Elaboración de requisiciones).';
  end if;
  if v_just is null then raise exception 'Escribe por qué se necesita más de lo presupuestado.'; end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos un insumo a la requisición.';
  end if;
  if jsonb_array_length(p_lineas) > 50 then
    raise exception 'Una requisición puede tener máximo 50 insumos.';
  end if;
  if p_fecha_requerida is null then raise exception 'La fecha requerida es obligatoria.'; end if;
  if p_fecha_requerida < (now() at time zone 'America/Bogota')::date then
    raise exception 'La fecha requerida no puede ser anterior a hoy.';
  end if;

  -- Cada línea con su ítem, su presupuesto y (si está) la línea del APU.
  select jsonb_agg(jsonb_build_object(
           'presupuesto_item_id', x.presupuesto_item_id, 'insumo_id', x.insumo_id, 'cantidad', x.cantidad,
           'proyecto_id', pr.proyecto_id, 'version_actual_id', pr.version_actual_id, 'version_id', pi.version_id,
           'item_apu_id', (select ia.id from item_apu ia
                            where ia.apu_id = pi.apu_id and ia.insumo_id = x.insumo_id
                            order by ia.id limit 1)))
    into v_lineas
    from jsonb_to_recordset(p_lineas) as x(presupuesto_item_id uuid, insumo_id uuid, cantidad numeric)
    left join presupuesto_items pi on pi.id = x.presupuesto_item_id
    left join presupuestos pr on pr.id = pi.presupuesto_id;

  select count(*)::int, count(distinct proyecto_id)::int, (array_agg(proyecto_id))[1]
    into v_total, v_proyectos, v_proyecto
    from jsonb_to_recordset(v_lineas) as _lineas_extra(presupuesto_item_id uuid, insumo_id uuid, cantidad numeric, proyecto_id uuid, version_actual_id uuid, version_id uuid, item_apu_id uuid);

  if exists (select 1 from jsonb_to_recordset(v_lineas) as _lineas_extra(presupuesto_item_id uuid, insumo_id uuid, cantidad numeric, proyecto_id uuid, version_actual_id uuid, version_id uuid, item_apu_id uuid) where proyecto_id is null) then
    raise exception 'Hay un ítem del presupuesto que no existe.';
  end if;
  if v_proyectos <> 1 then
    raise exception 'Una requisición solo puede tener ítems de un mismo proyecto.';
  end if;
  if exists (select 1 from jsonb_to_recordset(v_lineas) as _lineas_extra(presupuesto_item_id uuid, insumo_id uuid, cantidad numeric, proyecto_id uuid, version_actual_id uuid, version_id uuid, item_apu_id uuid) where version_id is distinct from version_actual_id) then
    raise exception 'Hay un ítem que no es de la versión vigente del presupuesto.';
  end if;
  if (select count(distinct (insumo_id, presupuesto_item_id)) from jsonb_to_recordset(v_lineas) as _lineas_extra(presupuesto_item_id uuid, insumo_id uuid, cantidad numeric, proyecto_id uuid, version_actual_id uuid, version_id uuid, item_apu_id uuid)) <> v_total then
    raise exception 'Hay un insumo repetido para el mismo ítem del presupuesto.';
  end if;
  if exists (select 1 from jsonb_to_recordset(v_lineas) as l2(presupuesto_item_id uuid, insumo_id uuid, cantidad numeric, proyecto_id uuid, version_actual_id uuid, version_id uuid, item_apu_id uuid) where not exists (select 1 from maestro_insumos mi where mi.id = l2.insumo_id)) then
    raise exception 'Hay un insumo que no existe en el maestro.';
  end if;
  for l in select * from jsonb_to_recordset(v_lineas) as _lineas_extra(presupuesto_item_id uuid, insumo_id uuid, cantidad numeric, proyecto_id uuid, version_actual_id uuid, version_id uuid, item_apu_id uuid) loop
    if l.cantidad is null or l.cantidad <= 0 or l.cantidad <> trunc(l.cantidad) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero.';
    end if;
    if not public.usuario_tiene_acceso_a_item(l.presupuesto_item_id) then
      raise exception 'No tienes acceso al proyecto de este ítem.';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtext('requisicion:' || v_proyecto::text));

  insert into requisiciones
    (id, proyecto_id, solicitado_por, fecha_requerida, urgente, observaciones, extraordinaria, justificacion)
  values
    (v_id, v_proyecto, v_uid, p_fecha_requerida, coalesce(p_urgente, false), v_just, true, v_just)
  returning numero into v_numero;

  insert into pedidos_insumos
    (grupo_pedido_id, presupuesto_item_id, item_apu_id, insumo_id, cantidad,
     fecha_requerida, urgente, observaciones, solicitado_por)
  select v_id, presupuesto_item_id, item_apu_id, insumo_id, cantidad,
         p_fecha_requerida, coalesce(p_urgente, false), v_just, v_uid
    from jsonb_to_recordset(v_lineas) as _lineas_extra(presupuesto_item_id uuid, insumo_id uuid, cantidad numeric, proyecto_id uuid, version_actual_id uuid, version_id uuid, item_apu_id uuid);

  perform public._evento_requisicion(v_id, 'creada', null,
    jsonb_build_object('numero', v_numero, 'insumos', v_total, 'extraordinaria', true,
                       'fuera_de_apu', (select count(*) from jsonb_to_recordset(v_lineas) as _lineas_extra(presupuesto_item_id uuid, insumo_id uuid, cantidad numeric, proyecto_id uuid, version_actual_id uuid, version_id uuid, item_apu_id uuid) where item_apu_id is null)));

  -- A quienes aprueban extraordinarias y ven el proyecto (no a los
  -- Administradores, igual que los demás avisos de aprobación).
  insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  select pf.id, 'requisicion_extraordinaria', 'requisicion', v_id,
         'Requisición extraordinaria por aprobar',
         'Requisición extraordinaria #' || v_numero || ': ' || v_total
           || case when v_total = 1 then ' insumo' else ' insumos' end || ' por encima del presupuesto.'
  from perfiles pf
  left join roles r on r.id = pf.rol_id
  where pf.id is distinct from v_uid
    and r.clave is distinct from 'administrador'
    and public.tiene_accion(pf.id, 'aprobar_requisiciones_extraordinarias')
    and public.usuario_puede_ver_proyecto(pf.id, v_proyecto);

  return jsonb_build_object('id', v_id, 'numero', v_numero);
end;
$$;
revoke all on function public.crear_requisicion_extraordinaria(jsonb, date, boolean, text) from public, anon;
grant execute on function public.crear_requisicion_extraordinaria(jsonb, date, boolean, text) to authenticated;

-- ---------------------------------------------------------------- aprobar / rechazar
-- La acción que se exige depende del tipo de requisición.
-- Conserva el default de p_comentario que tiene en la base (si no, Postgres no deja reemplazarla).
create or replace function public._resolver_requisicion_sin_proyecto(p_id uuid, p_estado text, p_comentario text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h record;
  v_motivo text := nullif(trim(p_comentario), '');
  v_n int;
  v_nombre text;
begin
  if p_estado not in ('aprobado', 'rechazado') then
    raise exception 'Estado inválido.';
  end if;
  if p_estado = 'rechazado' and v_motivo is null then
    raise exception 'Escribe el motivo del rechazo.';
  end if;

  select * into v_h from requisiciones where id = p_id for update;
  if not found then raise exception 'La requisición no existe.'; end if;

  if v_h.extraordinaria then
    if not public.tiene_accion(v_uid, 'aprobar_requisiciones_extraordinarias') then
      raise exception 'No autorizado -- las requisiciones extraordinarias las aprueba Gerencia.';
    end if;
  elsif not public.tiene_accion(v_uid, 'aprobar_pedidos') then
    raise exception 'No autorizado -- no tienes permiso para aprobar requisiciones.';
  end if;

  update pedidos_insumos
     set estado = p_estado, resuelto_por = v_uid, resuelto_at = now(),
         comentario_resolucion = v_motivo
   where grupo_pedido_id = p_id and estado = 'pendiente';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Esta requisición ya no está pendiente (la cancelaron o ya fue resuelta). Actualiza la página.';
  end if;

  perform public._evento_requisicion(p_id,
    case p_estado when 'aprobado' then 'aprobada' else 'rechazada' end, v_motivo,
    jsonb_build_object('insumos', v_n));

  v_nombre := case when v_h.extraordinaria then 'requisición extraordinaria' else 'requisición' end;
  perform public.notificar_una(
    v_h.solicitado_por,
    case p_estado when 'aprobado' then 'pedido_aprobado' else 'pedido_rechazado' end,
    'requisicion', p_id,
    'R' || substr(v_nombre, 2) || ' '
      || case p_estado when 'aprobado' then 'aprobada' else 'rechazada' end,
    'Tu ' || v_nombre || ' #' || v_h.numero || ' fue ' ||
      case p_estado when 'aprobado' then 'aprobada' else 'rechazada' end || '.' ||
      case when p_estado = 'rechazado' then ' Motivo: ' || v_motivo else '' end
  );
end;
$$;

create or replace function public._desaprobar_requisicion_sin_proyecto(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_motivo text := nullif(trim(p_motivo), '');
  v_extra boolean;
  v_n int;
begin
  select extraordinaria into v_extra from requisiciones where id = p_id for update;
  if not found then raise exception 'La requisición no existe.'; end if;

  if v_extra then
    if not public.tiene_accion(v_uid, 'aprobar_requisiciones_extraordinarias') then
      raise exception 'No autorizado -- las requisiciones extraordinarias las maneja Gerencia.';
    end if;
  elsif not public.tiene_accion(v_uid, 'desaprobar_pedidos') then
    raise exception 'No autorizado -- no tienes permiso para desaprobar requisiciones.';
  end if;
  if v_motivo is null then raise exception 'El motivo es obligatorio.'; end if;

  if not exists (select 1 from pedidos_insumos where grupo_pedido_id = p_id and estado = 'aprobado') then
    raise exception 'Solo se puede desaprobar una requisición aprobada.';
  end if;
  if exists (
    select 1 from pedidos_insumos p
    where p.grupo_pedido_id = p_id and p.estado = 'aprobado' and public._comprado_pedido(p.id) > 0
  ) then
    raise exception 'La requisición ya tiene insumos en una orden de compra: no se puede desaprobar. Cancela primero la orden.';
  end if;

  update pedidos_insumos
     set estado = 'pendiente',
         resuelto_por = null, resuelto_at = null, comentario_resolucion = null,
         desaprobado_por = v_uid, desaprobado_at = now(), motivo_desaprobacion = v_motivo
   where grupo_pedido_id = p_id and estado = 'aprobado';
  get diagnostics v_n = row_count;

  perform public._evento_requisicion(p_id, 'desaprobada', v_motivo, jsonb_build_object('insumos', v_n));
end;
$$;

-- ---------------------------------------------------------------- modificar (parche)
-- Una extraordinaria no se modifica (modificar revisa el cupo línea por
-- línea): se cancela y se pide otra.
do $$
declare
  v text := pg_get_functiondef('public.modificar_requisicion(uuid, jsonb, date, boolean, text)'::regprocedure);
  v_buscar text := E'  if v_h.solicitado_por is distinct from v_uid then\n    raise exception ''Solo quien hizo la requisición puede modificarla.'';';
begin
  if position('v_h.extraordinaria' in v) > 0 then return; end if;
  if position(v_buscar in v) = 0 then
    raise exception 'modificar_requisicion cambió: no se encontró el texto a parchar.';
  end if;
  execute replace(v, v_buscar,
    E'  if v_h.extraordinaria then\n    raise exception ''Una requisición extraordinaria no se modifica: cancélala y solicita otra.'';\n  end if;\n'
    || v_buscar);
end;
$$;

-- ---------------------------------------------------------------- listar (Gerencia)
-- Una fila por requisición extraordinaria con sus líneas y, por línea, lo que
-- Gerencia necesita para decidir: si el insumo está en el APU del ítem, cuánto
-- contempla el presupuesto y cuánto se ha pedido ya de ese insumo (en el ítem,
-- en extraordinarias anteriores y en todo el proyecto). SECURITY DEFINER:
-- Gerencia puede no leer las tablas de requisiciones; se exige la pestaña y
-- los proyectos que ve.
create or replace function public.listar_requisiciones_extraordinarias(
  p_estado text default null,
  p_proyecto_id uuid default null,
  p_offset int default 0,
  p_limite int default 51
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_res jsonb;
begin
  if v_uid is null then raise exception 'No autenticado.'; end if;
  if not public.tiene_pestana(v_uid, 'tecnico.aprobar_extraordinarias') then
    raise exception 'No tienes acceso a Aprobación de requisiciones extraordinarias.';
  end if;

  with pagina as (
    select r.*,
           row_number() over (order by
             case when p_estado = 'pendiente' then r.urgente end desc nulls last,
             case when p_estado = 'pendiente' then r.created_at end asc,
             r.created_at desc,
             r.numero desc) as ord
      from requisiciones r
     where r.extraordinaria
       and r.proyecto_id in (select public.proyectos_visibles(v_uid))
       and (p_estado is null or r.estado = p_estado)
       and (p_proyecto_id is null or r.proyecto_id = p_proyecto_id)
     order by ord
     offset greatest(coalesce(p_offset, 0), 0)
     limit least(greatest(coalesce(p_limite, 51), 1), 201)
  ),
  lineas as (
    select p.grupo_pedido_id, p.id, p.cantidad, p.insumo_id, p.proyecto_id, p.created_at,
           p.item_apu_id is not null as en_apu,
           pi.codigo as item_codigo, pi.descripcion as item_descripcion,
           pi.presupuesto_id, pi.apu_id, pi.cantidad as item_cantidad,
           mi.codigo as insumo_codigo, mi.descripcion as insumo_descripcion, mi.u_m as insumo_um
      from pedidos_insumos p
      join pagina pg on pg.id = p.grupo_pedido_id
      join presupuesto_items pi on pi.id = p.presupuesto_item_id
      left join maestro_insumos mi on mi.id = p.insumo_id
  ),
  lineas_ctx as (
    select l.grupo_pedido_id, jsonb_agg(jsonb_build_object(
             'id', l.id,
             'insumo_codigo', l.insumo_codigo,
             'insumo_descripcion', l.insumo_descripcion,
             'insumo_um', l.insumo_um,
             'item_codigo', l.item_codigo,
             'item_descripcion', l.item_descripcion,
             'cantidad', l.cantidad,
             'en_apu', l.en_apu,
             'presupuestado', ctx.presupuestado,
             'pedido_item', ctx.pedido_item,
             'requisiciones_item', ctx.requisiciones_item,
             'extra_previas', ctx.extra_previas,
             'extra_previas_cantidad', ctx.extra_previas_cantidad,
             'pedido_proyecto', ctx.pedido_proyecto,
             'requisiciones_proyecto', ctx.requisiciones_proyecto
           ) order by l.created_at, l.id) as lineas
      from lineas l
      cross join lateral (
        select
          -- Lo que contempla el presupuesto para el insumo en el ítem (0 si no está en su APU).
          (select coalesce(sum(ia.cantidad), 0) * coalesce(l.item_cantidad, 0)
             from item_apu ia where ia.apu_id = l.apu_id and ia.insumo_id = l.insumo_id) as presupuestado,
          -- Requisiciones normales (pendientes o aprobadas) del insumo en el
          -- mismo ítem, también en versiones anteriores (mismo código).
          (select coalesce(sum(p.cantidad), 0)
             from presupuesto_items mi2
             join pedidos_insumos p on p.presupuesto_item_id = mi2.id and p.insumo_id = l.insumo_id
                                   and p.estado in ('pendiente', 'aprobado')
             join requisiciones r2 on r2.id = p.grupo_pedido_id and not r2.extraordinaria
            where mi2.presupuesto_id = l.presupuesto_id and mi2.codigo = l.item_codigo) as pedido_item,
          (select count(distinct p.grupo_pedido_id)
             from presupuesto_items mi2
             join pedidos_insumos p on p.presupuesto_item_id = mi2.id and p.insumo_id = l.insumo_id
                                   and p.estado in ('pendiente', 'aprobado')
             join requisiciones r2 on r2.id = p.grupo_pedido_id and not r2.extraordinaria
            where mi2.presupuesto_id = l.presupuesto_id and mi2.codigo = l.item_codigo) as requisiciones_item,
          -- Otras extraordinarias (pendientes o aprobadas) del insumo en el ítem.
          (select count(distinct p.grupo_pedido_id)
             from presupuesto_items mi2
             join pedidos_insumos p on p.presupuesto_item_id = mi2.id and p.insumo_id = l.insumo_id
                                   and p.estado in ('pendiente', 'aprobado') and p.grupo_pedido_id <> l.grupo_pedido_id
             join requisiciones r2 on r2.id = p.grupo_pedido_id and r2.extraordinaria
            where mi2.presupuesto_id = l.presupuesto_id and mi2.codigo = l.item_codigo) as extra_previas,
          (select coalesce(sum(p.cantidad), 0)
             from presupuesto_items mi2
             join pedidos_insumos p on p.presupuesto_item_id = mi2.id and p.insumo_id = l.insumo_id
                                   and p.estado in ('pendiente', 'aprobado') and p.grupo_pedido_id <> l.grupo_pedido_id
             join requisiciones r2 on r2.id = p.grupo_pedido_id and r2.extraordinaria
            where mi2.presupuesto_id = l.presupuesto_id and mi2.codigo = l.item_codigo) as extra_previas_cantidad,
          -- Todo lo pedido del insumo en el proyecto (cualquier ítem, normales y
          -- extraordinarias), sin contar esta requisición.
          (select coalesce(sum(p.cantidad), 0)
             from pedidos_insumos p
            where p.proyecto_id = l.proyecto_id and p.insumo_id = l.insumo_id
              and p.estado in ('pendiente', 'aprobado') and p.grupo_pedido_id <> l.grupo_pedido_id) as pedido_proyecto,
          (select count(distinct p.grupo_pedido_id)
             from pedidos_insumos p
            where p.proyecto_id = l.proyecto_id and p.insumo_id = l.insumo_id
              and p.estado in ('pendiente', 'aprobado') and p.grupo_pedido_id <> l.grupo_pedido_id) as requisiciones_proyecto
      ) ctx
     group by l.grupo_pedido_id
  ),
  -- Quién resolvió y con qué motivo (es el mismo en todas las líneas).
  resolucion as (
    select distinct on (p.grupo_pedido_id) p.grupo_pedido_id, p.comentario_resolucion, p.resuelto_at, p.resuelto_por
      from pedidos_insumos p
      join pagina pg on pg.id = p.grupo_pedido_id
     where p.resuelto_at is not null
     order by p.grupo_pedido_id, p.resuelto_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pg.id,
           'numero', pg.numero,
           'proyecto_id', pg.proyecto_id,
           'proyecto_codigo', pr.codigo,
           'proyecto_nombre', pr.nombre,
           'solicitante_nombre', sol.nombre,
           'created_at', pg.created_at,
           'fecha_requerida', pg.fecha_requerida,
           'urgente', pg.urgente,
           'estado', pg.estado,
           'justificacion', pg.justificacion,
           'motivo_resolucion', rs.comentario_resolucion,
           'resuelto_at', rs.resuelto_at,
           'resuelto_por_nombre', res.nombre,
           'lineas', coalesce(lc.lineas, '[]'::jsonb)
         ) order by pg.ord), '[]'::jsonb)
    into v_res
    from pagina pg
    left join lineas_ctx lc on lc.grupo_pedido_id = pg.id
    left join resolucion rs on rs.grupo_pedido_id = pg.id
    left join proyectos pr on pr.id = pg.proyecto_id
    left join perfiles sol on sol.id = pg.solicitado_por
    left join perfiles res on res.id = rs.resuelto_por;

  return v_res;
end;
$$;
revoke all on function public.listar_requisiciones_extraordinarias(text, uuid, int, int) from public, anon;
grant execute on function public.listar_requisiciones_extraordinarias(text, uuid, int, int) to authenticated;

-- ---------------------------------------------------------------- Mis pendientes (parche)
-- Quien aprueba normales ya no ve las extraordinarias; Gerencia ve las suyas.
do $$
declare
  v text := pg_get_functiondef('public._pendientes_de(uuid)'::regprocedure);
  v_buscar text := E'   where v_aprobar_pedidos and r.estado = ''pendiente'' and r.proyecto_id = any(v_proys)\n';
begin
  if position('req_extra_por_aprobar' in v) > 0 then return; end if;
  if position(v_buscar in v) = 0 then
    raise exception '_pendientes_de cambió: no se encontró el texto a parchar.';
  end if;
  execute replace(v, v_buscar,
    E'   where v_aprobar_pedidos and r.estado = ''pendiente'' and not r.extraordinaria and r.proyecto_id = any(v_proys)\n'
    || E'\n  -- ------------------------------------------------ Requisiciones extraordinarias por aprobar\n'
    || E'  union all\n'
    || E'  select ''req_extra_por_aprobar'', ''hacer'', r.id, r.proyecto_id,\n'
    || E'         ''Requisición extraordinaria N° '' || r.numero,\n'
    || E'         r.n_lineas || case when r.n_lineas = 1 then '' insumo'' else '' insumos'' end || '' por encima del presupuesto''\n'
    || E'           || case when r.urgente then '' · urgente'' else '''' end,\n'
    || E'         null::numeric, r.created_at, r.solicitado_por, r.fecha_requerida, ''/almacen/requisiciones-extraordinarias''\n'
    || E'    from requisiciones r\n'
    || E'   where (select public.tiene_accion(p_uid, ''aprobar_requisiciones_extraordinarias''))\n'
    || E'     and r.extraordinaria and r.estado = ''pendiente'' and r.proyecto_id = any(v_proys)\n');
end;
$$;

-- ---------------------------------------------------------------- permisos
-- Gerencia: la pestaña y la acción nuevas; deja de aprobar las normales.
insert into public.rol_permisos (rol_id, permiso)
select r.id, x.permiso
  from public.roles r
  cross join (values ('tab.tecnico.aprobar_extraordinarias'), ('accion.aprobar_requisiciones_extraordinarias')) x(permiso)
 where r.clave = 'gerencia'
on conflict do nothing;

delete from public.rol_permisos rp
 using public.roles r
 where r.id = rp.rol_id and r.clave = 'gerencia'
   and rp.permiso in ('tab.tecnico.aprobar_pedidos', 'accion.aprobar_pedidos', 'accion.desaprobar_pedidos');
