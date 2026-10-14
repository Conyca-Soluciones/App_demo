-- Actas: se aprueban al aprobar su PAGO en A&F (2026-10-14, decisión del usuario).
-- Requiere 20261112000000_actas_sobre_contrato.sql.
--
-- El director de obra elabora el acta y su pago queda de una vez "solicitado"
-- (por aprobar) en Aprobación de pagos; no hay paso de aprobación del acta.
-- - Aprobar el pago (aprobar_pago) -> el acta queda aprobada (ya no se edita;
--   la de liquidación deja el contrato liquidado).
-- - Rechazar el pago (rechazar_pago, con motivo) -> el acta queda rechazada:
--   su valor vuelve al saldo y quien la hizo puede corregirla y reenviarla
--   (eso crea un pago nuevo por aprobar).
-- - Editar un acta con el pago por aprobar actualiza ese pago.
-- - Neto en $0 o negativo (p. ej. liquidación a favor de la empresa): no hay
--   pago y el acta queda aprobada sola.
-- Lo hace un disparador sobre pagos (cubre aprobar_pago, rechazar_pago y
-- cualquier otro camino). resolver_acta ya no se usa.
-- Se puede correr más de una vez.

-- ---------------------------------------------------------------- aprobar / rechazar el acta
create or replace function public._aprobar_acta(p_acta_id uuid, p_usuario uuid, p_pago_id uuid default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v record;
  v_nombre text;
begin
  select a.id, a.numero, a.tipo, a.estado, a.neto, a.creado_por, a.contrato_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero) as numero_contrato
    into v
  from actas a join contratos c on c.id = a.contrato_id
  where a.id = p_acta_id
  for update of a;
  if not found or v.estado <> 'pendiente' then
    return;
  end if;

  update actas set estado = 'aprobada', resuelto_por = p_usuario, resuelto_at = now(), motivo_resolucion = null
   where id = p_acta_id;
  if v.tipo = 'liquidacion' then
    update contratos set liquidado_at = now() where id = v.contrato_id and liquidado_at is null;
  end if;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('acta', p_acta_id, 'aprobada', p_usuario,
          case when p_pago_id is not null then jsonb_build_object('pago_id', p_pago_id, 'neto', v.neto)
               else jsonb_build_object('sin_pago', true, 'neto', v.neto) end);

  v_nombre := case v.tipo when 'final' then 'Acta final' when 'liquidacion' then 'Acta de liquidación' else 'Acta' end;
  if v.creado_por is not null and v.creado_por is distinct from p_usuario then
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    values (v.creado_por, 'acta_aprobada', 'acta', p_acta_id, v_nombre || ' aprobada',
            v_nombre || ' ' || v.numero || ' del contrato ' || v.numero_contrato
              || case when p_pago_id is not null then ': su pago fue aprobado en A&F.'
                      else ' aprobada (sin pago: el neto es cero o negativo).' end);
  end if;
