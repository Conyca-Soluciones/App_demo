-- ---------------------------------------------------------------------------
-- Prórroga por otrosí (2026-10-20, pedido del usuario): si un otrosí amplía el
-- plazo, su fecha es la fecha de terminación VÁLIDA del contrato (actas por
-- grupos, aviso de vencido, contratos abiertos para otrosí). Cambia la decisión
-- de "solo documento" para el plazo; el valor sigue sin cambiar en el sistema.
--   * otrosis.nueva_fecha_fin (opcional): la pide el ingeniero; debe ser
--     posterior al fin vigente y a hoy (_validar_prorroga_otrosi, al crear,
--     reenviar, enviar a Subgerencia y aprobar).
--   * _fecha_fin_contrato = la nueva fecha del último otrosí APROBADO que la
--     tenga (por número), o el plazo inicial (_fecha_fin_inicial_contrato).
--     Todo lo que ya usaba _fecha_fin_contrato (contrato_para_acta,
--     _avisar_contratos_vencidos, _exigir_contrato_para_otrosi, detalle_otrosi)
--     queda con la fecha vigente sin tocarlo.
-- ---------------------------------------------------------------------------

alter table public.otrosis add column if not exists nueva_fecha_fin date;

-- El plazo inicial (lo que antes era _fecha_fin_contrato).
create or replace function public._fecha_fin_inicial_contrato(p_contrato_id uuid)
returns date
language sql
stable security definer
set search_path = public
as $$
  select case
    when c.plazo_tipo = 'fechas' then c.fecha_fin
    when c.plazo_tipo = 'duracion' and c.fecha_inicio is not null and c.duracion_cantidad is not null then
      (c.fecha_inicio + case when c.duracion_unidad = 'meses'
                             then make_interval(months => c.duracion_cantidad)
                             else make_interval(days => c.duracion_cantidad) end)::date
  end
  from contratos c where c.id = p_contrato_id
$$;
revoke all on function public._fecha_fin_inicial_contrato(uuid) from public, anon, authenticated;

-- Fin vigente: la prórroga del último otrosí aprobado, o el plazo inicial.
create or replace function public._fecha_fin_contrato(p_contrato_id uuid)
returns date
language sql
stable security definer
set search_path = public
as $$
  select coalesce(
    (select o.nueva_fecha_fin from otrosis o
      where o.contrato_id = p_contrato_id and o.estado = 'aprobada' and o.nueva_fecha_fin is not null
      order by o.numero desc limit 1),
    public._fecha_fin_inicial_contrato(p_contrato_id))
$$;
revoke all on function public._fecha_fin_contrato(uuid) from public, anon, authenticated;

-- La prórroga tiene que ampliar el plazo: después del fin vigente y de hoy.
create or replace function public._validar_prorroga_otrosi(p_contrato_id uuid, p_fecha date)
returns void
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_fin date;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  if p_fecha is null then return; end if;
  v_fin := public._fecha_fin_contrato(p_contrato_id);
  if v_fin is not null and p_fecha <= v_fin then
    raise exception 'La nueva fecha de terminación (%) tiene que ser posterior a la vigente (%).',
      to_char(p_fecha, 'DD/MM/YYYY'), to_char(v_fin, 'DD/MM/YYYY');
  end if;
  if p_fecha <= v_hoy then
    raise exception 'La nueva fecha de terminación tiene que ser posterior a hoy.';
  end if;
end;
$$;
revoke all on function public._validar_prorroga_otrosi(uuid, date) from public, anon, authenticated;

-- crear / reenviar con la prórroga (parámetro nuevo al final, opcional).
drop function if exists public.crear_otrosi(uuid, jsonb, text);
drop function if exists public.reenviar_otrosi(uuid, jsonb, text);

create or replace function public.crear_otrosi(p_contrato_id uuid, p_modificaciones jsonb, p_justificacion text, p_nueva_fecha_fin date default null)
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

  insert into otrosis (contrato_id, proyecto_id, modificaciones, justificacion, solicitado_por, nueva_fecha_fin)
  values (p_contrato_id, v_proyecto, v_mods, v_just, auth.uid(), p_nueva_fecha_fin)
  returning id into v_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('otrosi', v_id, 'creado', auth.uid(), jsonb_build_object('contrato', v_contrato, 'nueva_fecha_fin', p_nueva_fecha_fin));

  perform public._notificar_juridica_otrosi(v_id, 'Otrosí por revisar',
    'Solicitud de otrosí al contrato ' || v_contrato || ' por revisar.');
  return v_id;
end;
$$;
revoke all on function public.crear_otrosi(uuid, jsonb, text, date) from public, anon;
grant execute on function public.crear_otrosi(uuid, jsonb, text, date) to authenticated;

