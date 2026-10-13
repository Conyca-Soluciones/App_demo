-- Editar actas y avisos de aprobación (2026-10-14).
-- Requiere 20261110000000_actas_contratos.sql y 20261110100000_aprobacion_actas.sql.
--
-- 1. Editar: un acta que no esté aprobada (por aprobar o rechazada) se puede
--    corregir con la acción elaborar_actas. Se reemplazan sus líneas (precio e
--    IVA otra vez desde el APU), se revisa el cupo sin contar el acta misma y
--    queda "por aprobar" con el MISMO número (una rechazada vuelve a
--    aprobación y deja de tener motivo).
-- 2. Avisos: al aprobar o rechazar un acta, quien la creó recibe una
--    notificación (si no fue él mismo quien la resolvió). La campanita lleva a
--    Elaboración de actas con el acta abierta (?ver=<id>).
-- Se puede correr más de una vez.

-- ---------------------------------------------------------------- notificaciones
alter table public.notificaciones drop constraint if exists notificaciones_entidad_tipo_check;
alter table public.notificaciones add constraint notificaciones_entidad_tipo_check
  check (entidad_tipo = any (array['pedido_insumo', 'orden_compra', 'requisicion', 'contrato', 'acta'])) not valid;

alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check
  check (tipo = any (array['pedido_rechazado', 'pedido_aprobado', 'orden_compra_rechazada', 'orden_compra_aprobada',
                           'insumo_sobre_presupuesto', 'orden_compra_precio_sobre_efectivo', 'contrato_por_revisar',
                           'contrato_aprobado', 'contrato_devuelto', 'contrato_rechazado',
                           'acta_aprobada', 'acta_rechazada'])) not valid;

-- ---------------------------------------------------------------- quién editó
alter table public.actas add column if not exists editada_at timestamptz;
alter table public.actas add column if not exists editada_por uuid references public.perfiles(id);
create index if not exists idx_actas_editada_por on public.actas (editada_por);

-- ---------------------------------------------------------------- líneas (común a crear y editar)
-- Valida y guarda las líneas de un acta (que ya no tiene líneas) y devuelve
-- su total. El llamador ya bloqueó el contrato y revisó permisos.
create or replace function public._llenar_acta(p_acta_id uuid, p_proyecto_id uuid, p_lineas jsonb)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_version uuid;
  v_orden integer := 0;
  v_total numeric := 0;
  v_item record;
  v_linea record;
  v_cantidad numeric;
  v_base numeric;
  v_iva numeric;
  d jsonb;
begin
  if jsonb_typeof(coalesce(p_lineas, 'null')) is distinct from 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos una línea al acta.';
  end if;
  if jsonb_array_length(p_lineas) > 20 then
    raise exception 'Un acta tiene como máximo 20 líneas.';
  end if;
  if (select count(distinct (e->>'presupuesto_item_id') || '|' || (e->>'item_apu_id')) from jsonb_array_elements(p_lineas) e)
     <> jsonb_array_length(p_lineas) then
    raise exception 'Hay una línea repetida (mismo ítem e insumo).';
  end if;

  select p.version_actual_id into v_version from presupuestos p where p.proyecto_id = p_proyecto_id;

  for d in select * from jsonb_array_elements(p_lineas) loop
    v_orden := v_orden + 1;
    begin
      v_cantidad := (d->>'cantidad')::numeric;
    exception when others then
      raise exception 'La cantidad de la línea % no es un número.', v_orden;
    end;
    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'La cantidad de la línea % debe ser mayor que cero.', v_orden;
    end if;

    select pi.id, pi.codigo, pi.descripcion into v_item
    from presupuesto_items pi
    where pi.id = (d->>'presupuesto_item_id')::uuid and pi.version_id = v_version;
    if not found then
      raise exception 'El ítem de la línea % no es del presupuesto vigente del proyecto.', v_orden;
    end if;

    select l.* into v_linea from public._lineas_apu_para_acta(v_item.id) l
    where l.item_apu_id = (d->>'item_apu_id')::uuid;
    if not found then
      raise exception 'El insumo de la línea % no es del APU del ítem %.', v_orden, v_item.codigo;
    end if;
    if v_linea.precio is null then
      raise exception 'El insumo de la línea % no tiene precio.', v_orden;
    end if;

    v_base := round(v_cantidad * v_linea.precio, 2);
    v_iva := round(v_base * v_linea.iva_porcentaje / 100, 2);
    v_total := v_total + v_base + v_iva;

    insert into acta_lineas (acta_id, orden, presupuesto_item_id, item_apu_id, item_codigo, item_descripcion,
                             insumo_codigo, insumo_descripcion, unidad, cantidad, precio, iva_porcentaje,
                             base_iva, iva, total)
    values (p_acta_id, v_orden, v_item.id, v_linea.item_apu_id, v_item.codigo, v_item.descripcion,
            v_linea.insumo_codigo, v_linea.descripcion, v_linea.unidad, v_cantidad, v_linea.precio,
            v_linea.iva_porcentaje, v_base, v_iva, v_base + v_iva);
  end loop;

  return v_total;