end;
$function$;
revoke all on function public._aprobar_acta(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public._rechazar_acta(p_acta_id uuid, p_usuario uuid, p_motivo text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v record;
  v_nombre text;
begin
  select a.id, a.numero, a.tipo, a.estado, a.creado_por,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero) as numero_contrato
    into v
  from actas a join contratos c on c.id = a.contrato_id
  where a.id = p_acta_id
  for update of a;
  if not found or v.estado <> 'pendiente' then
    return;
  end if;

  update actas set estado = 'rechazada', resuelto_por = p_usuario, resuelto_at = now(), motivo_resolucion = p_motivo
   where id = p_acta_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
  values ('acta', p_acta_id, 'rechazada', p_usuario, p_motivo, jsonb_build_object('pago_rechazado', true));

  v_nombre := case v.tipo when 'final' then 'Acta final' when 'liquidacion' then 'Acta de liquidación' else 'Acta' end;
  if v.creado_por is not null and v.creado_por is distinct from p_usuario then
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    values (v.creado_por, 'acta_rechazada', 'acta', p_acta_id, v_nombre || ' rechazada',
            v_nombre || ' ' || v.numero || ' del contrato ' || v.numero_contrato
              || ': A&F rechazó su pago. Motivo: ' || coalesce(p_motivo, '—') || ' Puedes corregirla y enviarla otra vez.');
  end if;
end;
$function$;
revoke all on function public._rechazar_acta(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- el pago del acta
-- Crea o actualiza el pago por aprobar del acta (estado 'solicitado'). Con
-- neto (redondeado) <= 0 anula el pago pendiente que hubiera y aprueba el acta.
create or replace function public._pago_de_acta(p_acta_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v record;
  v_valor numeric;
  v_tercero uuid;
  v_cuenta uuid;
  v_concepto text;
  v_pago uuid;
begin
  select a.id, a.numero, a.tipo, a.estado, a.neto, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero) as numero_contrato,
         k.numero_documento, k.nombre as contratista_nombre, py.empresa_id, e.consolidado_id
    into v
  from actas a
  join contratos c on c.id = a.contrato_id
  join contratistas k on k.id = c.contratista_id
  left join proyectos py on py.id = c.proyecto_id
  left join empresas e on e.id = py.empresa_id
  where a.id = p_acta_id;
  if not found or v.estado <> 'pendiente' then
    return;
  end if;

  select g.id into v_pago from pagos g where g.acta_id = p_acta_id and g.estado = 'solicitado'
   order by g.creado_en desc limit 1;
  v_valor := round(v.neto, 0);

  if v_valor <= 0 then
    if v_pago is not null then
      update pagos set estado = 'anulado', anulado_en = now(),
                       motivo_anulacion = 'El neto del acta quedó en cero o negativo.'
       where id = v_pago;
    end if;
    perform public._aprobar_acta(p_acta_id, auth.uid(), null);
    return;
  end if;

  -- Tercero = documento del contratista; la cuenta se elige sola si tiene UNA verificada.
  select t.id into v_tercero from terceros t where t.numero_documento = v.numero_documento limit 1;
  if v_tercero is not null then
    select tc.id into v_cuenta from terceros_cuentas tc
     where tc.tercero_id = v_tercero and tc.estado = 'ACTIVO'
       and (select count(*) from terceros_cuentas x where x.tercero_id = v_tercero and x.estado = 'ACTIVO') = 1;
  end if;
  v_concepto := upper(case v.tipo when 'final' then 'Acta final' when 'liquidacion' then 'Acta de liquidación' else 'Acta' end)
                || ' N° ' || v.numero || ' - CONTRATO ' || v.numero_contrato || ' - ' || upper(v.contratista_nombre);

  if v_pago is not null then
    update pagos set valor = v_valor, concepto = v_concepto, solicitado_en = now(),
                     tercero_id = coalesce(tercero_id, v_tercero),
                     cuenta_tercero_id = coalesce(cuenta_tercero_id, v_cuenta)
     where id = v_pago;
  else
    insert into pagos (fuente, acta_id, tipo, proyecto_id, empresa_id, consolidado_id, tercero_id,
                       cuenta_tercero_id, concepto, valor, estado, solicitado_en)
    values ('acta', p_acta_id, 'unico', v.proyecto_id, v.empresa_id, v.consolidado_id, v_tercero, v_cuenta,
            v_concepto, v_valor, 'solicitado', now())
    returning id into v_pago;
  end if;
  perform public._pago_actualizar_novedad(v_pago);
end;
$function$;
revoke all on function public._pago_de_acta(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- A&F resuelve el pago -> el acta
create or replace function public._acta_sigue_pago()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.acta_id is null or old.estado is not distinct from new.estado or old.estado <> 'solicitado' then
    return new;
  end if;
  if new.estado = 'aprobado' then
    perform public._aprobar_acta(new.acta_id, new.aprobado_por, new.id);
  elsif new.estado = 'rechazado' then
    perform public._rechazar_acta(new.acta_id, new.rechazado_por, new.motivo_rechazo);
  end if;
  return new;
end;
$function$;
revoke all on function public._acta_sigue_pago() from public, anon, authenticated;

drop trigger if exists trg_acta_sigue_pago on public.pagos;
create trigger trg_acta_sigue_pago
  after update of estado on public.pagos
  for each row execute function public._acta_sigue_pago();

-- ---------------------------------------------------------------- crear / editar (igual + el pago)
create or replace function public.crear_acta(p_acta_id uuid, p_contrato_id uuid, p_datos jsonb, p_soportes jsonb default '[]')
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_contrato record;
  v_numero integer;
begin
  if not public.tiene_accion(auth.uid(), 'elaborar_actas') then
    raise exception 'No tienes permiso para elaborar actas.';
  end if;
  -- Bloquea el contrato: dos actas a la vez no sacan el mismo número ni se
  -- pasan juntas de los topes.
  select c.id, c.proyecto_id into v_contrato from contratos c where c.id = p_contrato_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v_contrato.proyecto_id) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;

  select coalesce(max(a.numero), 0) + 1 into v_numero from actas a where a.contrato_id = p_contrato_id;
  insert into actas (id, contrato_id, numero, total, creado_por)
  values (coalesce(p_acta_id, gen_random_uuid()), p_contrato_id, v_numero, 0, auth.uid())
  returning id into p_acta_id;

  perform public._guardar_acta(p_acta_id, p_contrato_id, p_datos);
  perform public._agregar_soportes_acta(p_acta_id, p_soportes);

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  select 'acta', a.id, 'creada', auth.uid(), jsonb_build_object('tipo', a.tipo, 'neto', a.neto, 'valor_bruto', a.valor_bruto)
    from actas a where a.id = p_acta_id;
  -- El pago del acta queda por aprobar en A&F (o el acta se aprueba sola si el neto es 0).
  perform public._pago_de_acta(p_acta_id);
  return jsonb_build_object('id', p_acta_id, 'numero', v_numero);
end;
$function$;
revoke all on function public.crear_acta(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.crear_acta(uuid, uuid, jsonb, jsonb) to authenticated;

create or replace function public.editar_acta(p_acta_id uuid, p_datos jsonb, p_soportes_nuevos jsonb default '[]',
                                              p_soportes_quitar uuid[] default '{}')
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_contrato_id uuid;
  v_contrato record;
  v_acta record;
  v_quitadas text[];
begin
  if not public.tiene_accion(auth.uid(), 'elaborar_actas') then
    raise exception 'No tienes permiso para elaborar actas.';
  end if;
  -- Mismo orden de bloqueo que crear_acta: primero el contrato, luego el acta.
  select a.contrato_id into v_contrato_id from actas a where a.id = p_acta_id;
  if v_contrato_id is null then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;
  select c.id, c.proyecto_id into v_contrato from contratos c where c.id = v_contrato_id for update;
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

  delete from acta_actividades where acta_id = p_acta_id;
  delete from acta_descuentos where acta_id = p_acta_id;
  delete from acta_lineas where acta_id = p_acta_id;
  perform public._guardar_acta(p_acta_id, v_contrato_id, p_datos);

  with q as (
    delete from acta_soportes s where s.acta_id = p_acta_id and s.id = any (coalesce(p_soportes_quitar, '{}'))
    returning s.ruta
  )
  select coalesce(array_agg(ruta), '{}') into v_quitadas from q;
  perform public._agregar_soportes_acta(p_acta_id, p_soportes_nuevos);

  update actas
     set estado = 'pendiente', resuelto_por = null, resuelto_at = null, motivo_resolucion = null,
         editada_at = now(), editada_por = auth.uid()
   where id = p_acta_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  select 'acta', a.id, case when v_acta.estado = 'rechazada' then 'reenviada' else 'editada' end, auth.uid(),
         jsonb_build_object('neto', a.neto, 'valor_bruto', a.valor_bruto)
    from actas a where a.id = p_acta_id;
  -- Actualiza el pago por aprobar (o crea uno nuevo si el anterior fue rechazado).
  perform public._pago_de_acta(p_acta_id);
  return jsonb_build_object('id', p_acta_id, 'numero', v_acta.numero, 'rutas_quitadas', to_jsonb(v_quitadas));
end;
$function$;
revoke all on function public.editar_acta(uuid, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.editar_acta(uuid, jsonb, jsonb, uuid[]) to authenticated;


-- ---------------------------------------------------------------- resolver_acta ya no aplica
create or replace function public.resolver_acta(p_acta_id uuid, p_accion text, p_motivo text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  raise exception 'Las actas se aprueban o rechazan al aprobar o rechazar su pago en A&F (Aprobación de pagos).';
end;
$function$;
revoke all on function public.resolver_acta(uuid, text, text) from public, anon;
grant execute on function public.resolver_acta(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- actas ya existentes por aprobar
-- Las que quedaron "por aprobar" con el flujo anterior pasan a tener su pago por aprobar.
do $$
declare
  r record;
begin
  for r in select a.id from actas a
            where a.estado = 'pendiente'
              and not exists (select 1 from pagos g where g.acta_id = a.id and g.estado not in ('anulado', 'rechazado'))
  loop
    perform public._pago_de_acta(r.id);
  end loop;
end $$;
