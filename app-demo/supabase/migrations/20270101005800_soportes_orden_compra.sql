-- Soportes de la orden de compra después de crearla (2026-11-23, decisiones del usuario).
--
-- Caso: una OC con dos soportes (uno equivocado) llegó a Preparación en A&F mostrando
-- el equivocado. Compras puede ahora, en el detalle de la orden:
-- - "Añadir soporte": uno más (la orden queda con varios).
-- - "Cambiar soporte": borra ese soporte y deja subir otro en su lugar.
-- Sin volver a aprobar la orden ni tocar sus pagos. Se puede mientras NINGÚN pago de
-- la orden esté liquidado ni pagado (dispersado): en Preparación, Por liquidar u
-- Observado sí. Queda en el historial de la orden (soporte_agregado / soporte_cambiado).
-- Permiso: acción Comprar y el proyecto de la orden (como Modificar).
--
-- "Modificar" ya no exige un soporte nuevo: conserva los que tiene y el nuevo es
-- opcional (se agrega). Solo lo exige si la orden no tiene ninguno.
--
-- El archivo viejo lo borra la app después (la política del bucket solo deja borrar
-- archivos que ya no son soporte de nada). Reversa en supabase/reversa/.

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
  if position(p_b in d) > 0 then
    return;
  end if;
  if position(p_a in d) = 0 then
    raise exception '% no tiene el texto esperado: %', p_fn, left(p_a, 120);
  end if;
  execute replace(d, p_a, p_b);
end;
$f$;

