-- ---------------------------------------------------------------------------
-- Tope de mano de obra y actividades por otrosí (2026-10-20, pedido del usuario).
-- Requiere 20261123000000_otrosi_prorroga_y_valor.sql.
--
-- 1. Contratos de MANO DE OBRA por actividades (valores unitarios): el valor
--    unitario máximo de cada actividad es la mano de obra del APU del ítem
--    más la herramienta menor (% de la mano de obra), no el ítem completo
--    (que incluye materiales, equipos y transporte). Mismo cálculo que
--    recalcular_valor_apus (_valor_mano_obra_item). Si el APU no tiene mano
--    de obra, el tope sigue siendo el ítem completo y la actividad queda
--    marcada (contrato_anexo_items.sin_mano_obra) para que Jurídica la revise.
--    Los demás tipos (obra todo costo...) siguen con el ítem completo.
--    items_presupuesto_para_contrato devuelve valor_mano_obra.
-- 2. Otrosí con actividades (solo contratos por valores unitarios):
--    otrosis.actividades = actividades NUEVAS del presupuesto vigente (que el
--    contrato no tenga; precio con el mismo tope del tipo de contrato) y
--    ADICIONES de cantidad a actividades del contrato (a su valor unitario
--    pactado). Cantidad hasta lo disponible en el presupuesto. El valor del
--    contrato sube solo: nuevo_valor = vigente + lo que suman. Se revisa al
--    crear, reenviar, enviar a Subgerencia y aprobar. Al aprobar se agregan
--    como filas nuevas del anexo (contrato_anexo_items.otrosi_id, actividad
--    "... (Otrosí N° n)"): las del contrato firmado no cambian y las actas
--    cobran las nuevas con su propio tope de cantidad. detalle_acta muestra
--    las de un otrosí solo en actas hechas o editadas después de aprobarlo.
-- ---------------------------------------------------------------------------

alter table public.contrato_anexo_items add column if not exists sin_mano_obra boolean not null default false;
alter table public.contrato_anexo_items add column if not exists otrosi_id uuid references public.otrosis(id);
create index if not exists idx_contrato_anexo_items_otrosi on public.contrato_anexo_items (otrosi_id) where otrosi_id is not null;
alter table public.otrosis add column if not exists actividades jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------- tope de mano de obra
-- Mano de obra + herramienta menor por unidad del ítem (0 si el APU no tiene).
create or replace function public._valor_mano_obra_item(p_presupuesto_item_id uuid)
returns numeric
language sql
stable security definer
set search_path = public
as $$
  select coalesce((
    select round(coalesce(sum(moc.valor_unitario), 0) * (1 + coalesce(sum(ia.porcentaje_mano_obra / 100.0), 0)), 2)
      from presupuesto_items pi
      join item_apu ia on ia.apu_id = pi.apu_id
      left join mano_obra_categorias moc on moc.id = ia.mano_obra_categoria_id
     where pi.id = p_presupuesto_item_id), 0)
$$;
revoke all on function public._valor_mano_obra_item(uuid) from public, anon, authenticated;

-- Valor unitario máximo de una actividad según el tipo de contrato.
create or replace function public._tope_valor_unitario_item(p_presupuesto_item_id uuid, p_tipo_contrato text)
returns numeric
language sql
stable security definer
set search_path = public
as $$
  select case when p_tipo_contrato = 'mano_obra' and m.valor > 0 then least(m.valor, pi.valor_unitario)
              else pi.valor_unitario end
    from presupuesto_items pi
    cross join lateral (select public._valor_mano_obra_item(pi.id) as valor) m
   where pi.id = p_presupuesto_item_id
$$;
revoke all on function public._tope_valor_unitario_item(uuid, text) from public, anon, authenticated;

drop function if exists public.items_presupuesto_para_contrato(uuid);
create or replace function public.items_presupuesto_para_contrato(p_proyecto_id uuid)
returns table(
  presupuesto_item_id uuid, codigo text, descripcion text, unidad text,
  cantidad numeric, valor_unitario numeric, valor_mano_obra numeric, contratado numeric, disponible numeric
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
  ),
  -- Mano de obra + herramienta menor por unidad (como recalcular_valor_apus).
  mo as (
    select pi.id,
           round(coalesce(sum(moc.valor_unitario), 0) * (1 + coalesce(sum(ia.porcentaje_mano_obra / 100.0), 0)), 2) as valor
    from presupuesto_items pi
    join item_apu ia on ia.apu_id = pi.apu_id
    left join mano_obra_categorias moc on moc.id = ia.mano_obra_categoria_id
    where pi.version_id = v_version
    group by pi.id
  )
  select pi.id, pi.codigo, pi.descripcion, pi.unidad, pi.cantidad, pi.valor_unitario,
         least(coalesce(mo.valor, 0), pi.valor_unitario),
         coalesce(c.total, 0),
         greatest(pi.cantidad - coalesce(c.total, 0), 0)
  from presupuesto_items pi
  left join contratado c on c.codigo = pi.codigo
  left join mo on mo.id = pi.id
  where pi.version_id = v_version
    and pi.cantidad > 0
    and pi.valor_unitario > 0
  order by pi.codigo, pi.id;
end;
$$;
revoke all on function public.items_presupuesto_para_contrato(uuid) from public, anon;
grant execute on function public.items_presupuesto_para_contrato(uuid) to authenticated;

