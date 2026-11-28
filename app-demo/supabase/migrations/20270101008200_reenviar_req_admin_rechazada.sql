-- Requisición administrativa rechazada: se corrige y vuelve a aprobación
-- (decisión del usuario, 2026-11-28; cambia 20270101005100).
--
-- Caso: Subgerencia rechazó RQ-001-0023 pidiendo revisar cantidades y Ricardo
-- no la podía modificar ("Solo se puede modificar mientras Subgerencia no la
-- haya aprobado ni rechazado").
--
-- Quien la hizo puede modificar también una requisición administrativa
-- RECHAZADA por Subgerencia (todas sus líneas rechazadas o canceladas). Al
-- guardar, sus líneas vuelven a pendiente (sin quién/cuándo/motivo del rechazo;
-- el rechazo queda en el historial), la requisición vuelve a "por aprobar" con
-- el MISMO número (o el del proyecto nuevo si se cambia el proyecto) y
-- Subgerencia recibe el aviso. Se puede reenviar sin cambios. El evento
-- 'modificada' del historial lleva reenviada = true.
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

-- 1. Modificar ------------------------------------------------------------------------

select pg_temp._parche('public.modificar_requisicion_administrativa(uuid,uuid,jsonb,date,boolean,text,text)'::regprocedure,
  '  l record;
begin',
  '  l record;
  v_reenviada boolean := false;
begin');

select pg_temp._parche('public.modificar_requisicion_administrativa(uuid,uuid,jsonb,date,boolean,text,text)'::regprocedure,
  '  perform 1 from pedidos_insumos where grupo_pedido_id = p_id for update;
  if exists (select 1 from pedidos_insumos where grupo_pedido_id = p_id and estado not in (''pendiente'', ''cancelado''))
     or not exists (select 1 from pedidos_insumos where grupo_pedido_id = p_id and estado = ''pendiente'') then
    raise exception ''Solo se puede modificar mientras Subgerencia no la haya aprobado ni rechazado.'';
  end if;',
  '  perform 1 from pedidos_insumos where grupo_pedido_id = p_id for update;
  -- Rechazada por Subgerencia: se corrige y vuelve a aprobación (20270101008200).
  v_reenviada := exists (select 1 from pedidos_insumos where grupo_pedido_id = p_id and estado = ''rechazado'')
             and not exists (select 1 from pedidos_insumos where grupo_pedido_id = p_id and estado not in (''rechazado'', ''cancelado''));
  if v_reenviada then
    update pedidos_insumos
       set estado = ''pendiente'', resuelto_por = null, resuelto_at = null, comentario_resolucion = null
     where grupo_pedido_id = p_id and estado = ''rechazado'';
  end if;
  if exists (select 1 from pedidos_insumos where grupo_pedido_id = p_id and estado not in (''pendiente'', ''cancelado''))
     or not exists (select 1 from pedidos_insumos where grupo_pedido_id = p_id and estado = ''pendiente'') then
    raise exception ''Solo se puede modificar mientras Subgerencia no la haya aprobado (una rechazada se corrige y vuelve a aprobación).'';
  end if;');

-- Reenviar sin cambios también vale.
select pg_temp._parche('public.modificar_requisicion_administrativa(uuid,uuid,jsonb,date,boolean,text,text)'::regprocedure,
  '  if v_quitados = ''[]''::jsonb and v_agregados = ''[]''::jsonb and v_cambios = ''[]''::jsonb',
  '  if not v_reenviada and v_quitados = ''[]''::jsonb and v_agregados = ''[]''::jsonb and v_cambios = ''[]''::jsonb');

select pg_temp._parche('public.modificar_requisicion_administrativa(uuid,uuid,jsonb,date,boolean,text,text)'::regprocedure,
  '  perform public._evento_requisicion(p_id, ''modificada'', null, jsonb_build_object(
    ''agregados'', v_agregados,',
  '  perform public._evento_requisicion(p_id, ''modificada'', null, jsonb_build_object(
    ''reenviada'', v_reenviada,
    ''agregados'', v_agregados,');

-- Aviso a Subgerencia también al reenviar (antes solo al cambiar de proyecto).
select pg_temp._parche('public.modificar_requisicion_administrativa(uuid,uuid,jsonb,date,boolean,text,text)'::regprocedure,
  '  if v_cambia_proyecto then
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    select pf.id, ''requisicion_administrativa_por_aprobar'', ''requisicion'', p_id,
           case when v_urgente then ''Requisición administrativa URGENTE por aprobar'' else ''Requisición administrativa por aprobar'' end,
           ''Requisición '' || v_codigo || '' ('' || v_proyecto_txt || ''), antes '' || v_h.codigo || '': ''',
  '  if v_cambia_proyecto or v_reenviada then
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    select pf.id, ''requisicion_administrativa_por_aprobar'', ''requisicion'', p_id,
           case when v_reenviada and v_urgente then ''Requisición administrativa URGENTE corregida por aprobar''
                when v_reenviada then ''Requisición administrativa corregida por aprobar''
                when v_urgente then ''Requisición administrativa URGENTE por aprobar''
                else ''Requisición administrativa por aprobar'' end,
           ''Requisición '' || coalesce(v_codigo, v_h.codigo)
             || coalesce('' ('' || v_proyecto_txt || ''), antes '' || v_h.codigo, '''')
             || case when v_reenviada then '', corregida después del rechazo'' else '''' end || '': ''');

-- 2. Detalle: "modificable" también para la rechazada -----------------------------------

select pg_temp._parche('public.detalle_requisicion_administrativa(uuid)'::regprocedure,
  '    ''modificable'', v_r.solicitado_por = v_uid
                   and exists (select 1 from public.pedidos_insumos p where p.grupo_pedido_id = p_id and p.estado = ''pendiente'')
                   and not exists (select 1 from public.pedidos_insumos p
                                    where p.grupo_pedido_id = p_id and p.estado not in (''pendiente'', ''cancelado'')),',
  '    ''modificable'', v_r.solicitado_por = v_uid
                   and ((exists (select 1 from public.pedidos_insumos p where p.grupo_pedido_id = p_id and p.estado = ''pendiente'')
                         and not exists (select 1 from public.pedidos_insumos p
                                          where p.grupo_pedido_id = p_id and p.estado not in (''pendiente'', ''cancelado'')))
                        -- Rechazada: se corrige y vuelve a aprobación (20270101008200).
                        or (exists (select 1 from public.pedidos_insumos p where p.grupo_pedido_id = p_id and p.estado = ''rechazado'')
                            and not exists (select 1 from public.pedidos_insumos p
                                             where p.grupo_pedido_id = p_id and p.estado not in (''rechazado'', ''cancelado'')))),');

commit;
