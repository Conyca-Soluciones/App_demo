-- Editar un acta: solo quien la creó (2026-10-14).
-- Requiere 20261110200000_editar_actas_avisos.sql.
--
-- editar_acta exige además que el acta sea de quien edita (creado_por). Para
-- mostrar el botón "Editar" solo a esa persona, actas_de_contrato y
-- detalle_acta devuelven "es_mio".
-- Se puede correr más de una vez.

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
  select a.id, a.numero, a.estado, a.creado_por into v_acta from actas a where a.id = p_acta_id for update;
  if v_acta.creado_por is distinct from auth.uid() then
    raise exception 'Solo quien hizo el acta % puede editarla.', v_acta.numero;
  end if;
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
    'es_mio', v.creado_por is not distinct from auth.uid(),
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

-- Cambia el tipo de retorno (columna es_mio): hay que borrarla y crearla.
drop function if exists public.actas_de_contrato(uuid);
create or replace function public.actas_de_contrato(p_contrato_id uuid)
 returns table(acta_id uuid, numero integer, estado text, total numeric, created_at timestamptz,
               creado_por_nombre text, lineas integer, es_mio boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_proyecto uuid;
begin
  select c.proyecto_id into v_proyecto from contratos c where c.id = p_contrato_id;
  if v_proyecto is null or not public.puede_ver_actas(v_proyecto) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;

  return query
  select a.id, a.numero, a.estado, a.total, a.created_at, pf.nombre,
         (select count(*)::int from acta_lineas l where l.acta_id = a.id),
         a.creado_por is not distinct from auth.uid()
  from actas a
  left join perfiles pf on pf.id = a.creado_por
  where a.contrato_id = p_contrato_id
  order by a.numero;
end;
$function$;
revoke all on function public.actas_de_contrato(uuid) from public, anon;
grant execute on function public.actas_de_contrato(uuid) to authenticated;
