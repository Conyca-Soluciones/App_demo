-- Contratos generales: tipo Servicios u Otro y sin documentos (decisión del
-- usuario, 2026-10-15: "son solo un papelito con info y observaciones").
--   * contratos.tipo de un general es 'servicios' u 'otro'; con 'otro',
--     contratos.tipo_detalle dice cuál (obligatorio). Los de por grupos siguen
--     con sus 6 tipos.
--   * _guardar_contrato_general ya no pide ni guarda documentos (p_documentos
--     se acepta y se ignora, para no cambiar la firma de crear/reenviar).
-- Se puede correr más de una vez.

alter table public.contratos add column if not exists tipo_detalle text;

alter table public.contratos drop constraint if exists contratos_tipo_check;
alter table public.contratos add constraint contratos_tipo_check check (
  (clase = 'grupo' and tipo in ('mano_obra', 'obra', 'arrendamiento', 'alquiler_vehiculo', 'prestacion_servicios', 'suministro_instalacion'))
  or (clase = 'general' and tipo in ('servicios', 'otro'))
) not valid;
alter table public.contratos drop constraint if exists contratos_tipo_detalle_check;
alter table public.contratos add constraint contratos_tipo_detalle_check check (
  clase = 'grupo' or tipo <> 'otro' or length(trim(coalesce(tipo_detalle, ''))) > 0
) not valid;

create or replace function public._guardar_contrato_general(p_id uuid, p_datos jsonb, p_documentos jsonb, p_existente boolean)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text := p_datos->>'tipo';
  v_tipo_detalle text := nullif(trim(p_datos->>'tipo_detalle'), '');
  v_proyecto uuid := (p_datos->>'proyecto_id')::uuid;
  v_valor numeric := nullif(p_datos->>'valor', '')::numeric;
  v_inicio date := nullif(p_datos->>'fecha_inicio', '')::date;
  v_fin date := nullif(p_datos->>'fecha_fin', '')::date;
  v_descripcion text := nullif(trim(p_datos->>'objeto'), '');
  v_forma_pago text := nullif(trim(p_datos->>'forma_pago'), '');
  v_correo text := lower(trim(coalesce(p_datos->>'correo_notificacion', '')));
  v_garantia numeric := coalesce(nullif(p_datos->>'retencion_garantia_pct', '')::numeric, 0);
  v_ret_anticipo numeric := coalesce(nullif(p_datos->>'retencion_anticipo_pct', '')::numeric, 0);
  v_fic numeric := coalesce(nullif(p_datos->>'retencion_fic_pct', '')::numeric, 0);
  v_numero bigint;
  v_actual record;
begin
  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para elaborar contratos.';
  end if;
  if p_id is null or v_proyecto is null then
    raise exception 'Faltan datos del contrato.';
  end if;
  if not public.usuario_puede_ver_proyecto(auth.uid(), v_proyecto) then
    raise exception 'No tienes acceso a este proyecto.';
  end if;

  if p_existente then
    select id, numero, estado, proyecto_id, clase into v_actual from contratos where id = p_id for update;
    if not found or v_actual.clase <> 'general' then
      raise exception 'El contrato no existe.';
    end if;
    if v_actual.estado <> 'devuelta' then
      raise exception 'Solo se puede corregir un contrato devuelto (este está en otro estado; actualiza la página).';
    end if;
    if v_actual.proyecto_id <> v_proyecto then
      raise exception 'El contrato es de otro proyecto.';
    end if;
  end if;

  if not exists (select 1 from contratistas where id = (p_datos->>'contratista_id')::uuid) then
    raise exception 'El contratista no existe.';
  end if;
  if v_tipo is null or v_tipo not in ('servicios', 'otro') then
    raise exception 'Elige el tipo: Servicios u Otro.';
  end if;
  if v_tipo = 'otro' and v_tipo_detalle is null then
    raise exception 'Escribe qué tipo de contrato es.';
  end if;
  if v_tipo = 'servicios' then
    v_tipo_detalle := null;
  end if;
  if v_valor is null or v_valor <= 0 then
    raise exception 'Escribe el valor del contrato.';
  end if;
  if v_inicio is null or v_fin is null then
    raise exception 'Escribe las fechas de inicio y de terminación.';
  end if;
  if v_fin < v_inicio then
    raise exception 'La fecha de terminación es anterior a la de inicio.';
  end if;
  if v_descripcion is null or length(v_descripcion) < 5 then
    raise exception 'Escribe la descripción del contrato.';
  end if;
  if v_forma_pago is null then
    raise exception 'Escribe la forma de pago.';
  end if;
  if v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Escribe un correo de notificación válido.';
  end if;
  if v_garantia not between 0 and 100 or v_ret_anticipo not between 0 and 100 or v_fic not between 0 and 100 then
    raise exception 'Los porcentajes de retención van entre 0 y 100.';
  end if;

  if p_existente then
    update contratos set
      contratista_id = (p_datos->>'contratista_id')::uuid,
      tipo = v_tipo,
      tipo_detalle = v_tipo_detalle,
      estado = 'pre_aprobacion',
      objeto = v_descripcion,
      valor = round(v_valor, 2),
      forma_pago = v_forma_pago,
      fecha_inicio = v_inicio,
      fecha_fin = v_fin,
      correo_notificacion = v_correo,
      observaciones = nullif(trim(p_datos->>'observaciones'), ''),
      referencia = nullif(trim(p_datos->>'referencia'), ''),
      retencion_garantia_pct = round(v_garantia, 2),
      retencion_anticipo_pct = round(v_ret_anticipo, 2),
      retencion_fic_pct = round(v_fic, 2),
      enviado_at = now()
    where id = p_id;
    v_numero := v_actual.numero;
  else
    insert into contratos (
      id, clase, proyecto_id, contratista_id, tipo, tipo_detalle, objeto, valor, anexo_tipo, tiene_anticipo,
      forma_pago, plazo_tipo, fecha_inicio, fecha_fin, correo_notificacion, observaciones,
      referencia, retencion_garantia_pct, retencion_anticipo_pct, retencion_fic_pct
    ) values (
      p_id, 'general', v_proyecto, (p_datos->>'contratista_id')::uuid, v_tipo, v_tipo_detalle, v_descripcion, round(v_valor, 2), 'valor_global', false,
      v_forma_pago, 'fechas', v_inicio, v_fin, v_correo, nullif(trim(p_datos->>'observaciones'), ''),
      nullif(trim(p_datos->>'referencia'), ''), round(v_garantia, 2), round(v_ret_anticipo, 2), round(v_fic, 2)
    )
    returning numero into v_numero;
  end if;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('contrato', p_id, case when p_existente then 'reenviada' else 'creada' end, auth.uid(),
          jsonb_build_object('valor', round(v_valor, 2), 'clase', 'general'));

  perform public._notificar_aprobadores_contrato(
    p_id,
    case when p_existente then 'Contrato general corregido' else 'Nuevo contrato general' end,
    'Contrato general N° ' || v_numero || ' por revisar en pre-aprobación.'
  );

  return v_numero;
end;
$$;