end;
$function$;
revoke all on function public._llenar_acta(uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- crear (igual, con _llenar_acta)
create or replace function public.crear_acta(p_contrato_id uuid, p_lineas jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_contrato record;
  v_acta uuid;
  v_numero integer;
  v_disponible numeric;
  v_total numeric;
begin
  if not public.tiene_accion(auth.uid(), 'elaborar_actas') then
    raise exception 'No tienes permiso para elaborar actas.';
  end if;

  -- Bloquea el contrato: dos actas a la vez no sacan el mismo número ni se
  -- pasan juntas del cupo.
  select c.id, c.estado, c.proyecto_id, c.valor into v_contrato from contratos c where c.id = p_contrato_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v_contrato.proyecto_id) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  if v_contrato.estado <> 'aprobada' then
    raise exception 'Solo se hacen actas de contratos aprobados.';
  end if;

  v_disponible := v_contrato.valor - public._consumido_actas_contrato(p_contrato_id);

  select coalesce(max(a.numero), 0) + 1 into v_numero from actas a where a.contrato_id = p_contrato_id;
  insert into actas (contrato_id, numero, total, creado_por)
  values (p_contrato_id, v_numero, 0, auth.uid())
  returning id into v_acta;

  v_total := public._llenar_acta(v_acta, v_contrato.proyecto_id, p_lineas);
  if v_total > v_disponible then
    raise exception 'El acta suma % y el saldo del contrato es %. Las actas no pueden superar el valor del contrato.',
      public._pesos_texto(v_total), public._pesos_texto(greatest(v_disponible, 0));
  end if;

  update actas set total = v_total where id = v_acta;
  return jsonb_build_object('id', v_acta, 'numero', v_numero);
end;
$function$;
revoke all on function public.crear_acta(uuid, jsonb) from public, anon;
grant execute on function public.crear_acta(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- editar
create or replace function public.editar_acta(p_acta_id uuid, p_lineas jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_contrato_id uuid;
  v_contrato record;
  v_acta record;
  v_disponible numeric;
  v_total numeric;
begin
  if not public.tiene_accion(auth.uid(), 'elaborar_actas') then
    raise exception 'No tienes permiso para elaborar actas.';
  end if;

  -- Mismo orden de bloqueo que crear_acta: primero el contrato, luego el acta.
  select a.contrato_id into v_contrato_id from actas a where a.id = p_acta_id;
  if v_contrato_id is null then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;
  select c.id, c.estado, c.proyecto_id, c.valor into v_contrato from contratos c where c.id = v_contrato_id for update;
  if not public.usuario_puede_ver_proyecto(auth.uid(), v_contrato.proyecto_id) then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;
  select a.id, a.numero, a.estado into v_acta from actas a where a.id = p_acta_id for update;
  if v_acta.estado = 'aprobada' then
    raise exception 'El acta % ya está aprobada y no se puede editar (actualiza la página).', v_acta.numero;
  end if;
  if v_contrato.estado <> 'aprobada' then
    raise exception 'Solo se hacen actas de contratos aprobados.';
  end if;

  -- Cupo sin contar esta acta (si estaba por aprobar, ya estaba sumada).
  v_disponible := v_contrato.valor - public._consumido_actas_contrato(v_contrato.id)
                  + (select case when a.estado = 'pendiente' then a.total else 0 end from actas a where a.id = p_acta_id);

  delete from acta_lineas where acta_id = p_acta_id;
  v_total := public._llenar_acta(p_acta_id, v_contrato.proyecto_id, p_lineas);
  if v_total > v_disponible then
    raise exception 'El acta suma % y el saldo del contrato es %. Las actas no pueden superar el valor del contrato.',
      public._pesos_texto(v_total), public._pesos_texto(greatest(v_disponible, 0));
  end if;

  update actas
     set total = v_total, estado = 'pendiente',
         resuelto_por = null, resuelto_at = null, motivo_resolucion = null,
         editada_at = now(), editada_por = auth.uid()
   where id = p_acta_id;
  return jsonb_build_object('id', p_acta_id, 'numero', v_acta.numero);
end;
$function$;
revoke all on function public.editar_acta(uuid, jsonb) from public, anon;
grant execute on function public.editar_acta(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- detalle (+ ids para editar y quién editó)
create or replace function public.detalle_acta(p_acta_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v record;
begin
  select a.*, c.proyecto_id, c.numero_contrato, c.numero as contrato_numero, c.valor as contrato_valor,
         c.objeto, c.tipo, c.contratista_id, p.codigo as proyecto_codigo, p.nombre as proyecto_nombre,
         k.nombre as contratista_nombre,
         k.tipo_documento || ' ' || k.numero_documento || coalesce('-' || k.digito_verificacion, '') as contratista_documento,
         pc.nombre as creado_por_nombre, pr.nombre as resuelto_por_nombre, pe.nombre as editada_por_nombre
    into v
  from actas a
  join contratos c on c.id = a.contrato_id
  join proyectos p on p.id = c.proyecto_id
  join contratistas k on k.id = c.contratista_id
  left join perfiles pc on pc.id = a.creado_por
  left join perfiles pr on pr.id = a.resuelto_por
  left join perfiles pe on pe.id = a.editada_por
  where a.id = p_acta_id;
  if not found or not public.puede_ver_actas(v.proyecto_id) then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;

  return jsonb_build_object(
    'id', v.id, 'numero', v.numero, 'estado', v.estado, 'total', v.total,
    'created_at', v.created_at, 'creado_por_nombre', v.creado_por_nombre,
    'resuelto_at', v.resuelto_at, 'resuelto_por_nombre', v.resuelto_por_nombre,
    'motivo_resolucion', v.motivo_resolucion,
    'editada_at', v.editada_at, 'editada_por_nombre', v.editada_por_nombre,
    'contrato_id', v.contrato_id, 'numero_contrato', coalesce(v.numero_contrato, 'Solicitud N° ' || v.contrato_numero),
    'contrato_valor', v.contrato_valor, 'objeto', v.objeto, 'tipo', v.tipo,
    'proyecto_codigo', v.proyecto_codigo, 'proyecto_nombre', v.proyecto_nombre,
    'contratista_id', v.contratista_id,
    'contratista_nombre', v.contratista_nombre, 'contratista_documento', v.contratista_documento,
    -- Lo que usan las DEMÁS actas del contrato (por aprobar + aprobadas).
    'otras_actas', (select coalesce(sum(o.total), 0) from actas o
                     where o.contrato_id = v.contrato_id and o.id <> v.id and o.estado <> 'rechazada'),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'orden', l.orden, 'presupuesto_item_id', l.presupuesto_item_id, 'item_apu_id', l.item_apu_id,
               'item_codigo', l.item_codigo, 'item_descripcion', l.item_descripcion,
               'insumo_codigo', l.insumo_codigo, 'insumo_descripcion', l.insumo_descripcion, 'unidad', l.unidad,
               'cantidad', l.cantidad, 'precio', l.precio, 'iva_porcentaje', l.iva_porcentaje,
               'base_iva', l.base_iva, 'iva', l.iva, 'total', l.total) order by l.orden)
      from acta_lineas l where l.acta_id = v.id), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.detalle_acta(uuid) from public, anon;
grant execute on function public.detalle_acta(uuid) to authenticated;

-- ---------------------------------------------------------------- aprobar / rechazar (+ aviso a quien la creó)
create or replace function public.resolver_acta(p_acta_id uuid, p_accion text, p_motivo text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v record;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_actas') then
    raise exception 'No tienes permiso para aprobar actas.';
  end if;
  select a.id, a.numero, a.estado, a.creado_por, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero) as numero_contrato
    into v
  from actas a join contratos c on c.id = a.contrato_id
  where a.id = p_acta_id
  for update of a;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v.proyecto_id) then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;
  if v.estado <> 'pendiente' then
    raise exception 'Esta acta ya no está por aprobar (actualiza la página).';
  end if;
  if p_accion not in ('aprobar', 'rechazar') then
    raise exception 'Acción no válida.';
  end if;
  if p_accion = 'rechazar' and v_motivo is null then
    raise exception 'Escribe el motivo.';
  end if;

  update actas
     set estado = case when p_accion = 'aprobar' then 'aprobada' else 'rechazada' end,
         resuelto_por = auth.uid(), resuelto_at = now(),
         motivo_resolucion = case when p_accion = 'rechazar' then v_motivo end
   where id = p_acta_id;

  if v.creado_por is not null and v.creado_por is distinct from auth.uid() then
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    values (v.creado_por,
            case when p_accion = 'aprobar' then 'acta_aprobada' else 'acta_rechazada' end,
            'acta', p_acta_id,
            case when p_accion = 'aprobar' then 'Acta aprobada' else 'Acta rechazada' end,
            'Acta ' || v.numero || ' del contrato ' || v.numero_contrato
              || case when p_accion = 'aprobar' then ' aprobada.'
                      else ' rechazada. Motivo: ' || v_motivo || ' Puedes corregirla y enviarla otra vez.' end);
  end if;
end;
$function$;
revoke all on function public.resolver_acta(uuid, text, text) from public, anon;
grant execute on function public.resolver_acta(uuid, text, text) to authenticated;