create or replace function public.reenviar_otrosi(p_id uuid, p_modificaciones jsonb, p_justificacion text, p_nueva_fecha_fin date default null)
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

  -- Si Jurídica ya había guardado el documento, sus cláusulas salen otra vez
  -- de lo que corrigió el ingeniero (lo demás que editó se conserva).
  update otrosis
     set modificaciones = v_mods, justificacion = v_just, estado = 'por_revisar', enviado_at = now(),
         nueva_fecha_fin = p_nueva_fecha_fin,
         minuta_datos = minuta_datos - 'modificaciones'
   where id = p_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id)
  values ('otrosi', p_id, 'reenviado', auth.uid());

  perform public._notificar_juridica_otrosi(p_id, 'Otrosí corregido',
    'Solicitud de otrosí al contrato ' || v_contrato || ' corregida y por revisar.');
end;
$$;
revoke all on function public.reenviar_otrosi(uuid, jsonb, text, date) from public, anon;
grant execute on function public.reenviar_otrosi(uuid, jsonb, text, date) to authenticated;

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
    -- Otro otrosí aprobado mientras tanto pudo haber ampliado más el plazo.
    perform public._validar_prorroga_otrosi(o.contrato_id, o.nueva_fecha_fin);
    select coalesce(max(numero), 0) + 1 into v_numero from otrosis where contrato_id = o.contrato_id;
    update otrosis
       set estado = 'aprobada', numero = v_numero, aprobado_at = now(), aprobado_por = v_uid,
           motivo = null
     where id = p_id;
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('otrosi', p_id, 'aprobado', v_uid, jsonb_build_object('numero', v_numero, 'contrato', v_contrato, 'nueva_fecha_fin', o.nueva_fecha_fin));
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    select distinct u, 'otrosi_aprobado', 'otrosi', p_id, 'Otrosí aprobado',
           'Otrosí N° ' || v_numero || ' al contrato ' || v_contrato || ' aprobado por Subgerencia.'
      from unnest(array[o.solicitado_por, o.enviada_subgerencia_por]) u
     where u is not null and u is distinct from v_uid;
  end if;
end;
$$;

create or replace function public.contratos_para_otrosi()
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  if not public.tiene_pestana(v_uid, 'contratos.solicitar_otrosi') then
    raise exception 'No tienes permiso para solicitar otrosí.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'numero', x.numero, 'numero_contrato', x.numero_contrato, 'tipo', x.tipo, 'clase', x.clase,
             'tipo_detalle', x.tipo_detalle, 'objeto', x.objeto, 'valor', x.valor, 'fecha_fin', x.fin,
             'proyecto_codigo', x.proyecto_codigo, 'proyecto_nombre', x.proyecto_nombre,
             'contratista_id', x.contratista_id, 'contratista_nombre', x.contratista_nombre,
             'contratista_documento', x.contratista_documento,
             'otrosis_aprobados', x.aprobados, 'otrosis_en_tramite', x.en_tramite
           ) order by x.contratista_nombre, x.numero)
      from (
        select c.id, c.numero, c.numero_contrato, c.tipo, c.clase, c.tipo_detalle, c.objeto, c.valor,
               -- Fin vigente: el de la última prórroga aprobada, o el inicial.
               public._fecha_fin_contrato(c.id) as fin,
               p.codigo as proyecto_codigo, p.nombre as proyecto_nombre,
               k.id as contratista_id, k.nombre as contratista_nombre,
               k.tipo_documento || ' ' || k.numero_documento
                 || case when k.digito_verificacion is not null then '-' || k.digito_verificacion else '' end as contratista_documento,
               coalesce(o.aprobados, 0) as aprobados, coalesce(o.en_tramite, 0) as en_tramite
          from contratos c
          join proyectos p on p.id = c.proyecto_id
          join contratistas k on k.id = c.contratista_id
          left join (
            select contrato_id,
                   count(*) filter (where estado = 'aprobada') as aprobados,
                   count(*) filter (where estado in ('por_revisar', 'devuelta', 'en_revision', 'devuelta_subgerencia')) as en_tramite
              from otrosis group by contrato_id
          ) o on o.contrato_id = c.id
         where c.estado = 'aprobada'
           and c.minuta_estado = 'aprobada'
           and c.liquidado_at is null
           and c.proyecto_id in (select public.proyectos_visibles(v_uid))
      ) x
     where x.fin is null or x.fin >= v_hoy
  ), '[]'::jsonb);
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
    'tipo_detalle', c.tipo_detalle, 'objeto', c.objeto, 'valor', c.valor,
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
             'id', o.id, 'numero', o.numero, 'estado', o.estado, 'nueva_fecha_fin', o.nueva_fecha_fin,
             'clausulas', (select string_agg(e->>'clausula', ' · ') from jsonb_array_elements(o.modificaciones) e),
             'solicitado_por_nombre', sp.nombre, 'created_at', o.created_at, 'aprobado_at', o.aprobado_at
           ) order by o.numero nulls last, o.created_at)
      from otrosis o
      left join perfiles sp on sp.id = o.solicitado_por
     where o.contrato_id = p_contrato_id
  ), '[]'::jsonb);
end;
$$;
