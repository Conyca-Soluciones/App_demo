-- ---------------------------------------------------------------------------
-- Prórroga y nuevo valor por otrosí (2026-10-20, pedido del usuario). Cambia
-- la decisión de "solo documento" para el plazo y el valor; lo demás que
-- cambie el otrosí sigue siendo solo la redacción de la cláusula.
--   * otrosis.nueva_fecha_fin (opcional): debe ser posterior al fin vigente y
--     a hoy (_validar_prorroga_otrosi).
--   * otrosis.nuevo_valor (opcional): nuevo valor total del contrato; distinto
--     del vigente y no menor que lo ya cobrado en actas no rechazadas
--     (_validar_valor_otrosi).
--     Las dos se revisan al crear, reenviar, enviar a Subgerencia y aprobar.
--   * Cuentan solo cuando el otrosí queda APROBADO (el último por número):
--     _fecha_fin_contrato = la nueva fecha, o el plazo inicial
--     (_fecha_fin_inicial_contrato); todo lo que ya la usaba
--     (contrato_para_acta, _avisar_contratos_vencidos,
--     _exigir_contrato_para_otrosi, detalle_otrosi) queda con la vigente.
--     _valor_contrato = el nuevo valor, o contratos.valor: es el tope de las
--     actas (contrato_para_acta, _guardar_acta) y el valor que muestran
--     detalle_acta, listar_actas_aprobacion y buscar_contratos_para_acta.
--     contratos.valor no se toca (es el del contrato firmado). El anticipo
--     sigue siendo % del valor INICIAL. En contratos a valor global, después
--     de un cambio de valor el % de avance es sobre el valor vigente y lo ya
--     cobrado cuenta como su equivalente (bruto / valor vigente).
--     detalle_acta usa el valor vigente cuando se hizo o editó el acta, así el
--     estado del contrato de un acta vieja no cambia.
-- Se puede correr otra vez (si ya se corrió la versión solo con prórroga,
-- borra las funciones de 4 parámetros).
-- ---------------------------------------------------------------------------

alter table public.otrosis add column if not exists nueva_fecha_fin date;
alter table public.otrosis add column if not exists nuevo_valor numeric(18, 2);
alter table public.otrosis drop constraint if exists otrosis_nuevo_valor_positivo;
alter table public.otrosis add constraint otrosis_nuevo_valor_positivo check (nuevo_valor is null or nuevo_valor > 0);

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

-- Valor vigente: el nuevo valor del último otrosí aprobado (hasta p_hasta, si
-- se da), o el valor del contrato.
create or replace function public._valor_contrato(p_contrato_id uuid, p_hasta timestamptz default null)
returns numeric
language sql
stable security definer
set search_path = public
as $$
  select coalesce(
    (select o.nuevo_valor from otrosis o
      where o.contrato_id = p_contrato_id and o.estado = 'aprobada' and o.nuevo_valor is not null
        and (p_hasta is null or o.aprobado_at <= p_hasta)
      order by o.numero desc limit 1),
    (select c.valor from contratos c where c.id = p_contrato_id))
$$;
revoke all on function public._valor_contrato(uuid, timestamptz) from public, anon, authenticated;

-- El nuevo valor: distinto del vigente y no menor que lo ya cobrado.
create or replace function public._validar_valor_otrosi(p_contrato_id uuid, p_valor numeric)
returns void
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_vigente numeric;
  v_cobrado numeric;
begin
  if p_valor is null then return; end if;
  if p_valor <= 0 or p_valor >= 1e16 then
    raise exception 'El nuevo valor del contrato no es válido.';
  end if;
  if p_valor <> round(p_valor, 2) then
    raise exception 'El nuevo valor del contrato tiene más de dos decimales.';
  end if;
  v_vigente := public._valor_contrato(p_contrato_id);
  if p_valor = v_vigente then
    raise exception 'El nuevo valor es igual al vigente (%).', public._pesos_texto(v_vigente);
  end if;
  select coalesce(sum(a.valor_bruto), 0) into v_cobrado
    from actas a where a.contrato_id = p_contrato_id and a.estado <> 'rechazada';
  if p_valor < v_cobrado then
    raise exception 'El nuevo valor (%) es menor que lo ya cobrado en actas (%).',
      public._pesos_texto(p_valor), public._pesos_texto(v_cobrado);
  end if;
