-- Reversa de 20270101004200_contratos_sobre_tope.sql.
-- Las solicitudes que estén por autorizar pasan a 'devuelta' (con motivo) para
-- que el director las corrija dentro del tope. Las columnas nuevas se dejan
-- (registro de lo autorizado); la acción y los tipos de aviso también.

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
  if position(p_a in d) = 0 then
    return;
  end if;
  execute replace(d, p_a, p_b);
end;
$f$;

update public.contratos
   set estado = 'devuelta', motivo_resolucion = 'Se quitó la autorización sobre el tope: corrige los valores dentro del tope.'
 where estado = 'por_autorizar';

select pg_temp._parche('public._pendientes_de(uuid)'::regprocedure,
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

', '');

drop function if exists public.resolver_autorizacion_tope(uuid, text, text);

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
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
  end if;',
  '  perform public._notificar_aprobadores_contrato(
    p_id,
    case when p_existente then ''Solicitud de contrato corregida'' else ''Nueva solicitud de contrato'' end,
    ''Solicitud '' || (select codigo from public.contratos where id = p_id) || '' por revisar en pre-aprobación.''
  );');
select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  'jsonb_build_object(''valor'', v_valor, ''sobre_tope'', v_sobre_tope));', 'jsonb_build_object(''valor'', v_valor));');
select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '         v_tipo = ''mano_obra'' and public._valor_mano_obra_item(pi.id) = 0,
         public._tope_valor_unitario_item(pi.id, v_tipo)
', '         v_tipo = ''mano_obra'' and public._valor_mano_obra_item(pi.id) = 0
');
select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  'valor_unitario, sin_mano_obra, tope_valor_unitario)', 'valor_unitario, sin_mano_obra)');
select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '      v_departamento, v_datos_tipo,
      case when v_sobre_tope then ''por_autorizar'' else ''pre_aprobacion'' end, case when v_sobre_tope then v_justificacion end
    )', '      v_departamento, v_datos_tipo
    )');
select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '      correo_notificacion, observaciones, domicilio_departamento, datos_tipo,
      estado, sobre_tope_justificacion
    ) values (', '      correo_notificacion, observaciones, domicilio_departamento, datos_tipo
    ) values (');
select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '      estado = case when v_sobre_tope then ''por_autorizar'' else ''pre_aprobacion'' end,
      sobre_tope_justificacion = case when v_sobre_tope then v_justificacion end,
      sobre_tope_autorizado_at = null,
      sobre_tope_autorizado_por = null,', '      estado = ''pre_aprobacion'',');
select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '    v_valor := v_suma;
    if v_sobre_tope and v_justificacion is null then
      raise exception ''Hay actividades con valor unitario por encima del tope: escribe la justificación para pedir la autorización de Gerencia.'';
    end if;', '    v_valor := v_suma;');
select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '      if v_valor_unitario > v_tope and v_tipo in (''obra'', ''mano_obra'') then
        -- Sobre el tope: lo autoriza Gerencia antes de Pre-aprobación (20270101004200).
        v_sobre_tope := true;
      elsif v_valor_unitario > v_tope then
        if v_tope < v_pi.valor_unitario then', '      if v_valor_unitario > v_tope then
        if v_tope < v_pi.valor_unitario then');
select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '  v_tope numeric;
  v_sobre_tope boolean := false;
  v_justificacion text := nullif(trim(coalesce(p_datos->>''sobre_tope_justificacion'', '''')), '''');', '  v_tope numeric;');

drop function if exists public._notificar_autorizadores_tope(uuid, text, text);

alter table public.contratos drop constraint if exists contratos_estado_check;
alter table public.contratos add constraint contratos_estado_check
  check (estado in ('pre_aprobacion', 'devuelta', 'rechazada', 'aprobada'));

commit;