create or replace function public._guardar_solicitud_contrato(p_id uuid, p_datos jsonb, p_obligaciones jsonb, p_entregables jsonb, p_items jsonb, p_documentos jsonb, p_existente boolean)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_tipo text := p_datos->>'tipo';
  v_proyecto uuid := (p_datos->>'proyecto_id')::uuid;
  v_valor numeric := (p_datos->>'valor')::numeric;
  v_anexo text := p_datos->>'anexo_tipo';
  v_valor_mensual numeric := nullif(p_datos->>'valor_mensual', '')::numeric;
  v_departamento text := nullif(trim(p_datos->>'domicilio_departamento'), '');
  v_dt jsonb := coalesce(p_datos->'datos_tipo', '{}'::jsonb);
  v_datos_tipo jsonb := '{}'::jsonb;
  v_numero_dt numeric;
  v_texto_dt text;
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
  v_tope numeric;
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
      -- Tope: en mano de obra, la mano de obra del APU (+ herramienta menor);
      -- si el APU no tiene mano de obra, el ítem completo (queda marcado).
      v_tope := public._tope_valor_unitario_item(v_pi.id, v_tipo);
      if v_valor_unitario > v_tope then
        if v_tope < v_pi.valor_unitario then
          raise exception 'El valor unitario del ítem % (%) supera el de mano de obra del presupuesto (%).', v_pi.codigo, v_valor_unitario, v_tope;
        end if;
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

  -- Pago mensual: obligatorio en prestación de servicios, alquiler de
  -- vehículo y arrendamiento; los demás tipos no lo llevan.
  if v_tipo in ('prestacion_servicios', 'alquiler_vehiculo', 'arrendamiento') then
    if v_valor_mensual is null or v_valor_mensual <= 0 then
      raise exception 'Escribe el valor del pago mensual.';
    end if;
    if v_valor_mensual > v_valor then
      raise exception 'El pago mensual no puede ser mayor que el valor del contrato.';
    end if;
    v_valor_mensual := round(v_valor_mensual, 2);
  else
    v_valor_mensual := null;
  end if;

  -- Nuevo: departamento de domicilio (todos los tipos) y datos de la minuta
  -- según el tipo. Solo se guardan las claves que corresponden al tipo.
  if v_departamento is null then
    raise exception 'Escribe el departamento de domicilio del contrato.';
  end if;
  if jsonb_typeof(v_dt) is distinct from 'object' then
    raise exception 'Los datos del tipo de contrato no son válidos.';
  end if;
  if v_tipo in ('obra', 'mano_obra') then
    v_numero_dt := nullif(v_dt->>'pago_cada_dias', '')::numeric;
    if v_numero_dt is null or v_numero_dt <= 0 or v_numero_dt <> trunc(v_numero_dt) then
      raise exception 'Escribe cada cuántos días se paga (número entero).';
    end if;
    if (v_dt->>'retencion_garantia') is null then
      raise exception 'Indica si hay retención en garantía.';
    end if;
    v_datos_tipo := jsonb_build_object('pago_cada_dias', v_numero_dt::integer,
                                       'retencion_garantia', (v_dt->>'retencion_garantia')::boolean);
    if (v_dt->>'retencion_garantia')::boolean then
      v_numero_dt := nullif(v_dt->>'retencion_porcentaje', '')::numeric;
      if v_numero_dt is null or v_numero_dt <= 0 or v_numero_dt > 100 then
        raise exception 'Escribe el porcentaje de retención en garantía (entre 1 y 100).';
      end if;
      v_datos_tipo := v_datos_tipo || jsonb_build_object('retencion_porcentaje', round(v_numero_dt, 2));
    end if;
    -- Mano de obra (plantilla GJ-F-003 versión 04): la décima octava dice si se
    -- exigen garantías o no. En obra a todo costo siempre se exigen.
    if v_tipo = 'mano_obra' then
      if (v_dt->>'exige_garantia') is null then
        raise exception 'Indica si el contrato exige garantías.';
      end if;
      v_datos_tipo := v_datos_tipo || jsonb_build_object('exige_garantia', (v_dt->>'exige_garantia')::boolean);
    end if;
  elsif v_tipo = 'arrendamiento' then
    if nullif(trim(v_dt->>'inmueble_direccion'), '') is null then
      raise exception 'Escribe la dirección del inmueble.';
    end if;
    if nullif(trim(v_dt->>'inmueble_uso'), '') is null then
      raise exception 'Escribe el uso del inmueble.';
    end if;
    if (v_dt->>'canon_iva') is null or (v_dt->>'canon_iva') not in ('mas_iva', 'incluido') then
      raise exception 'Indica si el canon es más IVA o incluye el IVA.';
    end if;
    if (v_dt->>'servicios_incluidos') is null then
      raise exception 'Indica si el canon incluye los servicios públicos.';
    end if;
    v_texto_dt := lower(trim(v_dt->>'correo_factura'));
    if v_texto_dt is null or v_texto_dt !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'Escribe un correo válido para la factura.';
    end if;
    v_datos_tipo := jsonb_build_object(
      'inmueble_direccion', trim(v_dt->>'inmueble_direccion'),
      'inmueble_uso', trim(v_dt->>'inmueble_uso'),
      'canon_iva', v_dt->>'canon_iva',
      'servicios_incluidos', (v_dt->>'servicios_incluidos')::boolean,
      'correo_factura', v_texto_dt);
  elsif v_tipo = 'alquiler_vehiculo' then
    if nullif(trim(v_dt->>'bien_nombre'), '') is null then
      raise exception 'Escribe el nombre corto del vehículo o la maquinaria.';
    end if;
    if (v_dt->>'actas') is null or (v_dt->>'actas') not in ('semanales', 'quincenales', 'mensuales', 'bimestrales') then
      raise exception 'Elige cada cuánto son las actas parciales.';
    end if;
    if (v_dt->>'exige_garantia') is null then
      raise exception 'Indica si el contrato tiene garantías.';
    end if;
    v_datos_tipo := jsonb_build_object(
      'bien_nombre', trim(v_dt->>'bien_nombre'),
      'actas', v_dt->>'actas',
      'exige_garantia', (v_dt->>'exige_garantia')::boolean);
  end if;

  -- Obligaciones específicas y entregables: al menos uno con texto (si no
  -- hay, se escribe "N/A" o "No aplica").
  if not exists (select 1 from jsonb_array_elements(coalesce(p_obligaciones, '[]')) e where trim(e #>> '{}') <> '') then
    raise exception 'Escribe al menos una obligación específica (si no hay, "N/A" o "No aplica").';
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(p_entregables, '[]')) e where trim(e #>> '{}') <> '') then
    raise exception 'Escribe al menos un entregable (si no hay, "N/A" o "No aplica").';
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
      valor_mensual = v_valor_mensual,
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
      domicilio_departamento = v_departamento,
      datos_tipo = v_datos_tipo,
      enviado_at = now()
    where id = p_id;
    v_numero := v_actual.numero;
  else
    insert into contratos (
      id, proyecto_id, contratista_id, tipo, objeto, valor, anexo_tipo, valor_mensual, tiene_anticipo, anticipo_porcentaje,
      forma_pago, plazo_tipo, fecha_inicio, fecha_fin, duracion_cantidad, duracion_unidad,
      correo_notificacion, observaciones, domicilio_departamento, datos_tipo
    ) values (
      p_id, v_proyecto, (p_datos->>'contratista_id')::uuid, v_tipo, trim(p_datos->>'objeto'), v_valor, v_anexo, v_valor_mensual,
      coalesce((p_datos->>'tiene_anticipo')::boolean, false), nullif(p_datos->>'anticipo_porcentaje', '')::numeric,
      trim(p_datos->>'forma_pago'), p_datos->>'plazo_tipo',
      nullif(p_datos->>'fecha_inicio', '')::date, nullif(p_datos->>'fecha_fin', '')::date,
      nullif(p_datos->>'duracion_cantidad', '')::integer, nullif(p_datos->>'duracion_unidad', ''),
      lower(trim(p_datos->>'correo_notificacion')), nullif(trim(p_datos->>'observaciones'), ''),
      v_departamento, v_datos_tipo
    )
    returning numero into v_numero;
  end if;

  insert into contrato_obligaciones (contrato_id, orden, texto)
  select p_id, t.ord, trim(t.v #>> '{}')
  from jsonb_array_elements(coalesce(p_obligaciones, '[]')) with ordinality as t(v, ord)
  where trim(t.v #>> '{}') <> '';

  insert into contrato_entregables (contrato_id, orden, texto)
  select p_id, t.ord, trim(t.v #>> '{}')
  from jsonb_array_elements(coalesce(p_entregables, '[]')) with ordinality as t(v, ord)
  where trim(t.v #>> '{}') <> '';

  insert into contrato_anexo_items (contrato_id, orden, presupuesto_item_id, actividad, unidad, cantidad, valor_unitario, sin_mano_obra)
  select p_id, t.ord, pi.id, pi.descripcion, coalesce(nullif(trim(pi.unidad), ''), 'und'),
         (t.v->>'cantidad')::numeric, (t.v->>'valor_unitario')::numeric,
         v_tipo = 'mano_obra' and public._valor_mano_obra_item(pi.id) = 0
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
$function$;

-- ---------------------------------------------------------------- actividades del otrosí
-- Para el formulario: las actividades del contrato (con lo que queda
-- disponible en el presupuesto vigente) y los ítems del presupuesto vigente
-- que el contrato no tiene (con su mano de obra, para el tope).
create or replace function public.actividades_para_otrosi(p_contrato_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  c record;
  v_presupuesto uuid;
  v_version uuid;
begin
  if not public.tiene_pestana(v_uid, 'contratos.solicitar_otrosi') then
    raise exception 'No tienes permiso para solicitar otrosí.';
  end if;
  select id, proyecto_id, tipo, anexo_tipo into c from contratos where id = p_contrato_id;
  if not found or not public.usuario_puede_ver_proyecto(v_uid, c.proyecto_id) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  select p.id, p.version_actual_id into v_presupuesto, v_version from presupuestos p where p.proyecto_id = c.proyecto_id;
  if c.anexo_tipo is distinct from 'valores_unitarios' or v_version is null then
    return jsonb_build_object('anexo_tipo', c.anexo_tipo, 'tipo', c.tipo, 'tiene_presupuesto', v_version is not null,
                              'anexo', '[]'::jsonb, 'catalogo', '[]'::jsonb);
  end if;
  return (
    with contratado as (
      select p2.codigo, sum(ai.cantidad) as total
        from contrato_anexo_items ai
        join contratos c2 on c2.id = ai.contrato_id
        join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
       where p2.presupuesto_id = v_presupuesto and c2.estado <> 'rechazada'
       group by p2.codigo
    ),
    vigentes as (
      select pi.id, pi.codigo, pi.descripcion, pi.unidad, pi.cantidad, pi.valor_unitario
        from presupuesto_items pi
       where pi.version_id = v_version and pi.cantidad > 0 and pi.valor_unitario > 0
    ),
    mo as (
      select pi.id,
             round(coalesce(sum(moc.valor_unitario), 0) * (1 + coalesce(sum(ia.porcentaje_mano_obra / 100.0), 0)), 2) as valor
        from presupuesto_items pi
        join item_apu ia on ia.apu_id = pi.apu_id
        left join mano_obra_categorias moc on moc.id = ia.mano_obra_categoria_id
       where pi.version_id = v_version
       group by pi.id
    ),
    propios as (
      select ai.id, ai.orden, ai.actividad, ai.unidad, ai.cantidad, ai.valor_unitario, p2.codigo
        from contrato_anexo_items ai
        left join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
       where ai.contrato_id = p_contrato_id
    )
    select jsonb_build_object(
      'anexo_tipo', c.anexo_tipo, 'tipo', c.tipo, 'tiene_presupuesto', true,
      'anexo', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', pr.id, 'codigo', pr.codigo, 'actividad', pr.actividad, 'unidad', pr.unidad,
                 'cantidad', pr.cantidad, 'valor_unitario', pr.valor_unitario,
                 'en_presupuesto', vg.id is not null,
                 'disponible', case when vg.id is null then 0 else greatest(vg.cantidad - coalesce(k.total, 0), 0) end
               ) order by pr.orden, pr.id)
          from propios pr
          left join lateral (select v.id, v.cantidad from vigentes v where v.codigo = pr.codigo order by v.id limit 1) vg on true
          left join contratado k on k.codigo = pr.codigo), '[]'::jsonb),
      'catalogo', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'presupuesto_item_id', vg.id, 'codigo', vg.codigo, 'descripcion', vg.descripcion, 'unidad', vg.unidad,
                 'cantidad', vg.cantidad, 'valor_unitario', vg.valor_unitario,
                 'valor_mano_obra', least(coalesce(mo.valor, 0), vg.valor_unitario),
                 'contratado', coalesce(k.total, 0),
                 'disponible', greatest(vg.cantidad - coalesce(k.total, 0), 0)
               ) order by vg.codigo, vg.id)
          from vigentes vg
          left join mo on mo.id = vg.id
          left join contratado k on k.codigo = vg.codigo
         where not exists (select 1 from propios pr where pr.codigo = vg.codigo)), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.actividades_para_otrosi(uuid) from public, anon;
grant execute on function public.actividades_para_otrosi(uuid) to authenticated;

-- Revisa y normaliza las actividades del otrosí. Cada una:
--   { anexo_item_id, cantidad }                          -> adición a una del contrato
--   { presupuesto_item_id, cantidad, valor_unitario }    -> actividad nueva
-- Devuelve [{ tipo, anexo_item_id, presupuesto_item_id, codigo, actividad,
-- unidad, cantidad, valor_unitario, total, sin_mano_obra }]. Bloquea los
-- ítems del presupuesto (como _guardar_solicitud_contrato).
create or replace function public._normalizar_actividades_otrosi(p_contrato_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_presupuesto uuid;
  v_version uuid;
  v_out jsonb := '[]'::jsonb;
  v_codigos text[] := '{}';
  e jsonb;
  v_ai record;
  v_pi record;
  v_cant numeric;
  v_vu numeric;
  v_mo numeric;
  v_tope numeric;
  v_disp numeric;
  v_tipo text;
  v_actividad text;
  v_unidad text;
  v_sin_mo boolean;
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p) <> 'array' then
    raise exception 'Las actividades del otrosí no son válidas.';
  end if;
  if jsonb_array_length(p) = 0 then
    return '[]'::jsonb;
  end if;
  if jsonb_array_length(p) > 50 then
    raise exception 'Máximo 50 actividades por otrosí.';
  end if;
  select id, proyecto_id, tipo, anexo_tipo into c from contratos where id = p_contrato_id;
  if c.anexo_tipo is distinct from 'valores_unitarios' then
    raise exception 'Solo un contrato por actividades (valores unitarios) admite actividades en el otrosí; a uno a valor global se le cambia el valor total.';
  end if;
  select pr.id, pr.version_actual_id into v_presupuesto, v_version from presupuestos pr where pr.proyecto_id = c.proyecto_id;
  if v_version is null then
    raise exception 'El proyecto no tiene presupuesto vigente: no se pueden agregar actividades.';
  end if;

  for e in select * from jsonb_array_elements(p) loop
    begin
      v_cant := round((e->>'cantidad')::numeric, 4);
    exception when others then
      raise exception 'Una cantidad de las actividades no es un número.';
    end;
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cada actividad del otrosí necesita una cantidad mayor que cero.';
    end if;

    if nullif(e->>'anexo_item_id', '') is not null then
      -- Adición: más cantidad de una actividad del contrato, a su valor pactado.
      v_tipo := 'adicion';
      begin
        select ai.id, ai.actividad, ai.unidad, ai.valor_unitario, ai.sin_mano_obra, p2.codigo into v_ai
          from contrato_anexo_items ai
          left join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
         where ai.id = (e->>'anexo_item_id')::uuid and ai.contrato_id = p_contrato_id;
      exception when invalid_text_representation then
        raise exception 'Una actividad no es de este contrato.';
      end;
      if not found then
        raise exception 'Una actividad no es de este contrato.';
      end if;
      select id, codigo, descripcion, unidad, cantidad, valor_unitario, version_id into v_pi
        from presupuesto_items where version_id = v_version and codigo = v_ai.codigo
       order by id limit 1 for update;
      if not found then
        raise exception 'La actividad "%" ya no está en el presupuesto vigente: no se puede aumentar.', v_ai.actividad;
      end if;
      v_vu := v_ai.valor_unitario;
      v_actividad := regexp_replace(v_ai.actividad, ' \((adición )?Otrosí N° \d+\)$', '');
      v_unidad := v_ai.unidad;
      v_sin_mo := v_ai.sin_mano_obra;
    else
      -- Actividad nueva del presupuesto vigente.
      v_tipo := 'nueva';
      begin
        select id, codigo, descripcion, unidad, cantidad, valor_unitario, version_id into v_pi
          from presupuesto_items where id = (e->>'presupuesto_item_id')::uuid for update;
      exception when invalid_text_representation then
        raise exception 'Una actividad nueva no pertenece al presupuesto vigente del proyecto.';
      end;
      if not found or v_pi.version_id is distinct from v_version then
        raise exception 'Una actividad nueva no pertenece al presupuesto vigente del proyecto.';
      end if;
      if coalesce(v_pi.cantidad, 0) <= 0 or coalesce(v_pi.valor_unitario, 0) <= 0 then
        raise exception 'El ítem % no tiene cantidad o valor en el presupuesto.', v_pi.codigo;
      end if;
      if exists (select 1 from contrato_anexo_items ai join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
                  where ai.contrato_id = p_contrato_id and p2.codigo = v_pi.codigo) then
        raise exception 'El ítem % ya está en el contrato: aumenta su cantidad en vez de agregarlo otra vez.', v_pi.codigo;
      end if;
      begin
        v_vu := round((e->>'valor_unitario')::numeric, 2);
      exception when others then
        raise exception 'El valor unitario del ítem % no es un número.', v_pi.codigo;
      end;
      if v_vu is null or v_vu <= 0 then
        raise exception 'El ítem % necesita un valor unitario mayor que cero.', v_pi.codigo;
      end if;
      v_mo := public._valor_mano_obra_item(v_pi.id);
      v_tope := case when c.tipo = 'mano_obra' and v_mo > 0 then least(v_mo, v_pi.valor_unitario) else v_pi.valor_unitario end;
      if v_vu > v_tope then
        if v_tope < v_pi.valor_unitario then
          raise exception 'El valor unitario del ítem % (%) supera el de mano de obra del presupuesto (%).', v_pi.codigo, v_vu, v_tope;
        end if;
        raise exception 'El valor unitario del ítem % (%) supera el del presupuesto (%).', v_pi.codigo, v_vu, v_pi.valor_unitario;
      end if;
      v_actividad := v_pi.descripcion;
      v_unidad := coalesce(nullif(trim(v_pi.unidad), ''), 'und');
      v_sin_mo := c.tipo = 'mano_obra' and v_mo = 0;
    end if;

    if v_pi.codigo = any (v_codigos) then
      raise exception 'El ítem % está repetido en las actividades del otrosí.', v_pi.codigo;
    end if;
    v_codigos := v_codigos || v_pi.codigo;
    v_disp := v_pi.cantidad - public._contratado_item(v_presupuesto, v_pi.codigo);
    if v_cant > v_disp then
      raise exception 'La cantidad del ítem % (%) supera lo disponible en el presupuesto (%).', v_pi.codigo, v_cant, greatest(v_disp, 0);
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'tipo', v_tipo, 'anexo_item_id', case when v_tipo = 'adicion' then v_ai.id end,
      'presupuesto_item_id', v_pi.id, 'codigo', v_pi.codigo, 'actividad', v_actividad, 'unidad', v_unidad,
      'cantidad', v_cant, 'valor_unitario', v_vu, 'total', round(v_cant * v_vu, 2), 'sin_mano_obra', v_sin_mo));
  end loop;
  return v_out;