end;
$$;
revoke all on function public._validar_valor_otrosi(uuid, numeric) from public, anon, authenticated;

-- crear / reenviar con la prórroga y el nuevo valor (parámetros al final, opcionales).
drop function if exists public.crear_otrosi(uuid, jsonb, text);
drop function if exists public.reenviar_otrosi(uuid, jsonb, text);
drop function if exists public.crear_otrosi(uuid, jsonb, text, date);
drop function if exists public.reenviar_otrosi(uuid, jsonb, text, date);

create or replace function public.crear_otrosi(p_contrato_id uuid, p_modificaciones jsonb, p_justificacion text, p_nueva_fecha_fin date default null, p_nuevo_valor numeric default null)
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
  perform public._validar_valor_otrosi(p_contrato_id, p_nuevo_valor);

  insert into otrosis (contrato_id, proyecto_id, modificaciones, justificacion, solicitado_por, nueva_fecha_fin, nuevo_valor)
  values (p_contrato_id, v_proyecto, v_mods, v_just, auth.uid(), p_nueva_fecha_fin, p_nuevo_valor)
  returning id into v_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('otrosi', v_id, 'creado', auth.uid(), jsonb_build_object('contrato', v_contrato, 'nueva_fecha_fin', p_nueva_fecha_fin, 'nuevo_valor', p_nuevo_valor));

  perform public._notificar_juridica_otrosi(v_id, 'Otrosí por revisar',
    'Solicitud de otrosí al contrato ' || v_contrato || ' por revisar.');
  return v_id;
end;
$$;
revoke all on function public.crear_otrosi(uuid, jsonb, text, date, numeric) from public, anon;
grant execute on function public.crear_otrosi(uuid, jsonb, text, date, numeric) to authenticated;

create or replace function public.reenviar_otrosi(p_id uuid, p_modificaciones jsonb, p_justificacion text, p_nueva_fecha_fin date default null, p_nuevo_valor numeric default null)
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
  perform public._validar_valor_otrosi(o.contrato_id, p_nuevo_valor);

  -- Si Jurídica ya había guardado el documento, sus cláusulas salen otra vez
  -- de lo que corrigió el ingeniero (lo demás que editó se conserva).
  update otrosis
     set modificaciones = v_mods, justificacion = v_just, estado = 'por_revisar', enviado_at = now(),
         nueva_fecha_fin = p_nueva_fecha_fin, nuevo_valor = p_nuevo_valor,
         minuta_datos = minuta_datos - 'modificaciones'
   where id = p_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id)
  values ('otrosi', p_id, 'reenviado', auth.uid());

  perform public._notificar_juridica_otrosi(p_id, 'Otrosí corregido',
    'Solicitud de otrosí al contrato ' || v_contrato || ' corregida y por revisar.');
end;
$$;
revoke all on function public.reenviar_otrosi(uuid, jsonb, text, date, numeric) from public, anon;
grant execute on function public.reenviar_otrosi(uuid, jsonb, text, date, numeric) to authenticated;

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
    perform public._validar_valor_otrosi(o.contrato_id, o.nuevo_valor);
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
    perform public._validar_valor_otrosi(o.contrato_id, o.nuevo_valor);
    select coalesce(max(numero), 0) + 1 into v_numero from otrosis where contrato_id = o.contrato_id;
    update otrosis
       set estado = 'aprobada', numero = v_numero, aprobado_at = now(), aprobado_por = v_uid,
           motivo = null
     where id = p_id;
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('otrosi', p_id, 'aprobado', v_uid, jsonb_build_object('numero', v_numero, 'contrato', v_contrato, 'nueva_fecha_fin', o.nueva_fecha_fin, 'nuevo_valor', o.nuevo_valor));
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
             'anexo_tipo', x.anexo_tipo,
             'proyecto_codigo', x.proyecto_codigo, 'proyecto_nombre', x.proyecto_nombre,
             'contratista_id', x.contratista_id, 'contratista_nombre', x.contratista_nombre,
             'contratista_documento', x.contratista_documento,
             'otrosis_aprobados', x.aprobados, 'otrosis_en_tramite', x.en_tramite
           ) order by x.contratista_nombre, x.numero)
      from (
        select c.id, c.numero, c.numero_contrato, c.tipo, c.clase, c.tipo_detalle, c.objeto, c.anexo_tipo,
               -- Valor vigente: el del último otrosí aprobado que lo cambió, o el inicial.
               public._valor_contrato(c.id) as valor,
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
    'tipo_detalle', c.tipo_detalle, 'objeto', c.objeto, 'valor', public._valor_contrato(c.id), 'nuevo_valor', o.nuevo_valor,
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
             'clausulas', (select string_agg(e->>'clausula', ' · ') from jsonb_array_elements(o.modificaciones) e),
             'solicitado_por_nombre', sp.nombre, 'created_at', o.created_at, 'aprobado_at', o.aprobado_at
           ) order by o.numero nulls last, o.created_at)
      from otrosis o
      left join perfiles sp on sp.id = o.solicitado_por
     where o.contrato_id = p_contrato_id
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- actas con el valor vigente
-- Copias de las últimas versiones (20261112000000, 20261112200000,
-- 20261113000000) con el valor vigente. Mismos permisos (create or replace).

