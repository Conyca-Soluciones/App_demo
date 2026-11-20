-- Modificar una requisición administrativa (decisión del usuario, 2026-11-20).
--
-- Antes no había cómo: "Modificar" del Registro de requisiciones usa el flujo de
-- las técnicas (cupo por ítem de la versión del presupuesto) y las
-- administrativas van contra un ítem oculto sin versión ("No se encontró la
-- versión del presupuesto de esta requisición").
-- modificar_requisicion_administrativa: solo quien la hizo y solo mientras
-- Subgerencia no la haya resuelto (todas sus líneas pendientes). Cambia los
-- insumos del maestro (agregar, quitar, cantidades), el proyecto (FUNCIONAMIENTO o
-- uno de los suyos con presupuesto), la fecha requerida, si es urgente, las
-- observaciones y la dirección de entrega. Conserva la fecha de la requisición.
-- Si cambia el proyecto, como el número RQ es del proyecto, recibe el siguiente
-- número del proyecto nuevo (RQ-000-0004 -> RQ-001-0012; el de antes queda en el
-- historial) y se avisa a quien aprueba en ese proyecto. Deja el evento
-- 'modificada' en el historial con lo que cambió.
-- detalle_requisicion_administrativa devuelve además insumo_id de cada línea,
-- proyecto_id y modificable.
--
-- Va ANTES del código. Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $f$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  p_a := replace(p_a, E'\r\n', E'\n');
  p_b := replace(p_b, E'\r\n', E'\n');
  if position(p_a in d) = 0 then
    raise exception 'No se encontró el texto a reemplazar en %: %', p_fn, left(p_a, 80);
  end if;
  execute replace(d, p_a, p_b);
end;
$f$;

select pg_temp._parche('public.detalle_requisicion_administrativa(uuid)'::regprocedure,
  $a$'id', p.id, 'insumo_codigo', mi.codigo,$a$,
  $b$'id', p.id, 'insumo_id', p.insumo_id, 'insumo_codigo', mi.codigo,$b$);
select pg_temp._parche('public.detalle_requisicion_administrativa(uuid)'::regprocedure,
  $a$    'direccion_entrega', v_r.direccion_entrega,$a$,
  $b$    'direccion_entrega', v_r.direccion_entrega,
    'proyecto_id', v_r.proyecto_id,
    'modificable', v_r.solicitado_por = v_uid
                   and exists (select 1 from public.pedidos_insumos p where p.grupo_pedido_id = p_id and p.estado = 'pendiente')
                   and not exists (select 1 from public.pedidos_insumos p
                                    where p.grupo_pedido_id = p_id and p.estado not in ('pendiente', 'cancelado')),$b$);

create or replace function public.modificar_requisicion_administrativa(
  p_id uuid, p_proyecto_id uuid, p_lineas jsonb, p_fecha_requerida date, p_urgente boolean, p_observaciones text, p_direccion_entrega text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_h record;
  v_item uuid;
  v_proyecto uuid := coalesce(p_proyecto_id, (select proyecto_id from requisiciones where id = p_id));
  v_proyecto_txt text;
  v_cambia_proyecto boolean;
  v_numero bigint;
  v_codigo text;
  v_obs text := nullif(btrim(coalesce(p_observaciones, '')), '');
  v_urgente boolean := coalesce(p_urgente, false);
  v_dir text := nullif(btrim(regexp_replace(coalesce(p_direccion_entrega, ''), '\s+', ' ', 'g')), '');
  v_total int;
  v_quitados jsonb;
  v_agregados jsonb;
  v_cambios jsonb;
  l record;
begin
  if v_uid is null then raise exception 'Inicia sesión.'; end if;
  select * into v_h from requisiciones where id = p_id for update;
  if not found or not v_h.administrativa then raise exception 'La requisición administrativa no existe.'; end if;
  if v_h.solicitado_por is distinct from v_uid then
    raise exception 'Solo quien hizo la requisición puede modificarla.';
  end if;

  perform 1 from pedidos_insumos where grupo_pedido_id = p_id for update;
  if exists (select 1 from pedidos_insumos where grupo_pedido_id = p_id and estado not in ('pendiente', 'cancelado'))
     or not exists (select 1 from pedidos_insumos where grupo_pedido_id = p_id and estado = 'pendiente') then
    raise exception 'Solo se puede modificar mientras Subgerencia no la haya aprobado ni rechazado.';
  end if;
  v_cambia_proyecto := v_proyecto is distinct from v_h.proyecto_id;
  if v_cambia_proyecto then
    select coalesce(codigo || ' - ', '') || nombre into v_proyecto_txt from proyectos
     where id = v_proyecto and (funcionamiento or id in (select proyectos_visibles(v_uid)));
    if v_proyecto_txt is null then raise exception 'El proyecto no existe o no tienes acceso.'; end if;
    v_item := _item_requisicion_administrativa(v_proyecto);
    if v_item is null then
      raise exception 'El proyecto no tiene presupuesto cargado: pide la requisición para FUNCIONAMIENTO o carga el presupuesto.';
    end if;
  else
    -- El ítem oculto del proyecto (el mismo de sus líneas).
    select presupuesto_item_id into v_item from pedidos_insumos where grupo_pedido_id = p_id and estado = 'pendiente' limit 1;
  end if;

  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La requisición debe tener al menos un insumo.';
  end if;
  if jsonb_array_length(p_lineas) > 50 then raise exception 'Una requisición puede tener máximo 50 insumos.'; end if;
  if p_fecha_requerida is null then raise exception 'La fecha requerida es obligatoria.'; end if;
  if p_fecha_requerida is distinct from v_h.fecha_requerida
     and p_fecha_requerida < (now() at time zone 'America/Bogota')::date then
    raise exception 'La fecha requerida no puede ser anterior a hoy.';
  end if;
  if v_dir is null then raise exception 'La dirección de entrega es obligatoria.'; end if;
  if length(v_dir) > 300 then raise exception 'La dirección de entrega es muy larga (máximo 300 caracteres).'; end if;

  select count(*)::int into v_total from jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric);
  if (select count(distinct x.insumo_id) from jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric)) <> v_total then
    raise exception 'Hay un insumo repetido en la requisición.';
  end if;
  for l in select * from jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric) loop
    if l.insumo_id is null or not exists (select 1 from maestro_insumos mi where mi.id = l.insumo_id) then
      raise exception 'Hay un insumo que no existe en el maestro.';
    end if;
    if l.cantidad is null or l.cantidad <= 0 or l.cantidad <> trunc(l.cantidad) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero.';
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('insumo', mi.descripcion, 'cantidad', p.cantidad)), '[]'::jsonb)
    into v_quitados
    from pedidos_insumos p join maestro_insumos mi on mi.id = p.insumo_id
   where p.grupo_pedido_id = p_id and p.estado = 'pendiente'
     and not exists (select 1 from jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric)
                      where x.insumo_id = p.insumo_id);
  select coalesce(jsonb_agg(jsonb_build_object('insumo', mi.descripcion, 'cantidad', x.cantidad)), '[]'::jsonb)
    into v_agregados
    from jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric)
    join maestro_insumos mi on mi.id = x.insumo_id
   where not exists (select 1 from pedidos_insumos p
                      where p.grupo_pedido_id = p_id and p.estado = 'pendiente' and p.insumo_id = x.insumo_id);
  select coalesce(jsonb_agg(jsonb_build_object('insumo', mi.descripcion, 'de', p.cantidad, 'a', x.cantidad)), '[]'::jsonb)
    into v_cambios
    from pedidos_insumos p
    join jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric) on x.insumo_id = p.insumo_id
    join maestro_insumos mi on mi.id = p.insumo_id
   where p.grupo_pedido_id = p_id and p.estado = 'pendiente' and p.cantidad <> x.cantidad;

  if v_quitados = '[]'::jsonb and v_agregados = '[]'::jsonb and v_cambios = '[]'::jsonb
     and p_fecha_requerida is not distinct from v_h.fecha_requerida
     and v_urgente = v_h.urgente
     and v_obs is not distinct from v_h.observaciones
     and v_dir is not distinct from v_h.direccion_entrega
     and not v_cambia_proyecto then
    raise exception 'No hay cambios que guardar.';
  end if;

  delete from pedidos_insumos p
   where p.grupo_pedido_id = p_id and p.estado = 'pendiente'
     and not exists (select 1 from jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric)
                      where x.insumo_id = p.insumo_id);

  -- Otro proyecto: sus líneas pasan al ítem oculto del proyecto nuevo y la
  -- requisición recibe el siguiente número de ese proyecto.
  if v_cambia_proyecto then
    perform pg_advisory_xact_lock(hashtext('requisicion:' || v_proyecto::text));
    update pedidos_insumos set presupuesto_item_id = v_item, proyecto_id = v_proyecto
     where grupo_pedido_id = p_id and estado = 'pendiente';
    v_numero := _siguiente_consecutivo(v_proyecto, 'requisicion');
    v_codigo := 'RQ-' || _numero_proyecto(v_proyecto) || '-' || _con_ceros(v_numero, 4);
    update requisiciones set proyecto_id = v_proyecto, numero = v_numero, codigo = v_codigo where id = p_id;
  end if;

  update pedidos_insumos p
     set cantidad = x.cantidad, fecha_requerida = p_fecha_requerida, urgente = v_urgente, observaciones = v_obs
    from jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric)
   where p.grupo_pedido_id = p_id and p.estado = 'pendiente' and x.insumo_id = p.insumo_id;

  insert into pedidos_insumos
    (grupo_pedido_id, presupuesto_item_id, proyecto_id, item_apu_id, insumo_id, cantidad,
     fecha_requerida, urgente, observaciones, solicitado_por, estado)
  select p_id, v_item, v_proyecto, null, x.insumo_id, x.cantidad, p_fecha_requerida, v_urgente, v_obs, v_h.solicitado_por, 'pendiente'
    from jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric)
   where not exists (select 1 from pedidos_insumos p
                      where p.grupo_pedido_id = p_id and p.estado = 'pendiente' and p.insumo_id = x.insumo_id);

  update requisiciones
     set fecha_requerida = p_fecha_requerida, urgente = v_urgente, observaciones = v_obs, direccion_entrega = v_dir
   where id = p_id;

  perform public._evento_requisicion(p_id, 'modificada', null, jsonb_build_object(
    'agregados', v_agregados, 'quitados', v_quitados, 'cambios', v_cambios,
    'antes', jsonb_build_object('fecha_requerida', v_h.fecha_requerida, 'urgente', v_h.urgente,
                                'observaciones', v_h.observaciones, 'direccion_entrega', v_h.direccion_entrega,
                                'proyecto_id', v_h.proyecto_id, 'codigo', v_h.codigo),
    'despues', jsonb_build_object('fecha_requerida', p_fecha_requerida, 'urgente', v_urgente,
                                  'observaciones', v_obs, 'direccion_entrega', v_dir,
                                  'proyecto_id', v_proyecto, 'codigo', coalesce(v_codigo, v_h.codigo))));

  -- A quien aprueba en el proyecto nuevo (Subgerencia), como al crearla.
  if v_cambia_proyecto then
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    select pf.id, 'requisicion_administrativa_por_aprobar', 'requisicion', p_id,
           case when v_urgente then 'Requisición administrativa URGENTE por aprobar' else 'Requisición administrativa por aprobar' end,
           'Requisición ' || v_codigo || ' (' || v_proyecto_txt || '), antes ' || v_h.codigo || ': '
             || jsonb_array_length(p_lineas) || case when jsonb_array_length(p_lineas) = 1 then ' insumo' else ' insumos' end
             || ' para el ' || to_char(p_fecha_requerida, 'DD/MM/YYYY') || '.'
      from perfiles pf
      left join roles r on r.id = pf.rol_id
     where pf.id is distinct from v_uid
       and r.clave is distinct from 'administrador'
       and tiene_accion(pf.id, 'aprobar_requisiciones_administrativas')
       and usuario_puede_ver_proyecto(pf.id, v_proyecto);
  end if;
end;
$$;
revoke all on function public.modificar_requisicion_administrativa(uuid, uuid, jsonb, date, boolean, text, text) from public, anon;
grant execute on function public.modificar_requisicion_administrativa(uuid, uuid, jsonb, date, boolean, text, text) to authenticated;

commit;