end;
$$;
revoke all on function public._normalizar_actividades_otrosi(uuid, jsonb) from public, anon, authenticated;

-- Con actividades, el nuevo valor es el vigente + lo que suman (no se escribe a mano).
create or replace function public._valor_con_actividades_otrosi(p_contrato_id uuid, p_actividades jsonb, p_valor numeric)
returns numeric
language sql
stable security definer
set search_path = public
as $$
  select case when jsonb_array_length(coalesce(p_actividades, '[]'::jsonb)) = 0 then p_valor
              else public._valor_contrato(p_contrato_id)
                   + (select sum((e->>'total')::numeric) from jsonb_array_elements(p_actividades) e) end
$$;
revoke all on function public._valor_con_actividades_otrosi(uuid, jsonb, numeric) from public, anon, authenticated;

-- Al enviar a Subgerencia y al aprobar: las actividades siguen cabiendo en el
-- presupuesto y el valor sigue siendo vigente + actividades (otro otrosí
-- aprobado entre tanto pudo cambiarlo). Devuelve las actividades revisadas.
create or replace function public._revisar_valor_y_actividades_otrosi(p_contrato_id uuid, p_actividades jsonb, p_valor numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acts jsonb;
begin
  v_acts := public._normalizar_actividades_otrosi(p_contrato_id, p_actividades);
  if jsonb_array_length(v_acts) > 0
     and p_valor is distinct from public._valor_con_actividades_otrosi(p_contrato_id, v_acts, p_valor) then
    raise exception 'El valor vigente del contrato cambió (otro otrosí aprobado): devuelve este otrosí al ingeniero para que lo envíe otra vez.';
  end if;
  perform public._validar_valor_otrosi(p_contrato_id, p_valor);
  return v_acts;
end;
$$;
revoke all on function public._revisar_valor_y_actividades_otrosi(uuid, jsonb, numeric) from public, anon, authenticated;

drop function if exists public.crear_otrosi(uuid, jsonb, text, date, numeric);
drop function if exists public.reenviar_otrosi(uuid, jsonb, text, date, numeric);

create or replace function public.crear_otrosi(p_contrato_id uuid, p_modificaciones jsonb, p_justificacion text, p_nueva_fecha_fin date default null, p_nuevo_valor numeric default null, p_actividades jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contrato text;
  v_proyecto uuid;
  v_id uuid;
  v_mods jsonb;
  v_just text := trim(coalesce(p_justificacion, ''));
  v_acts jsonb;
  v_valor numeric;
begin
  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para solicitar otrosí.';
  end if;
  v_contrato := public._exigir_contrato_para_otrosi(p_contrato_id);
  select proyecto_id into v_proyecto from contratos where id = p_contrato_id;
  v_mods := public._normalizar_modificaciones_otrosi(p_modificaciones);
  if v_just = '' then raise exception 'Escribe por qué se necesita el otrosí.'; end if;
  if length(v_just) > 5000 then raise exception 'La justificación es muy larga (máximo 5.000 caracteres).'; end if;
  perform public._validar_prorroga_otrosi(p_contrato_id, p_nueva_fecha_fin);
  -- Con actividades, el valor sube solo: vigente + lo que suman.
  v_acts := public._normalizar_actividades_otrosi(p_contrato_id, p_actividades);
  v_valor := public._valor_con_actividades_otrosi(p_contrato_id, v_acts, p_nuevo_valor);
  perform public._validar_valor_otrosi(p_contrato_id, v_valor);

  insert into otrosis (contrato_id, proyecto_id, modificaciones, justificacion, solicitado_por, nueva_fecha_fin, nuevo_valor, actividades)
  values (p_contrato_id, v_proyecto, v_mods, v_just, auth.uid(), p_nueva_fecha_fin, v_valor, v_acts)
  returning id into v_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('otrosi', v_id, 'creado', auth.uid(), jsonb_build_object('contrato', v_contrato, 'nueva_fecha_fin', p_nueva_fecha_fin, 'nuevo_valor', v_valor,
                                                          'n_actividades', jsonb_array_length(v_acts)));

  perform public._notificar_juridica_otrosi(v_id, 'Otrosí por revisar',
    'Solicitud de otrosí al contrato ' || v_contrato || ' por revisar.');
  return v_id;
end;
$$;
revoke all on function public.crear_otrosi(uuid, jsonb, text, date, numeric, jsonb) from public, anon;
grant execute on function public.crear_otrosi(uuid, jsonb, text, date, numeric, jsonb) to authenticated;

create or replace function public.reenviar_otrosi(p_id uuid, p_modificaciones jsonb, p_justificacion text, p_nueva_fecha_fin date default null, p_nuevo_valor numeric default null, p_actividades jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  v_contrato text;
  v_mods jsonb;
  v_just text := trim(coalesce(p_justificacion, ''));
  v_acts jsonb;
  v_valor numeric;
begin
  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para solicitar otrosí.';
  end if;
  select id, contrato_id, proyecto_id, estado into o from otrosis where id = p_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), o.proyecto_id) then
    raise exception 'El otrosí no existe o no tienes acceso.';
  end if;
  if o.estado <> 'devuelta' then
    raise exception 'Solo se corrige un otrosí devuelto (actualiza la página).';
  end if;
  v_contrato := public._exigir_contrato_para_otrosi(o.contrato_id);
  v_mods := public._normalizar_modificaciones_otrosi(p_modificaciones);
  if v_just = '' then raise exception 'Escribe por qué se necesita el otrosí.'; end if;
  if length(v_just) > 5000 then raise exception 'La justificación es muy larga (máximo 5.000 caracteres).'; end if;
  perform public._validar_prorroga_otrosi(o.contrato_id, p_nueva_fecha_fin);
  v_acts := public._normalizar_actividades_otrosi(o.contrato_id, p_actividades);
  v_valor := public._valor_con_actividades_otrosi(o.contrato_id, v_acts, p_nuevo_valor);
  perform public._validar_valor_otrosi(o.contrato_id, v_valor);

  -- Si Jurídica ya había guardado el documento, sus cláusulas salen otra vez
  -- de lo que corrigió el ingeniero (lo demás que editó se conserva).
  update otrosis
     set modificaciones = v_mods, justificacion = v_just, estado = 'por_revisar', enviado_at = now(),
         nueva_fecha_fin = p_nueva_fecha_fin, nuevo_valor = v_valor, actividades = v_acts,
         minuta_datos = minuta_datos - 'modificaciones'
   where id = p_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id)
  values ('otrosi', p_id, 'reenviado', auth.uid());

  perform public._notificar_juridica_otrosi(p_id, 'Otrosí corregido',
    'Solicitud de otrosí al contrato ' || v_contrato || ' corregida y por revisar.');