create or replace function public.contrato_para_acta(p_contrato_id uuid, p_excluir_acta uuid default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v record;
  v_fin date;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_ret numeric;
  v_valor numeric;
begin
  select c.* into v from contratos c where c.id = p_contrato_id;
  if not found or not public.puede_ver_actas(v.proyecto_id) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  v_fin := public._fecha_fin_contrato(p_contrato_id);
  v_ret := public._retencion_porcentaje_contrato(p_contrato_id);
  v_valor := public._valor_contrato(p_contrato_id);

  return jsonb_build_object(
    -- Tope de las actas: el valor vigente (otrosí aprobado). El anticipo es % del inicial.
    'valor', v_valor,
    'valor_inicial', v.valor,
    'anexo_tipo', v.anexo_tipo,
    'anticipo_porcentaje', case when v.tiene_anticipo then v.anticipo_porcentaje end,
    'retencion_porcentaje', v_ret,
    'fecha_fin', v_fin,
    'vencido', v_fin is not null and v_fin < v_hoy,
    'liquidado', v.liquidado_at is not null,
    'listo_para_actas', v.estado = 'aprobada' and v.minuta_estado = 'aprobada',
    -- Ya hay un acta final (por aprobar o aprobada) distinta de la que se edita.
    'tiene_final', exists (select 1 from actas a where a.contrato_id = v.id and a.tipo = 'final'
                             and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    'tiene_liquidacion', exists (select 1 from actas a where a.contrato_id = v.id and a.tipo = 'liquidacion'
                                   and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    'actas_por_aprobar', (select count(*) from actas a where a.contrato_id = v.id and a.estado = 'pendiente'
                            and a.tipo <> 'liquidacion' and a.id is distinct from p_excluir_acta),
    'bruto_otras', (select coalesce(sum(a.valor_bruto), 0) from actas a where a.contrato_id = v.id
                      and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    -- Valor global: si el valor cambió, lo cobrado como % del valor vigente.
    'avance_otras', (select case when v_valor = v.valor then coalesce(sum(a.porcentaje_avance), 0)
                                 else coalesce(round(sum(a.valor_bruto) * 100 / nullif(v_valor, 0), 4), 0) end
                       from actas a where a.contrato_id = v.id
                       and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    'amortizado_otras', (select coalesce(sum(a.amortizacion), 0) from actas a where a.contrato_id = v.id
                           and a.tipo <> 'liquidacion' and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    -- Para la liquidación: solo lo APROBADO.
    'amortizado_aprobado', (select coalesce(sum(a.amortizacion), 0) from actas a where a.contrato_id = v.id
                              and a.tipo <> 'liquidacion' and a.estado = 'aprobada'),
    'retenido_aprobado', (select coalesce(sum(a.retencion), 0) from actas a where a.contrato_id = v.id
                            and a.tipo <> 'liquidacion' and a.estado = 'aprobada'),
    'actividades', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'orden', i.orden, 'actividad', i.actividad, 'unidad', i.unidad,
               'cantidad', i.cantidad, 'valor_unitario', i.valor_unitario,
               'acumulado', coalesce((
                 select sum(x.cantidad) from acta_actividades x join actas a on a.id = x.acta_id
                 where x.contrato_anexo_item_id = i.id and a.estado <> 'rechazada'
                   and a.id is distinct from p_excluir_acta), 0)
             ) order by i.orden, i.id)
      from contrato_anexo_items i where i.contrato_id = v.id), '[]'::jsonb)
  );
end;
$function$;

create or replace function public._guardar_acta(p_acta_id uuid, p_contrato_id uuid, p_datos jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c record;
  v_info jsonb;
  v_tipo text := coalesce(p_datos->>'tipo', 'parcial');
  v_desde date;
  v_hasta date;
  v_bruto numeric := 0;
  v_avance numeric;
  v_amort numeric := 0;
  v_ret numeric := 0;
  v_dev numeric := 0;
  v_otros numeric := 0;
  v_anticipo_pct numeric;
  v_ret_pct numeric;
  v_anticipo_total numeric := 0;
  v_orden integer := 0;
  v_item record;
  v_cant numeric;
  v_valor numeric;
  v_valor_vig numeric;
  d jsonb;
begin
  select * into c from contratos where id = p_contrato_id;
  v_info := public.contrato_para_acta(p_contrato_id, p_acta_id);
  -- Tope: el valor vigente (otrosí aprobado); el anticipo sigue con c.valor.
  v_valor_vig := (v_info->>'valor')::numeric;

  if v_tipo not in ('parcial', 'final', 'liquidacion') then
    raise exception 'Tipo de acta no válido.';
  end if;
  if not (v_info->>'listo_para_actas')::boolean then
    raise exception 'Solo se hacen actas de contratos con la minuta aprobada por Subgerencia.';
  end if;
  if (v_info->>'liquidado')::boolean then
    raise exception 'El contrato ya está liquidado: no recibe más actas.';
  end if;

  begin
    v_desde := nullif(p_datos->>'periodo_desde', '')::date;
    v_hasta := nullif(p_datos->>'periodo_hasta', '')::date;
  exception when others then
    raise exception 'Las fechas del período no son válidas.';
  end;
  if v_desde is not null and v_hasta is not null and v_hasta < v_desde then
    raise exception 'El período termina antes de empezar.';
  end if;

  v_anticipo_pct := nullif(v_info->>'anticipo_porcentaje', '')::numeric;
  v_ret_pct := nullif(v_info->>'retencion_porcentaje', '')::numeric;
  if v_anticipo_pct is not null then
    v_anticipo_total := round(c.valor * v_anticipo_pct / 100, 2);
  end if;

  if v_tipo = 'liquidacion' then
    if (v_info->>'tiene_liquidacion')::boolean then
      raise exception 'Este contrato ya tiene un acta de liquidación.';
    end if;
    if (v_info->>'actas_por_aprobar')::int > 0 then
      raise exception 'Hay actas por aprobar: apruébalas o recházalas antes de liquidar.';
    end if;
    -- Devuelve la retención y descuenta el anticipo que falte por amortizar.
    v_dev := (v_info->>'retenido_aprobado')::numeric;
    v_amort := greatest(v_anticipo_total - (v_info->>'amortizado_aprobado')::numeric, 0);
  else
    if (v_info->>'vencido')::boolean then
      raise exception 'El contrato venció el %: no recibe actas de avance (solo la de liquidación).',
        to_char((v_info->>'fecha_fin')::date, 'DD/MM/YYYY');
    end if;
    if (v_info->>'tiene_final')::boolean then
      raise exception 'El contrato ya tiene acta final: no recibe más actas de avance (sigue la de liquidación).';
    end if;

    if c.anexo_tipo = 'valores_unitarios' then
      if jsonb_typeof(coalesce(p_datos->'actividades', 'null')) is distinct from 'array' then
        raise exception 'Escribe la cantidad ejecutada de al menos una actividad.';
      end if;
      if (select count(distinct e->>'anexo_item_id') from jsonb_array_elements(p_datos->'actividades') e)
         <> jsonb_array_length(p_datos->'actividades') then
        raise exception 'Hay una actividad repetida.';
      end if;
      for d in select * from jsonb_array_elements(p_datos->'actividades') loop
        begin
          v_cant := (d->>'cantidad')::numeric;
        exception when others then
          raise exception 'Una cantidad no es un número.';
        end;
        continue when v_cant is null or v_cant = 0;
        if v_cant < 0 then
          raise exception 'Las cantidades no pueden ser negativas.';
        end if;
        select i.id, i.orden, i.actividad, i.unidad, i.cantidad, i.valor_unitario into v_item
          from contrato_anexo_items i
         where i.id = (d->>'anexo_item_id')::uuid and i.contrato_id = p_contrato_id;
        if not found then
          raise exception 'Una actividad no es de este contrato.';
        end if;
        -- Acumulado de la actividad en las demás actas no rechazadas (índice por actividad).
        if (select coalesce(sum(x.cantidad), 0) from acta_actividades x join actas o on o.id = x.acta_id
             where x.contrato_anexo_item_id = v_item.id and o.estado <> 'rechazada' and o.id <> p_acta_id)
           + v_cant > v_item.cantidad then
          raise exception 'La actividad "%" pasa de la cantidad contratada (% %).',
            v_item.actividad, trim(to_char(v_item.cantidad, 'FM999999999990.####')), v_item.unidad;
        end if;
        v_orden := v_orden + 1;
        v_valor := round(v_cant * v_item.valor_unitario, 2);
        v_bruto := v_bruto + v_valor;
        insert into acta_actividades (acta_id, contrato_anexo_item_id, orden, actividad, unidad, cantidad, valor_unitario, valor)
        values (p_acta_id, v_item.id, v_item.orden, v_item.actividad, v_item.unidad, v_cant, v_item.valor_unitario, v_valor);
      end loop;
      if v_orden = 0 then
        raise exception 'Escribe la cantidad ejecutada de al menos una actividad.';
      end if;
    else
      -- Valor global: % de avance de esta acta.
      begin
        v_avance := (p_datos->>'porcentaje_avance')::numeric;
      exception when others then
        raise exception 'El porcentaje de avance no es un número.';
      end;
      if v_avance is null or v_avance <= 0 then
        raise exception 'Escribe el porcentaje de avance de esta acta.';
      end if;
      if (v_info->>'avance_otras')::numeric + v_avance > 100 then
        raise exception 'El avance acumulado pasaría del 100 %% (ya va en % %%).',
          trim(to_char((v_info->>'avance_otras')::numeric, 'FM990.##'));
      end if;
      v_bruto := round(v_valor_vig * v_avance / 100, 2);
    end if;

    if v_bruto > v_valor_vig - (v_info->>'bruto_otras')::numeric then
      raise exception 'El acta suma % y el saldo del contrato es %. Las actas no pueden superar el valor del contrato.',
        public._pesos_texto(v_bruto), public._pesos_texto(greatest(v_valor_vig - (v_info->>'bruto_otras')::numeric, 0));
    end if;

    -- Amortización: % del anticipo sobre el bruto, sin pasar de lo que falte;
    -- la final amortiza todo lo que falte (sin pasar del bruto).
    if v_anticipo_total > 0 then
      v_amort := least(
        case when v_tipo = 'final' then v_anticipo_total else round(v_bruto * v_anticipo_pct / 100, 2) end,
        greatest(v_anticipo_total - (v_info->>'amortizado_otras')::numeric, 0),
        v_bruto);
    end if;
    if v_ret_pct is not null then
      v_ret := round(v_bruto * v_ret_pct / 100, 2);
    end if;
  end if;

  -- Otros descuentos (retefuente, ICA...).
  v_orden := 0;
  if jsonb_typeof(coalesce(p_datos->'descuentos', '[]')) = 'array' then
    for d in select * from jsonb_array_elements(coalesce(p_datos->'descuentos', '[]')) loop
      continue when nullif(trim(coalesce(d->>'concepto', '')), '') is null and coalesce((d->>'valor')::numeric, 0) = 0;
      if nullif(trim(coalesce(d->>'concepto', '')), '') is null then
        raise exception 'Escribe el concepto de cada descuento.';
      end if;
      begin
        v_valor := round((d->>'valor')::numeric, 2);
      exception when others then
        raise exception 'El valor del descuento "%" no es un número.', d->>'concepto';
      end;
      if v_valor is null or v_valor <= 0 then
        raise exception 'El descuento "%" debe ser mayor que cero.', d->>'concepto';
      end if;
      v_orden := v_orden + 1;
      v_otros := v_otros + v_valor;
      insert into acta_descuentos (acta_id, orden, concepto, valor) values (p_acta_id, v_orden, trim(d->>'concepto'), v_valor);
    end loop;
  end if;

  if v_tipo <> 'liquidacion' and v_bruto - v_amort - v_ret - v_otros < 0 then
    raise exception 'Los descuentos (%) pasan del valor del acta (%).',
      public._pesos_texto(v_amort + v_ret + v_otros), public._pesos_texto(v_bruto);
  end if;

  update actas set
    tipo = v_tipo,
    periodo_desde = v_desde,
    periodo_hasta = v_hasta,
    observaciones = nullif(trim(coalesce(p_datos->>'observaciones', '')), ''),
    porcentaje_avance = case when v_tipo <> 'liquidacion' and c.anexo_tipo <> 'valores_unitarios' then v_avance end,
    valor_bruto = v_bruto,
    total = v_bruto,
    amortizacion = v_amort,
    retencion = v_ret,
    devolucion_retencion = v_dev,
    otros_descuentos = v_otros,
    neto = v_bruto + v_dev - v_amort - v_ret - v_otros,
    anticipo_porcentaje = v_anticipo_pct,
    retencion_porcentaje = v_ret_pct
  where id = p_acta_id;
end;
$function$;

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
      where i.contrato_id = v.contrato_id), '[]'::jsonb),
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

create or replace function public.listar_actas_aprobacion(p_estado text default null, p_proyecto_id uuid default null)
 returns table(acta_id uuid, numero integer, tipo text, estado text, valor_bruto numeric, neto numeric, created_at timestamptz,
               creado_por_nombre text, contrato_id uuid, numero_contrato text, contrato_valor numeric,
               proyecto_codigo text, proyecto_nombre text, contratista_nombre text,
               resuelto_por_nombre text, resuelto_at timestamptz)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if not public.tiene_pestana(auth.uid(), 'contratos.aprobar_actas') then
    raise exception 'No tienes permiso para ver la aprobación de actas.';
  end if;
  return query
  select a.id, a.numero, a.tipo, a.estado, a.valor_bruto, a.neto, a.created_at, pc.nombre,
         c.id, c.numero_contrato, public._valor_contrato(c.id), p.codigo, p.nombre, k.nombre,
         pr.nombre, a.resuelto_at
  from actas a
  join contratos c on c.id = a.contrato_id
  join proyectos p on p.id = c.proyecto_id
  join contratistas k on k.id = c.contratista_id
  left join perfiles pc on pc.id = a.creado_por
  left join perfiles pr on pr.id = a.resuelto_por
  where public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
    and (p_estado is null or a.estado = p_estado)
    and (p_proyecto_id is null or c.proyecto_id = p_proyecto_id)
  order by a.created_at, a.id
  limit 1000;
end;
$function$;

create or replace function public.buscar_contratos_para_acta(p_texto text default null, p_contratista_id uuid default null)
returns table(contrato_id uuid, numero_contrato text, numero bigint, tipo text, objeto text, valor numeric,
              proyecto_codigo text, proyecto_nombre text, contratista_id uuid, contratista_nombre text,
              contratista_documento text, actas integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
begin
  if not public.tiene_pestana(auth.uid(), 'contratos.cortes') then
    raise exception 'No tienes permiso para ver actas.';
  end if;
  if p_contratista_id is null and v_texto is null then
    return;
  end if;

  return query
  select c.id, c.numero_contrato, c.numero, c.tipo, c.objeto, public._valor_contrato(c.id),
         p.codigo, p.nombre, k.id, k.nombre,
         k.tipo_documento || ' ' || k.numero_documento || coalesce('-' || k.digito_verificacion, ''),
         (select count(*)::int from actas a where a.contrato_id = c.id)
  from contratos c
  join contratistas k on k.id = c.contratista_id
  join proyectos p on p.id = c.proyecto_id
  where c.estado = 'aprobada' and c.minuta_estado = 'aprobada' and c.clase = 'grupo'
    and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
    and (p_contratista_id is null or c.contratista_id = p_contratista_id)
    and (
      v_texto is null or v_texto = '_'
      or c.numero_contrato ilike '%' || v_texto || '%'
      or c.objeto ilike '%' || v_texto || '%'
      or k.nombre ilike '%' || v_texto || '%'
      or k.numero_documento ilike '%' || v_texto || '%'
    )
  order by c.numero desc
  limit 50;
end;
$$;