-- ------------------------------------------------------------ Reglas
-- Por qué ya no se cambian los soportes de la orden (null = sí se puede).
create or replace function public._motivo_soportes_orden_fijos(p_orden uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (select 1 from ordenes_compra where id = p_orden) then 'La orden de compra no existe.'
    when exists (select 1 from ordenes_compra where id = p_orden and estado in ('cancelada', 'rechazada'))
      then 'La orden está cancelada o rechazada.'
    when exists (
      select 1 from pagos g
       where g.orden_compra_id = p_orden
         and g.estado not in ('anulado', 'rechazado')
         and (g.liquidacion_estado = 'liquidado' or g.estado = 'dispersado')
    ) then 'Un pago de esta orden ya está liquidado o pagado: los soportes ya no se cambian.'
    else null
  end
$$;

-- Lo mismo para la pantalla: además exige Comprar y el proyecto. null = se puede.
create or replace function public.soportes_orden_editables(p_orden uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_proyecto uuid;
begin
  if auth.uid() is null or not public.tiene_accion(auth.uid(), 'comprar') then
    return 'Sin permiso.';
  end if;
  select proyecto_id into v_proyecto from ordenes_compra where id = p_orden;
  if v_proyecto is null or not public.usuario_puede_ver_proyecto(auth.uid(), v_proyecto) then
    return 'Sin permiso.';
  end if;
  return public._motivo_soportes_orden_fijos(p_orden);
end;
$$;

-- Revisa el archivo nuevo (las mismas reglas de crear la orden).
create or replace function public._validar_soporte_orden_nuevo(p_ruta text, p_tipo text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_ruta is null then
    raise exception 'Adjunta el soporte (cotización, cuenta de cobro o factura).';
  end if;
  if p_tipo is null or p_tipo not in ('cotizacion', 'cuenta_cobro', 'factura') then
    raise exception 'El soporte debe ser una cotización, una cuenta de cobro o una factura.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'ordenes_compra' and o.name = p_ruta) then
    raise exception 'No se encontró el archivo del soporte. Vuelve a adjuntarlo.';
  end if;
  if exists (select 1 from orden_compra_soportes s where s.ruta = p_ruta) then
    raise exception 'Ese archivo ya es soporte de otra orden. Vuelve a adjuntarlo.';
  end if;
end;
$$;

-- Permiso + bloqueo de la orden y sus pagos + regla de los pagos.
create or replace function public._exigir_soportes_orden_editables(p_orden uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proyecto uuid;
  v_motivo text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado.';
  end if;
  if not public.tiene_accion(auth.uid(), 'comprar') then
    raise exception 'No tienes permiso para cambiar los soportes de la orden (acción Comprar).';
  end if;
  select proyecto_id into v_proyecto from ordenes_compra where id = p_orden for update;
  if not found then
    raise exception 'La orden de compra no existe.';
  end if;
  perform public._exigir_proyecto(v_proyecto);
  perform 1 from pagos where orden_compra_id = p_orden for update;
  v_motivo := public._motivo_soportes_orden_fijos(p_orden);
  if v_motivo is not null then
    raise exception '%', v_motivo;
  end if;
end;
$$;

-- ------------------------------------------------------------ Añadir soporte
create or replace function public.agregar_soporte_orden(p_orden uuid, p_soporte jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ruta text := nullif(trim(coalesce(p_soporte->>'ruta', '')), '');
  v_tipo text := p_soporte->>'tipo';
  v_nombre text := coalesce(nullif(trim(p_soporte->>'nombre_archivo'), ''), 'soporte');
  v_id uuid;
begin
  perform public._exigir_soportes_orden_editables(p_orden);
  perform public._validar_soporte_orden_nuevo(v_ruta, v_tipo);
  insert into orden_compra_soportes (orden_compra_id, tipo, ruta, nombre_archivo, tamano, mime, subido_por)
  values (p_orden, v_tipo, v_ruta, v_nombre, nullif(p_soporte->>'tamano', '')::bigint, p_soporte->>'mime', auth.uid())
  returning id into v_id;
  perform public._anotar_historial('orden_compra', p_orden, 'soporte_agregado',
    jsonb_build_object('archivo', v_nombre, 'tipo', v_tipo));
  return v_id;
end;
$$;

-- ------------------------------------------------------------ Cambiar soporte
-- Borra el soporte y deja el nuevo en su lugar. Devuelve la ruta del archivo viejo
-- (la app lo borra del bucket).
create or replace function public.cambiar_soporte_orden(p_soporte_id uuid, p_nuevo jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_viejo orden_compra_soportes%rowtype;
  v_ruta text := nullif(trim(coalesce(p_nuevo->>'ruta', '')), '');
  v_tipo text := p_nuevo->>'tipo';
  v_nombre text := coalesce(nullif(trim(p_nuevo->>'nombre_archivo'), ''), 'soporte');
begin
  select * into v_viejo from orden_compra_soportes where id = p_soporte_id;
  if not found then
    raise exception 'El soporte no existe.';
  end if;
  perform public._exigir_soportes_orden_editables(v_viejo.orden_compra_id);
  perform public._validar_soporte_orden_nuevo(v_ruta, v_tipo);
  delete from orden_compra_soportes where id = p_soporte_id;
  insert into orden_compra_soportes (orden_compra_id, tipo, ruta, nombre_archivo, tamano, mime, subido_por)
  values (v_viejo.orden_compra_id, v_tipo, v_ruta, v_nombre, nullif(p_nuevo->>'tamano', '')::bigint, p_nuevo->>'mime', auth.uid());
  perform public._anotar_historial('orden_compra', v_viejo.orden_compra_id, 'soporte_cambiado',
    jsonb_build_object('antes', v_viejo.nombre_archivo, 'archivo', v_nombre, 'tipo', v_tipo));
  return v_viejo.ruta;
end;
$$;

revoke all on function public._motivo_soportes_orden_fijos(uuid) from public;
revoke all on function public._validar_soporte_orden_nuevo(text, text) from public;
revoke all on function public._exigir_soportes_orden_editables(uuid) from public;
revoke all on function public.soportes_orden_editables(uuid) from public;
revoke all on function public.agregar_soporte_orden(uuid, jsonb) from public;
revoke all on function public.cambiar_soporte_orden(uuid, jsonb) from public;
grant execute on function public.soportes_orden_editables(uuid) to authenticated;
grant execute on function public.agregar_soporte_orden(uuid, jsonb) to authenticated;
grant execute on function public.cambiar_soporte_orden(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ Modificar: el soporte nuevo es opcional
select pg_temp._parche(
  'public.modificar_orden_compra(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, text, date, numeric, text, date, jsonb, jsonb)'::regprocedure,
$a$  if v_ruta is null then
    raise exception 'Adjunta el soporte de la modificación (cotización, cuenta de cobro o factura).';
  end if;
  begin
    if v_tipo_soporte is null or v_tipo_soporte not in ('cotizacion', 'cuenta_cobro', 'factura') then
      raise exception 'El soporte debe ser una cotización, una cuenta de cobro o una factura.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'ordenes_compra' and o.name = v_ruta) then
      raise exception 'No se encontró el archivo del soporte. Vuelve a adjuntarlo.';
    end if;
    if exists (select 1 from orden_compra_soportes s where s.ruta = v_ruta) then
      raise exception 'Ese archivo ya es soporte de otra orden. Vuelve a adjuntarlo.';
    end if;
  end;$a$,
$b$  -- Se conservan los soportes; el nuevo es opcional (20270101005800). Solo se exige si
  -- la orden no tiene ninguno.
  if v_ruta is null then
    if not exists (select 1 from orden_compra_soportes s where s.orden_compra_id = p_orden_id) then
      raise exception 'Adjunta el soporte de la modificación (cotización, cuenta de cobro o factura).';
    end if;
  else
    perform public._validar_soporte_orden_nuevo(v_ruta, v_tipo_soporte);
  end if;$b$);

select pg_temp._parche(
  'public.modificar_orden_compra(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, text, date, numeric, text, date, jsonb, jsonb)'::regprocedure,
$a$  begin
    insert into orden_compra_soportes (orden_compra_id, tipo, ruta, nombre_archivo, tamano, mime, subido_por)
    values (p_orden_id, v_tipo_soporte, v_ruta, coalesce(nullif(trim(p_soporte->>'nombre_archivo'), ''), 'soporte'),
            nullif(p_soporte->>'tamano', '')::bigint, p_soporte->>'mime', auth.uid());
  end;$a$,
$b$  if v_ruta is not null then
    insert into orden_compra_soportes (orden_compra_id, tipo, ruta, nombre_archivo, tamano, mime, subido_por)
    values (p_orden_id, v_tipo_soporte, v_ruta, coalesce(nullif(trim(p_soporte->>'nombre_archivo'), ''), 'soporte'),
            nullif(p_soporte->>'tamano', '')::bigint, p_soporte->>'mime', auth.uid());
  end if;$b$);

commit;