end;
$$;
revoke all on function public.reenviar_otrosi(uuid, jsonb, text, date, numeric, jsonb) from public, anon;
grant execute on function public.reenviar_otrosi(uuid, jsonb, text, date, numeric, jsonb) to authenticated;

create or replace function public.resolver_otrosi(p_id uuid, p_accion text, p_motivo text default null, p_minuta jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  v_uid uuid := auth.uid();
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_numero integer;
  v_contrato text;
  v_acts jsonb;
  v_orden integer;
begin
  if p_accion in ('enviar', 'devolver', 'rechazar') then
    if not public.tiene_accion(v_uid, 'aprobar_contratos') then
      raise exception 'No tienes permiso para revisar otrosí.';
    end if;
  elsif p_accion in ('aprobar', 'devolver_juridica') then
    if not public.tiene_accion(v_uid, 'aprobar_minutas') then
      raise exception 'No tienes permiso para aprobar otrosí.';
    end if;
  else
    raise exception 'Acción no válida.';
  end if;
  if p_accion in ('devolver', 'rechazar', 'devolver_juridica') and v_motivo is null then
    raise exception 'Escribe el motivo.';
  end if;

  -- Bloquea la fila: dos personas no resuelven el mismo otrosí.
  select o2.*, c.numero_contrato into o
    from otrosis o2 join contratos c on c.id = o2.contrato_id
   where o2.id = p_id for update of o2;
  if not found or not public.usuario_puede_ver_proyecto(v_uid, o.proyecto_id) then
    raise exception 'El otrosí no existe o no tienes acceso.';
  end if;
  v_contrato := o.numero_contrato;

  if p_accion in ('enviar', 'devolver', 'rechazar') and o.estado not in ('por_revisar', 'devuelta_subgerencia') then
    raise exception 'Este otrosí ya no está en revisión de Jurídica (actualiza la página).';
  end if;
  if p_accion in ('aprobar', 'devolver_juridica') and o.estado <> 'en_revision' then
    raise exception 'Este otrosí ya no está en revisión de Subgerencia (actualiza la página).';
  end if;

  if p_accion = 'enviar' then
    if p_minuta is null or jsonb_typeof(p_minuta) <> 'object' or length(p_minuta::text) > 200000 then
      raise exception 'Documento no válido.';
    end if;
    perform public._exigir_contrato_para_otrosi(o.contrato_id);
    perform public._validar_prorroga_otrosi(o.contrato_id, o.nueva_fecha_fin);
    perform public._revisar_valor_y_actividades_otrosi(o.contrato_id, o.actividades, o.nuevo_valor);
    update otrosis
       set estado = 'en_revision', minuta_datos = p_minuta,
           enviada_subgerencia_at = now(), enviada_subgerencia_por = v_uid
     where id = p_id;
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id)
    values ('otrosi', p_id, case when o.estado = 'devuelta_subgerencia' then 'reenviado_subgerencia' else 'enviado_subgerencia' end, v_uid);
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    select pf.id, 'otrosi_por_aprobar', 'otrosi', p_id,
           case when o.estado = 'devuelta_subgerencia' then 'Otrosí corregido' else 'Otrosí por aprobar' end,
           'Otrosí al contrato ' || v_contrato || ' por aprobar.'
      from perfiles pf
      left join roles r on r.id = pf.rol_id
     where pf.id is distinct from v_uid
       and r.clave is distinct from 'administrador'
       and public.tiene_accion(pf.id, 'aprobar_minutas')
       and public.usuario_puede_ver_proyecto(pf.id, o.proyecto_id);

  elsif p_accion in ('devolver', 'rechazar') then
    update otrosis
       set estado = case when p_accion = 'devolver' then 'devuelta' else 'rechazada' end,
           motivo = v_motivo, resuelto_por = v_uid, resuelto_at = now()
     where id = p_id;
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo)
    values ('otrosi', p_id, case when p_accion = 'devolver' then 'devuelto' else 'rechazado' end, v_uid, v_motivo);
    if o.solicitado_por is not null and o.solicitado_por is distinct from v_uid then
      insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
      values (o.solicitado_por,
              case when p_accion = 'devolver' then 'otrosi_devuelto' else 'otrosi_rechazado' end,
              'otrosi', p_id,
              case when p_accion = 'devolver' then 'Otrosí devuelto' else 'Otrosí rechazado' end,
              'Otrosí al contrato ' || v_contrato
                || case when p_accion = 'devolver' then ' devuelto para corregir. Motivo: ' else ' rechazado. Motivo: ' end
                || v_motivo);
    end if;

  elsif p_accion = 'devolver_juridica' then
    update otrosis
       set estado = 'devuelta_subgerencia', motivo = v_motivo, resuelto_por = v_uid, resuelto_at = now()
     where id = p_id;
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo)
    values ('otrosi', p_id, 'devuelto_subgerencia', v_uid, v_motivo);
    if o.enviada_subgerencia_por is not null and o.enviada_subgerencia_por is distinct from v_uid then
      insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
      values (o.enviada_subgerencia_por, 'otrosi_devuelto_subgerencia', 'otrosi', p_id, 'Otrosí devuelto',
              'Otrosí al contrato ' || v_contrato || ' devuelto por Subgerencia. Motivo: ' || v_motivo);
    end if;

  else -- aprobar
    -- Bloquea el contrato (en _exigir_contrato_para_otrosi): dos otrosí del
    -- mismo contrato no toman el mismo número.
    perform public._exigir_contrato_para_otrosi(o.contrato_id);
    -- Otro otrosí aprobado mientras tanto pudo haber ampliado más el plazo o
    -- cambiado el valor, y pudo haber más actas cobradas.
    perform public._validar_prorroga_otrosi(o.contrato_id, o.nueva_fecha_fin);
    v_acts := public._revisar_valor_y_actividades_otrosi(o.contrato_id, o.actividades, o.nuevo_valor);
    select coalesce(max(numero), 0) + 1 into v_numero from otrosis where contrato_id = o.contrato_id;
    update otrosis
       set estado = 'aprobada', numero = v_numero, aprobado_at = now(), aprobado_por = v_uid,
           motivo = null
     where id = p_id;
    -- Actividades nuevas y adiciones: filas nuevas del anexo del contrato
    -- (las del contrato firmado no se tocan); las actas las cobran.
    if jsonb_array_length(v_acts) > 0 then
      select coalesce(max(orden), 0) into v_orden from contrato_anexo_items where contrato_id = o.contrato_id;
      insert into contrato_anexo_items (contrato_id, orden, presupuesto_item_id, actividad, unidad, cantidad, valor_unitario,
                                        otrosi_id, sin_mano_obra)
      select o.contrato_id, v_orden + t.ord::int, (t.e->>'presupuesto_item_id')::uuid,
             (t.e->>'actividad') || case when t.e->>'tipo' = 'adicion' then ' (adición Otrosí N° ' else ' (Otrosí N° ' end
               || v_numero || ')',
             t.e->>'unidad', (t.e->>'cantidad')::numeric, (t.e->>'valor_unitario')::numeric,
             p_id, coalesce((t.e->>'sin_mano_obra')::boolean, false)
        from jsonb_array_elements(v_acts) with ordinality as t(e, ord);
      update otrosis set actividades = v_acts where id = p_id;
    end if;
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('otrosi', p_id, 'aprobado', v_uid, jsonb_build_object('numero', v_numero, 'contrato', v_contrato, 'nueva_fecha_fin', o.nueva_fecha_fin, 'nuevo_valor', o.nuevo_valor,
                                                             'n_actividades', jsonb_array_length(v_acts)));
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    select distinct u, 'otrosi_aprobado', 'otrosi', p_id, 'Otrosí aprobado',
           'Otrosí N° ' || v_numero || ' al contrato ' || v_contrato || ' aprobado por Subgerencia.'
      from unnest(array[o.solicitado_por, o.enviada_subgerencia_por]) u
     where u is not null and u is distinct from v_uid;
  end if;
