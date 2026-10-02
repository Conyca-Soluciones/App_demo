-- Pre-aprobación de contratos (Contratos › Pre-aprobación).
--
-- Jurídica revisa las solicitudes en 'pre_aprobacion' y puede:
--   * aprobar   -> 'aprobada' (sigue la minuta, pantalla pendiente)
--   * devolver  -> 'devuelta' con motivo: el director corrige LA MISMA
--                  solicitud y la reenvía (vuelve a 'pre_aprobacion')
--   * rechazar  -> 'rechazada' con motivo, definitivo: deja de contar contra
--                  el presupuesto.
-- Una devuelta sigue reservando su cantidad del presupuesto mientras se
-- corrige.
--
-- Historial (historial_eventos, entidad 'contrato'): creada, reenviada,
-- aprobada, devuelta, rechazada. Notificaciones (campanita): a quienes
-- aprueban cuando llega o vuelve una solicitud; al que la solicitó cuando se
-- resuelve.
-- Permisos: pestaña contratos.preaprobacion y acción aprobar_contratos
-- (Legal y Líder Legal por defecto).

-- ---------------------------------------------------------------- estados
alter table public.contratos drop constraint if exists contratos_estado_check;
alter table public.contratos add constraint contratos_estado_check
  check (estado in ('pre_aprobacion', 'devuelta', 'rechazada', 'aprobada'));

alter table public.contratos
  add column if not exists resuelto_por uuid references public.perfiles(id),
  add column if not exists resuelto_at timestamptz,
  -- Motivo de la última devolución o del rechazo (el historial guarda todos).
  add column if not exists motivo_resolucion text;
create index if not exists idx_contratos_resuelto_por on public.contratos (resuelto_por);

-- ---------------------------------------------------------------- historial y notificaciones
alter table public.historial_eventos drop constraint if exists historial_eventos_entidad_tipo_check;
alter table public.historial_eventos add constraint historial_eventos_entidad_tipo_check
  check (entidad_tipo in ('orden_compra', 'pedido', 'requisicion', 'contrato'));

alter table public.notificaciones drop constraint if exists notificaciones_entidad_tipo_check;
alter table public.notificaciones add constraint notificaciones_entidad_tipo_check
  check (entidad_tipo in ('pedido_insumo', 'orden_compra', 'requisicion', 'contrato')) not valid;
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check
  check (tipo in (
    'pedido_rechazado', 'pedido_aprobado', 'orden_compra_rechazada', 'orden_compra_aprobada',
    'insumo_sobre_presupuesto', 'orden_compra_precio_sobre_efectivo',
    'contrato_por_revisar', 'contrato_aprobado', 'contrato_devuelto', 'contrato_rechazado'
  )) not valid;

