-- ---------------------------------------------------------------------------
-- Otrosí de contratos (2026-10-20). Decisiones del usuario:
--   * Dos pantallas: Solicitud de otrosí (el ingeniero escoge el contratista,
--     ve sus contratos abiertos y pide el otrosí) y Aprobación de otrosí.
--   * Solo documento: el otrosí NO cambia el plazo ni el valor del contrato en
--     el sistema; lo que cambia (cantidades, valor, plazo) va en la redacción
--     de la cláusula nueva.
--   * No se puede hacer otrosí si el plazo inicial del contrato ya pasó
--     (_fecha_fin_contrato < hoy): se revisa al crear, al reenviar, al enviar
--     a Subgerencia y al aprobar.
--   * Jurídica revisa y arma el documento (o devuelve / rechaza); Subgerencia
--     lo aprueba o se lo devuelve a Jurídica. Al aprobar recibe su número
--     (Otrosí N° 1, 2... de cada contrato).
-- Todo pasa por funciones SECURITY DEFINER: el ingeniero puede no tener las
-- pestañas que dejan leer `contratos`.
-- Acciones: solicitar = solicitar_contratos; Jurídica = aprobar_contratos;
-- Subgerencia = aprobar_minutas (las mismas de los contratos).
-- ---------------------------------------------------------------------------

create table if not exists public.otrosis (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id),
  proyecto_id uuid not null references public.proyectos(id),
  numero integer,
  estado text not null default 'por_revisar'
    check (estado in ('por_revisar', 'devuelta', 'rechazada', 'en_revision', 'devuelta_subgerencia', 'aprobada')),
  -- [{clausula, redaccion}]: qué cláusula se modifica y cómo queda.
  modificaciones jsonb not null,
  justificacion text not null,
  solicitado_por uuid references public.perfiles(id),
  created_at timestamptz not null default now(),
  enviado_at timestamptz not null default now(),
  -- Última devolución / rechazo (de Jurídica o de Subgerencia).
  motivo text,
  resuelto_por uuid references public.perfiles(id),
  resuelto_at timestamptz,
  minuta_datos jsonb,
  minuta_actualizada_at timestamptz,
  minuta_actualizada_por uuid references public.perfiles(id),
  enviada_subgerencia_at timestamptz,
  enviada_subgerencia_por uuid references public.perfiles(id),
  aprobado_at timestamptz,
  aprobado_por uuid references public.perfiles(id),
  constraint otrosis_numero_unico unique (contrato_id, numero),
  constraint otrosis_numero_aprobada check ((numero is not null) = (estado = 'aprobada'))
);
create index if not exists idx_otrosis_contrato on public.otrosis (contrato_id);
create index if not exists idx_otrosis_proyecto_estado on public.otrosis (proyecto_id, estado);
create index if not exists idx_otrosis_solicitado_por on public.otrosis (solicitado_por);

