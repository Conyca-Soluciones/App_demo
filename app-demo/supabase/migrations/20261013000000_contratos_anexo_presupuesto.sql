-- Contratos a VALORES UNITARIOS amarrados al presupuesto del proyecto.
--
-- Cada actividad del anexo es un ítem del presupuesto VIGENTE del proyecto
-- (no se pueden contratar actividades que no estén presupuestadas):
--   * la descripción y la unidad salen del presupuesto (se copian como foto);
--   * cantidad <= lo que queda del ítem: cantidad presupuestada menos lo que
--     ya tienen otros contratos;
--   * valor unitario <= el valor unitario del presupuesto.
--
-- "Lo que ya tienen otros contratos" se suma por presupuesto + código del
-- ítem (no por id), igual que las requisiciones: crearNuevaVersion copia los
-- ítems con ids nuevos y lo contratado debe seguir contando en la versión
-- nueva. Hoy cuentan todos los contratos (solo existe 'pre_aprobacion');
-- cuando haya estados como rechazado/anulado, excluirlos en
-- _contratado_item y en items_presupuesto_para_contrato.

alter table public.contrato_anexo_items
  add column if not exists presupuesto_item_id uuid not null references public.presupuesto_items(id);
create index if not exists idx_contrato_anexo_items_presupuesto_item on public.contrato_anexo_items (presupuesto_item_id);

-- Cantidad ya contratada de un ítem (por presupuesto + código).
create or replace function public._contratado_item(p_presupuesto_id uuid, p_codigo text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(ai.cantidad), 0)
  from public.contrato_anexo_items ai
  join public.presupuesto_items p2 on p2.id = ai.presupuesto_item_id
  where p2.presupuesto_id = p_presupuesto_id and p2.codigo = p_codigo
$$;
revoke all on function public._contratado_item(uuid, text) from public, anon, authenticated;

-- Ítems del presupuesto vigente que se pueden contratar a valores unitarios,
-- con lo ya contratado y lo disponible. Lo contratado se agrupa UNA vez por
-- código (no una consulta por ítem).
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
    join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
    where p2.presupuesto_id = v_presupuesto
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
revoke all on function public.items_presupuesto_para_contrato(uuid) from public, anon;
grant execute on function public.items_presupuesto_para_contrato(uuid) to authenticated;

-- ---------------------------------------------------------------- crear
create or replace function public.crear_solicitud_contrato(
  p_id uuid, p_datos jsonb, p_obligaciones jsonb, p_entregables jsonb, p_items jsonb, p_documentos jsonb
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
  if not exists (select 1 from contratistas where id = (p_datos->>'contratista_id')::uuid) then
    raise exception 'El contratista no existe.';
  end if;

  select obligatorios, permitidos into v_obligatorios, v_permitidos from public.documentos_tipo_contrato(v_tipo);
  if v_obligatorios is null then
    raise exception 'Tipo de contrato no válido.';
  end if;

  -- Anexo de valores unitarios: cada actividad es un ítem del presupuesto
  -- vigente, dentro de su cantidad disponible y su valor unitario.
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

    -- Bloquea los ítems: dos solicitudes simultáneas sobre el mismo ítem no
    -- pueden pasar las dos el tope.
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

    -- El valor es la suma del anexo, calculada aquí.
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

  insert into contrato_obligaciones (contrato_id, orden, texto)
  select p_id, t.ord, trim(t.v #>> '{}')
  from jsonb_array_elements(coalesce(p_obligaciones, '[]')) with ordinality as t(v, ord);

  insert into contrato_entregables (contrato_id, orden, texto)
  select p_id, t.ord, trim(t.v #>> '{}')
  from jsonb_array_elements(coalesce(p_entregables, '[]')) with ordinality as t(v, ord);

  -- Descripción y unidad: del presupuesto (no del navegador).
  insert into contrato_anexo_items (contrato_id, orden, presupuesto_item_id, actividad, unidad, cantidad, valor_unitario)
  select p_id, t.ord, pi.id, pi.descripcion, coalesce(nullif(trim(pi.unidad), ''), 'und'),
         (t.v->>'cantidad')::numeric, (t.v->>'valor_unitario')::numeric
  from jsonb_array_elements(coalesce(p_items, '[]')) with ordinality as t(v, ord)
  join presupuesto_items pi on pi.id = (t.v->>'presupuesto_item_id')::uuid;

  insert into contrato_documentos (contrato_id, tipo, ruta, nombre_archivo, tamano, mime)
  select p_id, e->>'tipo', e->>'ruta', e->>'nombre_archivo', (e->>'tamano')::bigint, e->>'mime'
  from jsonb_array_elements(p_documentos) e;

  return v_numero;
end;
$$;
revoke all on function public.crear_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.crear_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