-- Avisa a quienes pueden aprobar contratos de ese proyecto (menos a quien
-- hizo la acción). Una inserción para todos, no una por persona.
create or replace function public._notificar_aprobadores_contrato(p_contrato_id uuid, p_titulo text, p_mensaje text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  select pf.id, 'contrato_por_revisar', 'contrato', c.id, p_titulo, p_mensaje
  from contratos c
  cross join perfiles pf
  where c.id = p_contrato_id
    and pf.id is distinct from auth.uid()
    and public.tiene_accion(pf.id, 'aprobar_contratos')
    and public.usuario_puede_ver_proyecto(pf.id, c.proyecto_id)
$$;
revoke all on function public._notificar_aprobadores_contrato(uuid, text, text) from public, anon, authenticated;

-- Historial: se agrega 'contrato' (lo ve quien ve el contrato).
create or replace function public.historial_entidad(p_tipo text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  if p_tipo = 'orden_compra' then
    select (public.rol_compras(auth.uid()) or public.usuario_puede_ver_proyecto(auth.uid(), o.proyecto_id))
      into v_ok from public.ordenes_compra o where o.id = p_id;
  elsif p_tipo = 'pedido' then
    select (public.usuario_tiene_acceso_a_item(p.presupuesto_item_id) or public.rol_compras(auth.uid()))
      into v_ok from public.pedidos_insumos p where p.id = p_id;
  elsif p_tipo = 'requisicion' then
    select exists (
      select 1 from public.pedidos_insumos p
      where p.grupo_pedido_id = p_id
        and (public.usuario_tiene_acceso_a_item(p.presupuesto_item_id)
             or public.rol_compras(auth.uid())
             or public.tiene_accion(auth.uid(), 'aprobar_pedidos'))
    ) into v_ok;
  elsif p_tipo = 'contrato' then
    select (
      public.tiene_pestana(auth.uid(), 'contratos.solicitar')
      or public.tiene_pestana(auth.uid(), 'contratos.preaprobacion')
      or public.tiene_pestana(auth.uid(), 'contratos.contratos')
    ) and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
      into v_ok from public.contratos c where c.id = p_id;
  else
    raise exception 'Tipo de historial desconocido.';
  end if;

  if not coalesce(v_ok, false) then
    raise exception 'No tienes permiso para ver este historial.';
  end if;

  if p_tipo = 'requisicion' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre,
               'motivo', h.motivo,
               'datos', case when h.entidad_tipo = 'pedido'
                             then coalesce(h.datos, '{}'::jsonb) || jsonb_build_object('insumo', mi.descripcion)
                             else h.datos end,
               'created_at', h.created_at
             ) order by h.created_at, h.id)
        from public.historial_eventos h
        left join public.perfiles pf on pf.id = h.usuario_id
        left join public.pedidos_insumos pe on h.entidad_tipo = 'pedido' and pe.id = h.entidad_id
        left join public.maestro_insumos mi on mi.id = pe.insumo_id
       where (h.entidad_tipo = 'requisicion' and h.entidad_id = p_id)
          or (h.entidad_tipo = 'pedido' and h.evento = 'rechazado_por_compras'
              and pe.grupo_pedido_id = p_id)
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre,
             'motivo', h.motivo, 'datos', h.datos, 'created_at', h.created_at
           ) order by h.created_at, h.id)
      from public.historial_eventos h
      left join public.perfiles pf on pf.id = h.usuario_id
     where h.entidad_tipo = p_tipo and h.entidad_id = p_id
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- RLS
-- Quien tiene la pestaña de pre-aprobación ve contratos (de sus proyectos) y
-- los datos y documentos de los contratistas.
drop policy if exists contratos_select on public.contratos;
create policy contratos_select on public.contratos for select to authenticated
  using (
    (
      (select public.tiene_pestana(auth.uid(), 'contratos.solicitar'))
      or (select public.tiene_pestana(auth.uid(), 'contratos.preaprobacion'))
      or (select public.tiene_pestana(auth.uid(), 'contratos.contratos'))
    )
    and proyecto_id in (select public.proyectos_visibles((select auth.uid())))
  );

drop policy if exists contratistas_select on public.contratistas;
create policy contratistas_select on public.contratistas for select to authenticated
  using (
    (select public.tiene_pestana(auth.uid(), 'contratos.contratistas'))
    or (select public.tiene_pestana(auth.uid(), 'contratos.preaprobacion'))
    or (select public.tiene_accion(auth.uid(), 'gestionar_contratistas'))
    or (select public.tiene_accion(auth.uid(), 'solicitar_contratos'))
  );

drop policy if exists contratista_documentos_select on public.contratista_documentos;
create policy contratista_documentos_select on public.contratista_documentos for select to authenticated
  using (
    (select public.tiene_pestana(auth.uid(), 'contratos.contratistas'))
    or (select public.tiene_pestana(auth.uid(), 'contratos.preaprobacion'))
    or (select public.tiene_accion(auth.uid(), 'gestionar_contratistas'))
    or (select public.tiene_accion(auth.uid(), 'solicitar_contratos'))
  );

drop policy if exists contratistas_archivos_select on storage.objects;
create policy contratistas_archivos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'contratistas'
    and (
      (select public.tiene_pestana(auth.uid(), 'contratos.contratistas'))
      or (select public.tiene_pestana(auth.uid(), 'contratos.preaprobacion'))
      or (select public.tiene_accion(auth.uid(), 'gestionar_contratistas'))
    )
  );

