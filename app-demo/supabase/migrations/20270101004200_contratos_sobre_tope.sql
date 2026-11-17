-- Contratos por encima del tope con autorización de Gerencia (decisión del
-- usuario, 2026-11-17).
--
-- En un contrato de OBRA o de MANO DE OBRA, una actividad cuyo valor unitario
-- pasa el tope (obra: el valor del ítem, a todo costo el % del proyecto; mano
-- de obra: la mano de obra del ítem) ya no se rechaza: la solicitud pide una
-- justificación y queda POR AUTORIZAR. Gerencia (acción nueva
-- autorizar_contratos_sobre_tope, dada a quien aprueba las minutas) la ve en
-- Aprobación de contratos y la autoriza (sigue a Pre-aprobación de Jurídica),
-- la devuelve (vuelve al director para corregir) o la rechaza. Los demás tipos
-- de contrato y el otrosí siguen con el tope de siempre.
--
-- - contratos.estado: 'por_autorizar' (antes de 'pre_aprobacion'). Sigue
--   reservando la cantidad del presupuesto, como pre_aprobacion.
-- - contratos.sobre_tope_justificacion / _autorizado_at / _autorizado_por.
-- - contrato_anexo_items.tope_valor_unitario: el tope de cada actividad cuando
--   se pidió (para ver cuánto se pasa).
-- - _guardar_solicitud_contrato se parcha por texto exacto.
-- - Avisos: contrato_sobre_tope (a Gerencia, también por correo) y
--   contrato_tope_autorizado (a quien lo pidió). Mis pendientes:
--   contrato_sobre_tope.
--
-- Va ANTES del código. Reversa en supabase/reversa/.

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

-- 1. Columnas y estado -----------------------------------------------------------

alter table public.contratos add column if not exists sobre_tope_justificacion text;
alter table public.contratos add column if not exists sobre_tope_autorizado_at timestamptz;
alter table public.contratos add column if not exists sobre_tope_autorizado_por uuid references public.perfiles(id);
create index if not exists idx_contratos_sobre_tope_autorizado_por
  on public.contratos (sobre_tope_autorizado_por) where sobre_tope_autorizado_por is not null;
create index if not exists idx_contratos_por_autorizar
  on public.contratos (proyecto_id) where estado = 'por_autorizar';
comment on column public.contratos.sobre_tope_justificacion is
  'Por qué hay actividades por encima del tope (la lee Gerencia al autorizar).';

alter table public.contrato_anexo_items add column if not exists tope_valor_unitario numeric(18,2);
comment on column public.contrato_anexo_items.tope_valor_unitario is
  'Tope del valor unitario de la actividad cuando se pidió el contrato.';

alter table public.contratos drop constraint if exists contratos_estado_check;
alter table public.contratos add constraint contratos_estado_check
  check (estado in ('por_autorizar', 'pre_aprobacion', 'devuelta', 'rechazada', 'aprobada'));

-- 2. Acción nueva: a los roles que aprueban las minutas (Gerencia) ----------------

insert into public.rol_permisos (rol_id, permiso)
select rp.rol_id, 'accion.autorizar_contratos_sobre_tope'
  from public.rol_permisos rp
 where rp.permiso = 'accion.aprobar_minutas'
on conflict do nothing;

-- 3. Tipos de aviso nuevos (a la lista viva) y el de Gerencia por correo ----------

do $$
declare
  d text;
  t text;