end;
$$;

create or replace function public._fila_otrosi(p_id uuid)
returns jsonb
language sql
stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', o.id, 'numero', o.numero, 'estado', o.estado, 'contrato_id', o.contrato_id,
    'numero_contrato', c.numero_contrato, 'contrato_numero', c.numero, 'tipo', c.tipo, 'clase', c.clase,
    'tipo_detalle', c.tipo_detalle, 'objeto', c.objeto, 'valor', public._valor_contrato(c.id), 'nuevo_valor', o.nuevo_valor,
    'anexo_tipo', c.anexo_tipo, 'actividades', o.actividades,
    'proyecto_id', o.proyecto_id, 'proyecto_codigo', p.codigo, 'proyecto_nombre', p.nombre,
    'contratista_nombre', k.nombre,
    'n_modificaciones', jsonb_array_length(o.modificaciones), 'nueva_fecha_fin', o.nueva_fecha_fin,
    'clausulas', (select string_agg(e->>'clausula', ' · ') from jsonb_array_elements(o.modificaciones) e),
    'solicitado_por_nombre', sp.nombre, 'created_at', o.created_at, 'enviado_at', o.enviado_at,
    'enviada_subgerencia_at', o.enviada_subgerencia_at, 'enviada_subgerencia_por_nombre', es.nombre,
    'aprobado_at', o.aprobado_at
  )
  from otrosis o
  join contratos c on c.id = o.contrato_id
  join proyectos p on p.id = o.proyecto_id
  join contratistas k on k.id = c.contratista_id
  left join perfiles sp on sp.id = o.solicitado_por
  left join perfiles es on es.id = o.enviada_subgerencia_por
  where o.id = p_id