-- ---------------------------------------------------------------- presupuesto
-- Los contratos rechazados ya no cuentan como contratado.
create or replace function public._contratado_item(p_presupuesto_id uuid, p_codigo text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(ai.cantidad), 0)
  from public.contrato_anexo_items ai
  join public.contratos c on c.id = ai.contrato_id
  join public.presupuesto_items p2 on p2.id = ai.presupuesto_item_id
  where p2.presupuesto_id = p_presupuesto_id and p2.codigo = p_codigo
    and c.estado <> 'rechazada'
$$;
revoke all on function public._contratado_item(uuid, text) from public, anon, authenticated;

create or replace function public.items_presupuesto_para_contrato(p_proyecto_id uuid)
returns table(
  presupuesto_item_id uuid, codigo text, descripcion text, unidad text,
  cantidad numeric, valor_unitario numeric, contratado numeric, disponible numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_presupuesto uuid;
  v_version uuid;
begin
  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para solicitar contratos.';
  end if;
  if not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes acceso a este proyecto.';
  end if;

  select p.id, p.version_actual_id into v_presupuesto, v_version
  from presupuestos p where p.proyecto_id = p_proyecto_id;
  if v_version is null then
    return;
  end if;

  return query
  with contratado as (
    select p2.codigo, sum(ai.cantidad) as total
    from contrato_anexo_items ai
    join contratos c on c.id = ai.contrato_id
    join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
    where p2.presupuesto_id = v_presupuesto and c.estado <> 'rechazada'
    group by p2.codigo
  )
  select pi.id, pi.codigo, pi.descripcion, pi.unidad, pi.cantidad, pi.valor_unitario,
         coalesce(c.total, 0),
         greatest(pi.cantidad - coalesce(c.total, 0), 0)
  from presupuesto_items pi
  left join contratado c on c.codigo = pi.codigo
  where pi.version_id = v_version
    and pi.cantidad > 0
    and pi.valor_unitario > 0
  order by pi.codigo, pi.id;
end;
$$;

-- ---------------------------------------------------------------- guardar
-- Lógica común de crear y de reenviar una devuelta. p_existente = true:
-- la solicitud ya existe y está 'devuelta'; se borran sus líneas y documentos
-- ANTES de validar (así su propia cantidad no cuenta contra el presupuesto) y
-- se reemplazan. Todo en la misma transacción: si algo falla, nada cambia.
create or replace function public._guardar_solicitud_contrato(
  p_id uuid, p_datos jsonb, p_obligaciones jsonb, p_entregables jsonb, p_items jsonb, p_documentos jsonb,
  p_existente boolean
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text := p_datos->>'tipo';
  v_proyecto uuid := (p_datos->>'proyecto_id')::uuid;
  v_valor numeric := (p_datos->>'valor')::numeric;
  v_anexo text := p_datos->>'anexo_tipo';
  v_obligatorios text[];
  v_permitidos text[];
  v_faltan text[];
  v_suma numeric;
  v_numero bigint;
  v_presupuesto uuid;
  v_version uuid;
  v_actual record;
  v_pi record;
  v_cantidad numeric;
  v_valor_unitario numeric;
  v_disponible numeric;
  d jsonb;
begin
  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para solicitar contratos.';
  end if;
  if p_id is null or v_proyecto is null then
    raise exception 'Faltan datos de la solicitud.';
  end if;
  if not public.usuario_puede_ver_proyecto(auth.uid(), v_proyecto) then
    raise exception 'No tienes acceso a este proyecto.';
  end if;

  if p_existente then
    select id, numero, estado, proyecto_id into v_actual from contratos where id = p_id for update;
    if not found then
      raise exception 'La solicitud no existe.';
    end if;
    if v_actual.estado <> 'devuelta' then
      raise exception 'Solo se puede corregir una solicitud devuelta (esta está en otro estado; actualiza la página).';
    end if;
    if v_actual.proyecto_id <> v_proyecto then
      raise exception 'La solicitud es de otro proyecto.';
    end if;
    delete from contrato_anexo_items where contrato_id = p_id;
    delete from contrato_obligaciones where contrato_id = p_id;
    delete from contrato_entregables where contrato_id = p_id;
    delete from contrato_documentos where contrato_id = p_id;
  end if;

  if not exists (select 1 from contratistas where id = (p_datos->>'contratista_id')::uuid) then
    raise exception 'El contratista no existe.';
  end if;

  select obligatorios, permitidos into v_obligatorios, v_permitidos from public.documentos_tipo_contrato(v_tipo);
  if v_obligatorios is null then
    raise exception 'Tipo de contrato no válido.';
  end if;

  if v_anexo = 'valores_unitarios' then
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
      raise exception 'El anexo de valores unitarios necesita al menos una actividad del presupuesto.';
    end if;

    select p.id, p.version_actual_id into v_presupuesto, v_version
    from presupuestos p where p.proyecto_id = v_proyecto;
    if v_version is null then
      raise exception 'El proyecto no tiene presupuesto vigente: no se puede contratar a valores unitarios.';
    end if;

    if (select count(distinct e->>'presupuesto_item_id') from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items) then
      raise exception 'Hay un ítem del presupuesto repetido en el anexo.';
    end if;

    perform 1 from presupuesto_items
    where id in (select (e->>'presupuesto_item_id')::uuid from jsonb_array_elements(p_items) e)
    for update;

    for d in select * from jsonb_array_elements(p_items) loop
      select id, codigo, descripcion, cantidad, valor_unitario, version_id into v_pi
      from presupuesto_items where id = (d->>'presupuesto_item_id')::uuid;
      if not found or v_pi.version_id is distinct from v_version then
        raise exception 'Una actividad del anexo no pertenece al presupuesto vigente del proyecto.';
      end if;
      if coalesce(v_pi.cantidad, 0) <= 0 or coalesce(v_pi.valor_unitario, 0) <= 0 then
        raise exception 'El ítem % no tiene cantidad o valor en el presupuesto.', v_pi.codigo;
      end if;

      v_cantidad := (d->>'cantidad')::numeric;
      v_valor_unitario := (d->>'valor_unitario')::numeric;
      if v_cantidad is null or v_cantidad <= 0 or v_valor_unitario is null or v_valor_unitario <= 0 then
        raise exception 'El ítem % necesita cantidad y valor unitario mayores que cero.', v_pi.codigo;
      end if;
      if v_valor_unitario > v_pi.valor_unitario then
        raise exception 'El valor unitario del ítem % (%) supera el del presupuesto (%).', v_pi.codigo, v_valor_unitario, v_pi.valor_unitario;
      end if;
      v_disponible := v_pi.cantidad - public._contratado_item(v_presupuesto, v_pi.codigo);
      if v_cantidad > v_disponible then
        raise exception 'La cantidad del ítem % (%) supera lo disponible en el presupuesto (%).', v_pi.codigo, v_cantidad, greatest(v_disponible, 0);
      end if;
    end loop;

    select round(sum(round((e->>'cantidad')::numeric * (e->>'valor_unitario')::numeric, 2)), 2)
      into v_suma from jsonb_array_elements(p_items) e;
    v_valor := v_suma;
  elsif jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    raise exception 'Un contrato a valor global no lleva tabla de valores unitarios.';
  end if;

  if jsonb_typeof(p_documentos) is distinct from 'array' then
    raise exception 'Faltan los documentos.';
  end if;
  select array_agg(r) into v_faltan
  from unnest(v_obligatorios) r
  where not exists (select 1 from jsonb_array_elements(p_documentos) e where e->>'tipo' = r);
  if v_faltan is not null then
    raise exception 'Faltan documentos obligatorios: %.', array_to_string(v_faltan, ', ');
  end if;
  if (select count(distinct e->>'tipo') from jsonb_array_elements(p_documentos) e) <> jsonb_array_length(p_documentos) then
    raise exception 'Hay un documento repetido.';
  end if;
  for d in select * from jsonb_array_elements(p_documentos) loop
    if not (d->>'tipo' = any (v_permitidos)) then
      raise exception 'El documento "%" no aplica para este tipo de contrato.', d->>'tipo';
    end if;
    if left(d->>'ruta', 37) is distinct from p_id::text || '/' then
      raise exception 'La ruta del documento no corresponde a esta solicitud.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'contratos' and o.name = d->>'ruta') then
      raise exception 'No se encontró el archivo de "%". Vuelve a adjuntarlo.', d->>'tipo';
    end if;
  end loop;

  if p_existente then
    update contratos set
      contratista_id = (p_datos->>'contratista_id')::uuid,
      tipo = v_tipo,
      estado = 'pre_aprobacion',
      objeto = trim(p_datos->>'objeto'),
      valor = v_valor,
      anexo_tipo = v_anexo,
      tiene_anticipo = coalesce((p_datos->>'tiene_anticipo')::boolean, false),
      anticipo_porcentaje = nullif(p_datos->>'anticipo_porcentaje', '')::numeric,
      forma_pago = trim(p_datos->>'forma_pago'),
      plazo_tipo = p_datos->>'plazo_tipo',
      fecha_inicio = nullif(p_datos->>'fecha_inicio', '')::date,
      fecha_fin = nullif(p_datos->>'fecha_fin', '')::date,
      duracion_cantidad = nullif(p_datos->>'duracion_cantidad', '')::integer,
      duracion_unidad = nullif(p_datos->>'duracion_unidad', ''),
      correo_notificacion = lower(trim(p_datos->>'correo_notificacion')),
      observaciones = nullif(trim(p_datos->>'observaciones'), ''),
      enviado_at = now()
    where id = p_id;
    v_numero := v_actual.numero;
  else
    insert into contratos (
      id, proyecto_id, contratista_id, tipo, objeto, valor, anexo_tipo, tiene_anticipo, anticipo_porcentaje,
      forma_pago, plazo_tipo, fecha_inicio, fecha_fin, duracion_cantidad, duracion_unidad,
      correo_notificacion, observaciones
    ) values (
      p_id, v_proyecto, (p_datos->>'contratista_id')::uuid, v_tipo, trim(p_datos->>'objeto'), v_valor, v_anexo,
      coalesce((p_datos->>'tiene_anticipo')::boolean, false), nullif(p_datos->>'anticipo_porcentaje', '')::numeric,
      trim(p_datos->>'forma_pago'), p_datos->>'plazo_tipo',
      nullif(p_datos->>'fecha_inicio', '')::date, nullif(p_datos->>'fecha_fin', '')::date,
      nullif(p_datos->>'duracion_cantidad', '')::integer, nullif(p_datos->>'duracion_unidad', ''),
      lower(trim(p_datos->>'correo_notificacion')), nullif(trim(p_datos->>'observaciones'), '')
    )
    returning numero into v_numero;
  end if;

  insert into contrato_obligaciones (contrato_id, orden, texto)
  select p_id, t.ord, trim(t.v #>> '{}')
  from jsonb_array_elements(coalesce(p_obligaciones, '[]')) with ordinality as t(v, ord);

  insert into contrato_entregables (contrato_id, orden, texto)
  select p_id, t.ord, trim(t.v #>> '{}')
  from jsonb_array_elements(coalesce(p_entregables, '[]')) with ordinality as t(v, ord);

  insert into contrato_anexo_items (contrato_id, orden, presupuesto_item_id, actividad, unidad, cantidad, valor_unitario)
  select p_id, t.ord, pi.id, pi.descripcion, coalesce(nullif(trim(pi.unidad), ''), 'und'),
         (t.v->>'cantidad')::numeric, (t.v->>'valor_unitario')::numeric
  from jsonb_array_elements(coalesce(p_items, '[]')) with ordinality as t(v, ord)
  join presupuesto_items pi on pi.id = (t.v->>'presupuesto_item_id')::uuid;

  insert into contrato_documentos (contrato_id, tipo, ruta, nombre_archivo, tamano, mime)
  select p_id, e->>'tipo', e->>'ruta', e->>'nombre_archivo', (e->>'tamano')::bigint, e->>'mime'
  from jsonb_array_elements(p_documentos) e;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('contrato', p_id, case when p_existente then 'reenviada' else 'creada' end, auth.uid(),
          jsonb_build_object('valor', v_valor));

  perform public._notificar_aprobadores_contrato(
    p_id,
    case when p_existente then 'Solicitud de contrato corregida' else 'Nueva solicitud de contrato' end,
    'Solicitud N° ' || v_numero || ' por revisar en pre-aprobación.'
  );

  return v_numero;
end;
$$;
revoke all on function public._guardar_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from public, anon, authenticated;

create or replace function public.crear_solicitud_contrato(
  p_id uuid, p_datos jsonb, p_obligaciones jsonb, p_entregables jsonb, p_items jsonb, p_documentos jsonb
)
returns bigint
language sql
security definer
set search_path = public
as $$
  select public._guardar_solicitud_contrato(p_id, p_datos, p_obligaciones, p_entregables, p_items, p_documentos, false)
$$;
revoke all on function public.crear_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.crear_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

create or replace function public.reenviar_solicitud_contrato(
  p_id uuid, p_datos jsonb, p_obligaciones jsonb, p_entregables jsonb, p_items jsonb, p_documentos jsonb
)
returns bigint
language sql
security definer
set search_path = public
as $$
  select public._guardar_solicitud_contrato(p_id, p_datos, p_obligaciones, p_entregables, p_items, p_documentos, true)
$$;
revoke all on function public.reenviar_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.reenviar_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- resolver
create or replace function public.resolver_solicitud_contrato(p_id uuid, p_accion text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_estado text;
  v_evento text;
  v_tipo_notif text;
  v_titulo text;
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_contratos') then
    raise exception 'No tienes permiso para aprobar contratos.';
  end if;
  select id, numero, estado, proyecto_id, solicitado_por into v from contratos where id = p_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v.proyecto_id) then
    raise exception 'La solicitud no existe o no tienes acceso.';
  end if;
  if v.estado <> 'pre_aprobacion' then
    raise exception 'Esta solicitud ya no está en pre-aprobación (actualiza la página).';
  end if;

  if p_accion = 'aprobar' then
    v_estado := 'aprobada'; v_evento := 'aprobada'; v_tipo_notif := 'contrato_aprobado'; v_titulo := 'Contrato pre-aprobado';
  elsif p_accion = 'devolver' then
    v_estado := 'devuelta'; v_evento := 'devuelta'; v_tipo_notif := 'contrato_devuelto'; v_titulo := 'Solicitud de contrato devuelta';
  elsif p_accion = 'rechazar' then
    v_estado := 'rechazada'; v_evento := 'rechazada'; v_tipo_notif := 'contrato_rechazado'; v_titulo := 'Solicitud de contrato rechazada';
  else
    raise exception 'Acción no válida.';
  end if;
  if p_accion in ('devolver', 'rechazar') and v_motivo is null then
    raise exception 'Escribe el motivo.';
  end if;

  update contratos
     set estado = v_estado, resuelto_por = auth.uid(), resuelto_at = now(),
         motivo_resolucion = case when p_accion = 'aprobar' then motivo_resolucion else v_motivo end
   where id = p_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo)
  values ('contrato', p_id, v_evento, auth.uid(), v_motivo);

  if v.solicitado_por is not null and v.solicitado_por is distinct from auth.uid() then
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    values (v.solicitado_por, v_tipo_notif, 'contrato', p_id, v_titulo,
            'Solicitud N° ' || v.numero || case
              when p_accion = 'aprobar' then ' pre-aprobada por Jurídica.'
              when p_accion = 'devolver' then ' devuelta para corregir. Motivo: ' || v_motivo
              else ' rechazada. Motivo: ' || v_motivo end);
  end if;
end;
$$;
revoke all on function public.resolver_solicitud_contrato(uuid, text, text) from public, anon;
grant execute on function public.resolver_solicitud_contrato(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- historial de lo que ya existe
insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos, created_at)
select 'contrato', c.id, 'creada', c.solicitado_por, jsonb_build_object('valor', c.valor, 'reconstruido', true), c.created_at
from contratos c
where not exists (select 1 from historial_eventos h where h.entidad_tipo = 'contrato' and h.entidad_id = c.id);

-- ---------------------------------------------------------------- roles
insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
from public.roles r
cross join (values ('tab.contratos.preaprobacion'), ('accion.aprobar_contratos')) as p(permiso)
where r.clave in ('legal', 'lider_legal')
on conflict do nothing;

insert into public.rol_permisos (rol_id, permiso)
select id, 'tab.contratos.preaprobacion' from public.roles where clave = 'gerencia'
on conflict do nothing;