begin
  foreach t in array array['contrato_sobre_tope', 'contrato_tope_autorizado'] loop
    select pg_get_constraintdef(oid) into d from pg_constraint where conname = 'notificaciones_tipo_check';
    if d is not null and position(t in d) = 0 then
      execute 'alter table public.notificaciones drop constraint notificaciones_tipo_check';
      execute 'alter table public.notificaciones add constraint notificaciones_tipo_check '
              || replace(replace(d, ' NOT VALID', ''), 'ARRAY[', 'ARRAY[''' || t || '''::text, ') || ' not valid';
    end if;
  end loop;
end;
$$;
update public.ajustes_correo set tipos = array_append(tipos, 'contrato_sobre_tope')
 where id and not ('contrato_sobre_tope' = any (tipos));

create or replace function public._notificar_autorizadores_tope(p_contrato_id uuid, p_titulo text, p_mensaje text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  select pf.id, 'contrato_sobre_tope', 'contrato', c.id, p_titulo, p_mensaje
    from contratos c
   cross join perfiles pf
    left join roles r on r.id = pf.rol_id
   where c.id = p_contrato_id
     and r.clave is distinct from 'administrador'
     and pf.id is distinct from auth.uid()
     and public.tiene_accion(pf.id, 'autorizar_contratos_sobre_tope')
     and public.usuario_puede_ver_proyecto(pf.id, c.proyecto_id)
$$;
revoke all on function public._notificar_autorizadores_tope(uuid, text, text) from public, anon, authenticated;

-- 4. Guardar la solicitud: sobre el tope = por autorizar ------------------------

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '  v_tope numeric;',
  '  v_tope numeric;
  v_sobre_tope boolean := false;
  v_justificacion text := nullif(trim(coalesce(p_datos->>''sobre_tope_justificacion'', '''')), '''');');

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '      if v_valor_unitario > v_tope then
        if v_tope < v_pi.valor_unitario then',
  '      if v_valor_unitario > v_tope and v_tipo in (''obra'', ''mano_obra'') then
        -- Sobre el tope: lo autoriza Gerencia antes de Pre-aprobación (20270101004200).
        v_sobre_tope := true;
      elsif v_valor_unitario > v_tope then
        if v_tope < v_pi.valor_unitario then');

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '    v_valor := v_suma;',
  '    v_valor := v_suma;
    if v_sobre_tope and v_justificacion is null then
      raise exception ''Hay actividades con valor unitario por encima del tope: escribe la justificación para pedir la autorización de Gerencia.'';
    end if;');

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '      estado = ''pre_aprobacion'',',
  '      estado = case when v_sobre_tope then ''por_autorizar'' else ''pre_aprobacion'' end,
      sobre_tope_justificacion = case when v_sobre_tope then v_justificacion end,
      sobre_tope_autorizado_at = null,
      sobre_tope_autorizado_por = null,');

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '      correo_notificacion, observaciones, domicilio_departamento, datos_tipo
    ) values (',
  '      correo_notificacion, observaciones, domicilio_departamento, datos_tipo,
      estado, sobre_tope_justificacion
    ) values (');

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '      v_departamento, v_datos_tipo
    )',
  '      v_departamento, v_datos_tipo,
      case when v_sobre_tope then ''por_autorizar'' else ''pre_aprobacion'' end, case when v_sobre_tope then v_justificacion end
    )');

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  'valor_unitario, sin_mano_obra)',
  'valor_unitario, sin_mano_obra, tope_valor_unitario)');

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '         v_tipo = ''mano_obra'' and public._valor_mano_obra_item(pi.id) = 0
',
  '         v_tipo = ''mano_obra'' and public._valor_mano_obra_item(pi.id) = 0,
         public._tope_valor_unitario_item(pi.id, v_tipo)
');

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  'jsonb_build_object(''valor'', v_valor));',
  'jsonb_build_object(''valor'', v_valor, ''sobre_tope'', v_sobre_tope));');

-- Un solo reemplazo: cada parche vuelve a crear la función, y con el "if" a
-- medias no compila.
select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '  perform public._notificar_aprobadores_contrato(
    p_id,
    case when p_existente then ''Solicitud de contrato corregida'' else ''Nueva solicitud de contrato'' end,
    ''Solicitud '' || (select codigo from public.contratos where id = p_id) || '' por revisar en pre-aprobación.''
  );',
  '  if v_sobre_tope then
    perform public._notificar_autorizadores_tope(
      p_id,
      ''Contrato por autorizar sobre el tope'',
      ''Solicitud '' || (select codigo from public.contratos where id = p_id) || '' tiene actividades por encima del tope: espera la autorización de Gerencia.''
    );
  else
    perform public._notificar_aprobadores_contrato(
      p_id,
      case when p_existente then ''Solicitud de contrato corregida'' else ''Nueva solicitud de contrato'' end,
      ''Solicitud '' || (select codigo from public.contratos where id = p_id) || '' por revisar en pre-aprobación.''
    );
  end if;');

-- 5. Gerencia resuelve ------------------------------------------------------------

create or replace function public.resolver_autorizacion_tope(p_id uuid, p_accion text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if not public.tiene_accion(auth.uid(), 'autorizar_contratos_sobre_tope') then
    raise exception 'No tienes permiso para autorizar contratos por encima del tope.';
  end if;
  select id, estado, proyecto_id, solicitado_por, codigo into v from contratos where id = p_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v.proyecto_id) then
    raise exception 'La solicitud no existe o no tienes acceso.';
  end if;
  if v.estado <> 'por_autorizar' then
    raise exception 'Esta solicitud ya no está esperando la autorización de Gerencia (actualiza la página).';
  end if;
  if p_accion not in ('autorizar', 'devolver', 'rechazar') then
    raise exception 'Acción no válida.';
  end if;
  if p_accion in ('devolver', 'rechazar') and v_motivo is null then
    raise exception 'Escribe el motivo.';
  end if;

  if p_accion = 'autorizar' then
    update contratos
       set estado = 'pre_aprobacion', sobre_tope_autorizado_at = now(), sobre_tope_autorizado_por = auth.uid()
     where id = p_id;
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo)
    values ('contrato', p_id, 'tope_autorizado', auth.uid(), v_motivo);
    perform public._notificar_aprobadores_contrato(
      p_id, 'Nueva solicitud de contrato',
      'Solicitud ' || v.codigo || ' por revisar en pre-aprobación (Gerencia autorizó valores por encima del tope).');
  else
    update contratos
       set estado = case when p_accion = 'devolver' then 'devuelta' else 'rechazada' end,
           resuelto_por = auth.uid(), resuelto_at = now(), motivo_resolucion = v_motivo
     where id = p_id;
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo)
    values ('contrato', p_id, case when p_accion = 'devolver' then 'tope_devuelto' else 'tope_rechazado' end, auth.uid(), v_motivo);
  end if;

  if v.solicitado_por is not null and v.solicitado_por is distinct from auth.uid() then
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    values (v.solicitado_por,
            case p_accion when 'autorizar' then 'contrato_tope_autorizado'
                          when 'devolver' then 'contrato_devuelto'
                          else 'contrato_rechazado' end,
            'contrato', p_id,
            case p_accion when 'autorizar' then 'Gerencia autorizó el contrato sobre el tope'
                          when 'devolver' then 'Solicitud de contrato devuelta por Gerencia'
                          else 'Solicitud de contrato rechazada por Gerencia' end,
            'Solicitud ' || v.codigo || case p_accion
              when 'autorizar' then ': Gerencia autorizó los valores por encima del tope. Sigue a pre-aprobación de Jurídica.'
              when 'devolver' then ' devuelta por Gerencia para corregir los valores. Motivo: ' || v_motivo
              else ' rechazada por Gerencia. Motivo: ' || v_motivo end);
  end if;
end;
$$;
revoke all on function public.resolver_autorizacion_tope(uuid, text, text) from public, anon;
grant execute on function public.resolver_autorizacion_tope(uuid, text, text) to authenticated;

-- 6. Mis pendientes (Gerencia) ---------------------------------------------------

select pg_temp._parche('public._pendientes_de(uuid)'::regprocedure,
  '  -- ------------------------------------------------ Otrosí por revisar (Jurídica) y por aprobar (Gerencia)',
  '  -- ------------------------------------------------ Contratos sobre el tope por autorizar (Gerencia, 20270101004200)
  union all
  select ''contrato_sobre_tope'', ''hacer'', c.id, c.proyecto_id,
         c.codigo, k.nombre,
         c.valor, coalesce(c.enviado_at, c.created_at), c.solicitado_por, null::date,
         ''/contratos/aprobacion-minutas?vista=tope''
    from contratos c
    join contratistas k on k.id = c.contratista_id
   where c.estado = ''por_autorizar'' and c.proyecto_id = any(v_proys)
     and public.tiene_accion(p_uid, ''autorizar_contratos_sobre_tope'')

  -- ------------------------------------------------ Otrosí por revisar (Jurídica) y por aprobar (Gerencia)');

commit;