alter table public.otrosis enable row level security;
drop policy if exists otrosis_select on public.otrosis;
create policy otrosis_select on public.otrosis for select to authenticated
  using (
    (
      (select public.tiene_pestana((select auth.uid()), 'contratos.solicitar_otrosi'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_otrosi'))
    )
    and proyecto_id in (select public.proyectos_visibles((select auth.uid())))
  );
revoke insert, update, delete on public.otrosis from anon, authenticated;

-- Historial y notificaciones aceptan el otrosí.
alter table public.historial_eventos drop constraint if exists historial_eventos_entidad_tipo_check;
alter table public.historial_eventos add constraint historial_eventos_entidad_tipo_check
  check (entidad_tipo = any (array[
    'orden_compra', 'pedido', 'requisicion', 'contrato', 'acta', 'pago', 'proveedor', 'contratista', 'entrada',
    'salida', 'solicitud_insumo', 'solicitud_mano_obra', 'solicitud_equipo', 'presupuesto', 'rol', 'usuario', 'otrosi'
  ]));

alter table public.notificaciones drop constraint if exists notificaciones_entidad_tipo_check;
alter table public.notificaciones add constraint notificaciones_entidad_tipo_check
  check (entidad_tipo = any (array['pedido_insumo', 'orden_compra', 'requisicion', 'contrato', 'acta', 'presupuesto', 'otrosi'])) not valid;

alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check
  check (tipo = any (array[
    'pedido_rechazado', 'pedido_aprobado', 'orden_compra_rechazada', 'orden_compra_aprobada',
    'insumo_sobre_presupuesto', 'orden_compra_precio_sobre_efectivo',
    'contrato_por_revisar', 'contrato_aprobado', 'contrato_devuelto', 'contrato_rechazado',
    'acta_aprobada', 'acta_rechazada', 'minuta_por_revisar', 'minuta_aprobada', 'minuta_devuelta',
    'contrato_vencido', 'contrato_vencido_juridica', 'insumo_rechazado',
    'otrosi_por_revisar', 'otrosi_por_aprobar', 'otrosi_devuelto', 'otrosi_rechazado', 'otrosi_aprobado',
    'otrosi_devuelto_subgerencia'
  ])) not valid;

-- Las pestañas nuevas, a los roles que ya hacen lo mismo con los contratos.
insert into public.rol_permisos (rol_id, permiso)
select distinct rol_id, 'tab.contratos.solicitar_otrosi' from public.rol_permisos where permiso = 'tab.contratos.solicitar'
on conflict do nothing;
insert into public.rol_permisos (rol_id, permiso)
select distinct rol_id, 'tab.contratos.aprobar_otrosi' from public.rol_permisos
 where permiso in ('tab.contratos.preaprobacion', 'tab.contratos.aprobar_minutas')
on conflict do nothing;

-- ---------------------------------------------------------------- ayudas
create or replace function public._puede_ver_otrosis(p_uid uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select public.tiene_pestana(p_uid, 'contratos.solicitar_otrosi') or public.tiene_pestana(p_uid, 'contratos.aprobar_otrosi')
$$;
revoke all on function public._puede_ver_otrosis(uuid) from public, anon, authenticated;

-- El contrato admite otrosí: aprobado (minuta aprobada), sin liquidar y con el
-- plazo inicial sin terminar (sin fecha fin, p. ej. duración sin inicio, no vence).
-- Devuelve el número del contrato (CJ-...). Bloquea la fila del contrato.
create or replace function public._exigir_contrato_para_otrosi(p_contrato_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_fin date;
begin
  select id, proyecto_id, estado, minuta_estado, liquidado_at, numero_contrato
    into v from contratos where id = p_contrato_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v.proyecto_id) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  if v.estado <> 'aprobada' or v.minuta_estado is distinct from 'aprobada' then
    raise exception 'Solo se puede hacer otrosí a un contrato aprobado.';
  end if;
  if v.liquidado_at is not null then
    raise exception 'El contrato % ya está liquidado: no admite otrosí.', v.numero_contrato;
  end if;
  v_fin := public._fecha_fin_contrato(p_contrato_id);
  if v_fin is not null and v_fin < (now() at time zone 'America/Bogota')::date then
    raise exception 'El plazo del contrato % terminó el %: ya no se puede hacer otrosí.',
      v.numero_contrato, to_char(v_fin, 'DD/MM/YYYY');
  end if;
  return v.numero_contrato;
end;
$$;
revoke all on function public._exigir_contrato_para_otrosi(uuid) from public, anon, authenticated;

-- Modificaciones: 1 a 20, cada una con cláusula y redacción.
create or replace function public._normalizar_modificaciones_otrosi(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  e jsonb;
  v_clausula text;
  v_redaccion text;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 then
    raise exception 'Agrega al menos una cláusula a modificar.';
  end if;
  if jsonb_array_length(p) > 20 then
    raise exception 'Máximo 20 cláusulas por otrosí.';
  end if;
  for e in select * from jsonb_array_elements(p) loop
    v_clausula := trim(coalesce(e->>'clausula', ''));
    v_redaccion := trim(coalesce(e->>'redaccion', ''));
    if v_clausula = '' then raise exception 'Indica qué cláusula se modifica.'; end if;
    if v_redaccion = '' then raise exception 'Escribe cómo queda la cláusula %.', v_clausula; end if;
    if length(v_clausula) > 200 then raise exception 'El nombre de la cláusula es muy largo (máximo 200 caracteres).'; end if;
    if length(v_redaccion) > 20000 then raise exception 'La redacción de la cláusula % es muy larga.', v_clausula; end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('clausula', v_clausula, 'redaccion', v_redaccion));
  end loop;
  return v_out;
end;
$$;
revoke all on function public._normalizar_modificaciones_otrosi(jsonb) from public, anon, authenticated;

-- Aviso a Jurídica (Legal y Líder Legal con aprobar_contratos que vean el
-- proyecto, como las solicitudes de contrato).
create or replace function public._notificar_juridica_otrosi(p_otrosi_id uuid, p_titulo text, p_mensaje text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  select pf.id, 'otrosi_por_revisar', 'otrosi', o.id, p_titulo, p_mensaje
  from otrosis o
  cross join perfiles pf
  join roles r on r.id = pf.rol_id
  where o.id = p_otrosi_id
    and r.clave in ('legal', 'lider_legal')
    and pf.id is distinct from auth.uid()
    and public.tiene_accion(pf.id, 'aprobar_contratos')
    and public.usuario_puede_ver_proyecto(pf.id, o.proyecto_id)
$$;
revoke all on function public._notificar_juridica_otrosi(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- contratos abiertos
-- Contratos a los que se les puede pedir otrosí, de los proyectos que el
-- usuario ve (un jsonb: no se corta en 1000 filas).
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
               case
                 when c.plazo_tipo = 'fechas' then c.fecha_fin
                 when c.plazo_tipo = 'duracion' and c.fecha_inicio is not null and c.duracion_cantidad is not null then
                   (c.fecha_inicio + case when c.duracion_unidad = 'meses'
                                          then make_interval(months => c.duracion_cantidad)
                                          else make_interval(days => c.duracion_cantidad) end)::date
               end as fin,
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
revoke all on function public.contratos_para_otrosi() from public, anon;
grant execute on function public.contratos_para_otrosi() to authenticated;

-- ---------------------------------------------------------------- crear / reenviar
create or replace function public.crear_otrosi(p_contrato_id uuid, p_modificaciones jsonb, p_justificacion text)
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

  insert into otrosis (contrato_id, proyecto_id, modificaciones, justificacion, solicitado_por)
  values (p_contrato_id, v_proyecto, v_mods, v_just, auth.uid())
  returning id into v_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('otrosi', v_id, 'creado', auth.uid(), jsonb_build_object('contrato', v_contrato));

  perform public._notificar_juridica_otrosi(v_id, 'Otrosí por revisar',
    'Solicitud de otrosí al contrato ' || v_contrato || ' por revisar.');
  return v_id;
end;
$$;
revoke all on function public.crear_otrosi(uuid, jsonb, text) from public, anon;
grant execute on function public.crear_otrosi(uuid, jsonb, text) to authenticated;

-- Devuelto por Jurídica: el ingeniero lo corrige y lo manda otra vez.
create or replace function public.reenviar_otrosi(p_id uuid, p_modificaciones jsonb, p_justificacion text)
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

  -- Si Jurídica ya había guardado el documento, sus cláusulas salen otra vez
  -- de lo que corrigió el ingeniero (lo demás que editó se conserva).
  update otrosis
     set modificaciones = v_mods, justificacion = v_just, estado = 'por_revisar', enviado_at = now(),
         minuta_datos = minuta_datos - 'modificaciones'
   where id = p_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id)
  values ('otrosi', p_id, 'reenviado', auth.uid());

  perform public._notificar_juridica_otrosi(p_id, 'Otrosí corregido',
    'Solicitud de otrosí al contrato ' || v_contrato || ' corregida y por revisar.');
end;
$$;
revoke all on function public.reenviar_otrosi(uuid, jsonb, text) from public, anon;
grant execute on function public.reenviar_otrosi(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------- documento (Jurídica)
create or replace function public.guardar_minuta_otrosi(p_id uuid, p_datos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_contratos') then
    raise exception 'No tienes permiso para editar el otrosí.';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Documento no válido.';
  end if;
  if length(p_datos::text) > 200000 then
    raise exception 'El documento es muy grande.';
  end if;
  select id, proyecto_id, estado into o from otrosis where id = p_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), o.proyecto_id) then
    raise exception 'El otrosí no existe o no tienes acceso.';
  end if;
  if o.estado not in ('por_revisar', 'devuelta_subgerencia') then
    raise exception 'Este otrosí ya no se puede editar (actualiza la página).';
  end if;
  update otrosis
     set minuta_datos = p_datos, minuta_actualizada_at = now(), minuta_actualizada_por = auth.uid()
   where id = p_id;
end;
$$;
revoke all on function public.guardar_minuta_otrosi(uuid, jsonb) from public, anon;
grant execute on function public.guardar_minuta_otrosi(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- resolver
-- Jurídica (aprobar_contratos): 'enviar' a Subgerencia con el documento
-- completo (p_minuta), 'devolver' al ingeniero o 'rechazar'.
-- Subgerencia (aprobar_minutas): 'aprobar' o 'devolver_juridica'.
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
    select coalesce(max(numero), 0) + 1 into v_numero from otrosis where contrato_id = o.contrato_id;
    update otrosis
       set estado = 'aprobada', numero = v_numero, aprobado_at = now(), aprobado_por = v_uid,
           motivo = null
     where id = p_id;
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('otrosi', p_id, 'aprobado', v_uid, jsonb_build_object('numero', v_numero, 'contrato', v_contrato));
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    select distinct u, 'otrosi_aprobado', 'otrosi', p_id, 'Otrosí aprobado',
           'Otrosí N° ' || v_numero || ' al contrato ' || v_contrato || ' aprobado por Subgerencia.'
      from unnest(array[o.solicitado_por, o.enviada_subgerencia_por]) u
     where u is not null and u is distinct from v_uid;
  end if;
end;
$$;
revoke all on function public.resolver_otrosi(uuid, text, text, jsonb) from public, anon;
grant execute on function public.resolver_otrosi(uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- leer
-- Fila de la lista (y base del detalle).
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
    'n_modificaciones', jsonb_array_length(o.modificaciones),
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
revoke all on function public._fila_otrosi(uuid) from public, anon, authenticated;

-- p_estados: null = todos. p_solo_enviados: solo los que ya llegaron alguna
-- vez a Subgerencia (su filtro "Todas").
create or replace function public.listar_otrosis(p_estados text[] default null, p_proyecto_id uuid default null, p_solo_enviados boolean default false)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public._puede_ver_otrosis(v_uid) then
    raise exception 'No tienes permiso para ver otrosí.';
  end if;
  return coalesce((
    select jsonb_agg(public._fila_otrosi(o.id) order by o.enviado_at desc, o.id)
      from otrosis o
     where o.proyecto_id in (select public.proyectos_visibles(v_uid))
       and (p_estados is null or o.estado = any (p_estados))
       and (p_proyecto_id is null or o.proyecto_id = p_proyecto_id)
       and (not p_solo_enviados or o.enviada_subgerencia_at is not null)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.listar_otrosis(text[], uuid, boolean) from public, anon;
grant execute on function public.listar_otrosis(text[], uuid, boolean) to authenticated;

-- Todo lo que necesitan el detalle y el documento: el otrosí, su contrato,
-- las partes (contratista del directorio, empresa del proyecto) y la minuta
-- aprobada del contrato (de ahí salen el representante de la empresa y la
-- ciudad cuando ya estaban escritos).
create or replace function public.detalle_otrosi(p_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_res jsonb;
begin
  if not public._puede_ver_otrosis(v_uid) then
    raise exception 'No tienes permiso para ver otrosí.';
  end if;
  select public._fila_otrosi(o.id) || jsonb_build_object(
           'modificaciones', o.modificaciones, 'justificacion', o.justificacion, 'motivo', o.motivo,
           'resuelto_por_nombre', rp.nombre, 'resuelto_at', o.resuelto_at,
           'aprobado_por_nombre', ap.nombre,
           'minuta_datos', o.minuta_datos, 'minuta_actualizada_at', o.minuta_actualizada_at,
           'minuta_actualizada_por_nombre', mp.nombre,
           'numero_provisional', coalesce(o.numero,
              (select coalesce(max(o2.numero), 0) + 1 from otrosis o2 where o2.contrato_id = o.contrato_id)),
           'fecha_fin', public._fecha_fin_contrato(o.contrato_id),
           'plazo_tipo', c.plazo_tipo, 'fecha_inicio', c.fecha_inicio,
           'duracion_cantidad', c.duracion_cantidad, 'duracion_unidad', c.duracion_unidad,
           'contrato_minuta', c.minuta_datos, 'proyecto_ciudad', p.ciudad,
           'empresa_nombre', e.razon_social, 'empresa_nit', e.nit,
           'contratista', jsonb_build_object(
             'tipo_persona', k.tipo_persona, 'tipo_documento', k.tipo_documento,
             'numero_documento', k.numero_documento, 'digito_verificacion', k.digito_verificacion,
             'representante_nombre', k.representante_nombre,
             'representante_tipo_documento', k.representante_tipo_documento,
             'representante_numero_documento', k.representante_numero_documento,
             'cedula_expedida_en', k.cedula_expedida_en, 'ciudad', k.ciudad)
         )
    into v_res
    from otrosis o
    join contratos c on c.id = o.contrato_id
    join proyectos p on p.id = o.proyecto_id
    left join empresas e on e.id = p.empresa_id
    join contratistas k on k.id = c.contratista_id
    left join perfiles rp on rp.id = o.resuelto_por
    left join perfiles ap on ap.id = o.aprobado_por
    left join perfiles mp on mp.id = o.minuta_actualizada_por
   where o.id = p_id
     and o.proyecto_id in (select public.proyectos_visibles(v_uid));
  if v_res is null then
    raise exception 'El otrosí no existe o no tienes acceso.';
  end if;
  return v_res;
end;
$$;
revoke all on function public.detalle_otrosi(uuid) from public, anon;
grant execute on function public.detalle_otrosi(uuid) to authenticated;

-- Historial del otrosí (mismo formato que historial_entidad).
create or replace function public.historial_otrosi(p_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public._puede_ver_otrosis(v_uid)
     or not exists (select 1 from otrosis where id = p_id and proyecto_id in (select public.proyectos_visibles(v_uid))) then
    raise exception 'No tienes permiso para ver este historial.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre, 'usuario_rol', r.nombre,
             'motivo', h.motivo, 'datos', h.datos, 'created_at', h.created_at
           ) order by h.created_at, h.id)
      from historial_eventos h
      left join perfiles pf on pf.id = h.usuario_id
      left join roles r on r.id = pf.rol_id
     where h.entidad_tipo = 'otrosi' and h.entidad_id = p_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.historial_otrosi(uuid) from public, anon;
grant execute on function public.historial_otrosi(uuid) to authenticated;