$$;

create or replace function public.otrosis_de_contrato(p_contrato_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public._puede_ver_otrosis(v_uid)
     or not exists (select 1 from contratos c
                     where c.id = p_contrato_id and c.proyecto_id in (select public.proyectos_visibles(v_uid))) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', o.id, 'numero', o.numero, 'estado', o.estado, 'nueva_fecha_fin', o.nueva_fecha_fin, 'nuevo_valor', o.nuevo_valor,
             'n_actividades', jsonb_array_length(o.actividades),
             'clausulas', (select string_agg(e->>'clausula', ' · ') from jsonb_array_elements(o.modificaciones) e),
             'solicitado_por_nombre', sp.nombre, 'created_at', o.created_at, 'aprobado_at', o.aprobado_at
           ) order by o.numero nulls last, o.created_at)
      from otrosis o
      left join perfiles sp on sp.id = o.solicitado_por
     where o.contrato_id = p_contrato_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.detalle_acta(p_acta_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v record;
  v_valor numeric;
begin
  select a.*, c.proyecto_id, c.numero_contrato, c.numero as contrato_numero, c.valor as contrato_valor,
         c.objeto, c.tipo as contrato_tipo, c.anexo_tipo, c.contratista_id,
         p.codigo as proyecto_codigo, p.nombre as proyecto_nombre, p.ciudad as proyecto_ciudad,
         emp.razon_social as empresa_nombre, emp.nit as empresa_nit,
         k.nombre as contratista_nombre, k.tipo_persona as contratista_tipo_persona,
         k.tipo_documento || ' ' || k.numero_documento || coalesce('-' || k.digito_verificacion, '') as contratista_documento,
         k.representante_nombre as contratista_representante,
         pc.nombre as creado_por_nombre, pr.nombre as resuelto_por_nombre, pe.nombre as editada_por_nombre
    into v
  from actas a
  join contratos c on c.id = a.contrato_id
  join proyectos p on p.id = c.proyecto_id
  left join empresas emp on emp.id = p.empresa_id
  join contratistas k on k.id = c.contratista_id
  left join perfiles pc on pc.id = a.creado_por
  left join perfiles pr on pr.id = a.resuelto_por
  left join perfiles pe on pe.id = a.editada_por
  where a.id = p_acta_id;
  if not found or not public.puede_ver_actas(v.proyecto_id) then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;
  -- Valor vigente cuando se hizo o editó el acta: un otrosí posterior no
  -- cambia el estado del contrato de un acta vieja.
  v_valor := public._valor_contrato(v.contrato_id, greatest(v.created_at, coalesce(v.editada_at, v.created_at)));

  return jsonb_build_object(
    'id', v.id, 'numero', v.numero, 'tipo', v.tipo, 'estado', v.estado,
    'periodo_desde', v.periodo_desde, 'periodo_hasta', v.periodo_hasta, 'observaciones', v.observaciones,
    'porcentaje_avance', v.porcentaje_avance, 'valor_bruto', v.valor_bruto, 'amortizacion', v.amortizacion,
    'retencion', v.retencion, 'devolucion_retencion', v.devolucion_retencion, 'otros_descuentos', v.otros_descuentos,
    'neto', v.neto, 'anticipo_porcentaje', v.anticipo_porcentaje, 'retencion_porcentaje', v.retencion_porcentaje,
    'created_at', v.created_at, 'creado_por_nombre', v.creado_por_nombre,
    'resuelto_at', v.resuelto_at, 'resuelto_por_nombre', v.resuelto_por_nombre,
    'motivo_resolucion', v.motivo_resolucion,
    'editada_at', v.editada_at, 'editada_por_nombre', v.editada_por_nombre,
    'es_mio', v.creado_por is not distinct from auth.uid(),
    'contrato_id', v.contrato_id, 'numero_contrato', coalesce(v.numero_contrato, 'Solicitud N° ' || v.contrato_numero),
    'contrato_valor', v_valor, 'objeto', v.objeto, 'tipo_contrato', v.contrato_tipo, 'anexo_tipo', v.anexo_tipo,
    'proyecto_codigo', v.proyecto_codigo, 'proyecto_nombre', v.proyecto_nombre, 'proyecto_ciudad', v.proyecto_ciudad,
    'empresa_nombre', v.empresa_nombre, 'empresa_nit', v.empresa_nit,
    'contratista_id', v.contratista_id, 'contratista_nombre', v.contratista_nombre,
    'contratista_tipo_persona', v.contratista_tipo_persona,
    'contratista_documento', v.contratista_documento, 'contratista_representante', v.contratista_representante,
    -- Lo que usan las actas ANTERIORES a esta (número menor, por aprobar +
    -- aprobadas): el estado del contrato del acta no cambia con actas posteriores.
    'otras_actas', (select coalesce(sum(o.valor_bruto), 0) from actas o
                     where o.contrato_id = v.contrato_id and o.numero < v.numero and o.estado <> 'rechazada'),
    -- Avance acumulado ANTES de esta acta (actas anteriores no rechazadas).
    'avance_anterior', (select case when v_valor = v.contrato_valor then coalesce(sum(o.porcentaje_avance), 0)
                                    else coalesce(round(sum(o.valor_bruto) * 100 / nullif(v_valor, 0), 4), 0) end
                          from actas o
                         where o.contrato_id = v.contrato_id and o.numero < v.numero and o.estado <> 'rechazada'),
    'actividades', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'orden', i.orden, 'actividad', i.actividad, 'unidad', i.unidad,
               'cantidad_contratada', i.cantidad, 'valor_unitario', i.valor_unitario,
               'acumulado_anterior', coalesce((
                 select sum(x.cantidad) from acta_actividades x join actas o on o.id = x.acta_id
                 where x.contrato_anexo_item_id = i.id and o.estado <> 'rechazada' and o.numero < v.numero), 0),
               'cantidad', aa.cantidad, 'valor', aa.valor
             ) order by i.orden, i.id)
      from contrato_anexo_items i
      left join acta_actividades aa on aa.acta_id = v.id and aa.contrato_anexo_item_id = i.id
      where i.contrato_id = v.contrato_id
        -- Las actividades de un otrosí solo desde que se aprobó (un acta vieja no cambia).
        and (i.otrosi_id is null
             or exists (select 1 from otrosis ot where ot.id = i.otrosi_id
                         and ot.aprobado_at <= greatest(v.created_at, coalesce(v.editada_at, v.created_at))))), '[]'::jsonb),
    'descuentos', coalesce((
      select jsonb_agg(jsonb_build_object('concepto', d.concepto, 'valor', d.valor) order by d.orden)
      from acta_descuentos d where d.acta_id = v.id), '[]'::jsonb),
    'soportes', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'tipo', s.tipo, 'ruta', s.ruta, 'nombre_archivo', s.nombre_archivo,
                                          'tamano', s.tamano, 'mime', s.mime) order by s.created_at, s.id)
      from acta_soportes s where s.acta_id = v.id), '[]'::jsonb),
    'pago', (select jsonb_build_object('id', g.id, 'estado', g.estado, 'valor', g.valor, 'anio', g.anio,
                                       'semana', g.semana, 'item', g.item, 'novedad', g.novedad)
               from pagos g where g.acta_id = v.id and g.estado not in ('anulado', 'rechazado')
              order by g.creado_en desc limit 1),
    'lineas_anteriores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'orden', l.orden, 'item_codigo', l.item_codigo, 'item_descripcion', l.item_descripcion,
               'insumo_descripcion', l.insumo_descripcion, 'unidad', l.unidad, 'cantidad', l.cantidad,
               'precio', l.precio, 'total', l.total) order by l.orden)
      from acta_lineas l where l.acta_id = v.id), '[]'::jsonb)
  );
end;
$function$;
