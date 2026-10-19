-- Historial de pagos, terceros y proveedores, y el rol de quien hizo cada cosa
-- (decisión del usuario, 2026-10-19: fase 2 del historial "para todo").
--
-- 1. Pagos (entidad 'pago'): disparador sobre `pagos` que escribe en
--    historial_eventos cuando se crea, cambia de estado (aprobado, rechazado,
--    anulado, liberado...), cambia de tercero o de cuenta, o cambia de valor
--    (editar un acta con el pago pendiente lo cambia). Los pagos que ya
--    existían se reconstruyen con sus columnas (creado, aprobado, rechazado,
--    anulado) marcados `reconstruido`.
-- 2. Proveedores (entidad 'proveedor'): creado y cada edición con los campos
--    que cambiaron (antes y después). Lo de antes no se guardaba: no se puede
--    reconstruir.
-- 3. Terceros (tipo 'tercero'): NO se escribe nada nuevo. Ya existía
--    `terceros_auditoria` (disparadores _terceros_auditar sobre terceros y
--    terceros_cuentas, fila completa antes y después) pero ninguna pantalla la
--    mostraba. historial_entidad('tercero', id) la traduce a eventos: tercero
--    creado / editado, cuenta agregada / verificada / inactivada / modificada.
-- 4. historial_entidad devuelve también `usuario_rol` (nombre del rol de quien
--    hizo el evento) en todos los tipos.
--
-- Quién puede ver cada historial (la función es SECURITY DEFINER y lo revisa):
--   pago      = las pestañas que dejan ver pagos (Aprobación o Consolidado), igual que pagos_select.
--   tercero   = Terceros, Aprobación o Consolidado, igual que terceros_select.
--   proveedor = Proveedores, la acción comprar o Administrador.
-- Los demás tipos no cambian (copiados de la versión viva).

-- ------------------------------------------------------------ tipos válidos
alter table public.historial_eventos drop constraint if exists historial_eventos_entidad_tipo_check;
alter table public.historial_eventos add constraint historial_eventos_entidad_tipo_check
  check (entidad_tipo = any (array['orden_compra', 'pedido', 'requisicion', 'contrato', 'acta', 'pago', 'proveedor']));

-- ------------------------------------------------------------------- pagos
-- Texto corto de una cuenta para el historial: "Bancolombia · AHORROS 123456".
create or replace function public._texto_cuenta_tercero(p_cuenta_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(b.nombre, 'Banco') || ' · ' || c.tipo_cuenta || ' ' || c.numero_cuenta
    from public.terceros_cuentas c
    left join public.bancos b on b.id = c.banco_id
   where c.id = p_cuenta_id
$function$;
revoke all on function public._texto_cuenta_tercero(uuid) from public, anon, authenticated;

create or replace function public._historial_pago()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('pago', new.id, 'creado', v_uid,
            jsonb_build_object('estado', new.estado, 'valor', new.valor, 'tipo', new.tipo, 'fuente', new.fuente));
    return null;
  end if;

  -- Cambio de estado: un evento con el nombre del estado nuevo.
  if new.estado is distinct from old.estado then
    insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
    values ('pago', new.id, new.estado, v_uid,
            case new.estado
              when 'rechazado' then new.motivo_rechazo
              when 'anulado' then new.motivo_anulacion
            end,
            jsonb_build_object('de', old.estado, 'a', new.estado));
  end if;

  -- Tercero o cuenta cambiados: quién lo hizo y de qué a qué.
  if (new.tercero_id, new.cuenta_tercero_id) is distinct from (old.tercero_id, old.cuenta_tercero_id) then
    insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('pago', new.id, 'tercero_cambiado', v_uid,
            jsonb_build_object(
              'tercero_de', (select razon_social from public.terceros where id = old.tercero_id),
              'tercero_a', (select razon_social from public.terceros where id = new.tercero_id),
              'cuenta_de', public._texto_cuenta_tercero(old.cuenta_tercero_id),
              'cuenta_a', public._texto_cuenta_tercero(new.cuenta_tercero_id)
            ));
  end if;

  if new.valor is distinct from old.valor then
    insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('pago', new.id, 'valor_cambiado', v_uid, jsonb_build_object('de', old.valor, 'a', new.valor));
  end if;

  return null;
end;
$function$;
revoke all on function public._historial_pago() from public, anon, authenticated;

drop trigger if exists trg_historial_pago on public.pagos;
create trigger trg_historial_pago
  after insert or update on public.pagos
  for each row execute function public._historial_pago();

-- Pagos que ya existían: se reconstruye lo que guardan sus columnas.
insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos, created_at)
select 'pago', p.id, e.evento, e.usuario_id, e.motivo,
       jsonb_build_object('reconstruido', true) || e.datos, e.cuando
  from public.pagos p
  cross join lateral (values
    ('creado', null::uuid, null::text, jsonb_build_object('valor', p.valor, 'tipo', p.tipo, 'fuente', p.fuente), p.creado_en),
    ('aprobado', p.aprobado_por, null, '{}'::jsonb, p.aprobado_en),
    ('rechazado', p.rechazado_por, p.motivo_rechazo, '{}'::jsonb, p.rechazado_en),
    ('anulado', null, p.motivo_anulacion, '{}'::jsonb, p.anulado_en)
  ) as e(evento, usuario_id, motivo, datos, cuando)
 where e.cuando is not null
   and not exists (select 1 from public.historial_eventos h where h.entidad_tipo = 'pago' and h.entidad_id = p.id);

-- ------------------------------------------------------------- proveedores
create or replace function public._historial_proveedor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cambios jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('proveedor', new.unique_id, 'creado', auth.uid(),
            jsonb_build_object('nombre', new.nombre, 'id_prov', new.id_prov));
    return null;
  end if;

  select jsonb_object_agg(k, jsonb_build_object('de', o -> k, 'a', n -> k))
    into v_cambios
    from (select to_jsonb(old) as o, to_jsonb(new) as n) x
    cross join lateral jsonb_object_keys(x.n) as k
   where k not in ('unique_id', 'created_at')
     and (x.o -> k) is distinct from (x.n -> k);

  if v_cambios is not null then
    insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('proveedor', new.unique_id, 'editado', auth.uid(), jsonb_build_object('cambios', v_cambios));
  end if;
  return null;
end;
$function$;
revoke all on function public._historial_proveedor() from public, anon, authenticated;

drop trigger if exists trg_historial_proveedor on public.proveedores;
create trigger trg_historial_proveedor
  after insert or update on public.proveedores
  for each row execute function public._historial_proveedor();

-- ------------------------------------------------------ historial_entidad
create or replace function public.historial_entidad(p_tipo text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_ok boolean;
  v_uid uuid := auth.uid();
begin
  if p_tipo = 'orden_compra' then
    select (public.rol_compras(v_uid) or public.usuario_puede_ver_proyecto(v_uid, o.proyecto_id))
      into v_ok from public.ordenes_compra o where o.id = p_id;
  elsif p_tipo = 'pedido' then
    select (public.usuario_tiene_acceso_a_item(p.presupuesto_item_id) or public.rol_compras(v_uid))
      into v_ok from public.pedidos_insumos p where p.id = p_id;
  elsif p_tipo = 'requisicion' then
    select exists (
      select 1 from public.pedidos_insumos p
      where p.grupo_pedido_id = p_id
        and (public.usuario_tiene_acceso_a_item(p.presupuesto_item_id)
             or public.rol_compras(v_uid)
             or public.tiene_accion(v_uid, 'aprobar_pedidos'))
    ) into v_ok;
  elsif p_tipo = 'contrato' then
    select (
      public.tiene_pestana(v_uid, 'contratos.solicitar')
      or public.tiene_pestana(v_uid, 'contratos.preaprobacion')
      or public.tiene_pestana(v_uid, 'contratos.contratos')
      or public.tiene_pestana(v_uid, 'contratos.aprobar_minutas')
      or public.tiene_pestana(v_uid, 'admin.visualizacion')
    ) and public.usuario_puede_ver_proyecto(v_uid, c.proyecto_id)
      into v_ok from public.contratos c where c.id = p_id;
  elsif p_tipo = 'acta' then
    select public.puede_ver_actas(c.proyecto_id)
      into v_ok from public.actas a join public.contratos c on c.id = a.contrato_id where a.id = p_id;
  elsif p_tipo = 'pago' then
    select (public.tiene_pestana(v_uid, 'ayf.aprobacion_pagos') or public.tiene_pestana(v_uid, 'ayf.consolidado'))
      into v_ok from public.pagos where id = p_id;
  elsif p_tipo = 'tercero' then
    select (public.tiene_pestana(v_uid, 'ayf.terceros')
            or public.tiene_pestana(v_uid, 'ayf.aprobacion_pagos')
            or public.tiene_pestana(v_uid, 'ayf.consolidado'))
      into v_ok from public.terceros where id = p_id;
  elsif p_tipo = 'proveedor' then
    select (public.rol_compras(v_uid) or public.es_admin(v_uid) or public.tiene_pestana(v_uid, 'almacen.proveedores'))
      into v_ok from public.proveedores where unique_id = p_id;
  else
    raise exception 'Tipo de historial desconocido.';
  end if;

  if not coalesce(v_ok, false) then
    raise exception 'No tienes permiso para ver este historial.';
  end if;

  if p_tipo = 'requisicion' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre, 'usuario_rol', r.nombre,
               'motivo', h.motivo,
               'datos', case when h.entidad_tipo = 'pedido'
                             then coalesce(h.datos, '{}'::jsonb) || jsonb_build_object('insumo', mi.descripcion)
                             else h.datos end,
               'created_at', h.created_at
             ) order by h.created_at, h.id)
        from public.historial_eventos h
        left join public.perfiles pf on pf.id = h.usuario_id
        left join public.roles r on r.id = pf.rol_id
        left join public.pedidos_insumos pe on h.entidad_tipo = 'pedido' and pe.id = h.entidad_id
        left join public.maestro_insumos mi on mi.id = pe.insumo_id
       where (h.entidad_tipo = 'requisicion' and h.entidad_id = p_id)
          or (h.entidad_tipo = 'pedido' and h.evento = 'rechazado_por_compras'
              and pe.grupo_pedido_id = p_id)
    ), '[]'::jsonb);
  end if;

  -- Terceros: se lee terceros_auditoria (la fila completa antes y después) del
  -- tercero y de sus cuentas, y se traduce a eventos.
  if p_tipo = 'tercero' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ev.id::text, 'evento', ev.evento, 'usuario_nombre', pf.nombre, 'usuario_rol', r.nombre,
               'motivo', null, 'datos', ev.datos, 'created_at', ev.creado_en
             ) order by ev.creado_en, ev.id)
        from (
          select a.id, a.usuario_id, a.creado_en,
                 case
                   when a.tabla = 'terceros' then
                     case a.accion when 'INSERT' then 'tercero_creado' when 'DELETE' then 'tercero_borrado' else 'tercero_editado' end
                   when a.accion = 'INSERT' then 'cuenta_agregada'
                   when a.accion = 'DELETE' then 'cuenta_borrada'
                   when (a.antes ->> 'banco_id', a.antes ->> 'tipo_cuenta', a.antes ->> 'numero_cuenta')
                        is distinct from (a.despues ->> 'banco_id', a.despues ->> 'tipo_cuenta', a.despues ->> 'numero_cuenta')
                     then 'cuenta_modificada'
                   when a.despues ->> 'estado' is distinct from a.antes ->> 'estado' then
                     case a.despues ->> 'estado' when 'ACTIVO' then 'cuenta_verificada'
                                                 when 'INACTIVO' then 'cuenta_inactivada'
                                                 else 'cuenta_pendiente' end
                   else 'cuenta_editada'
                 end as evento,
                 case
                   when a.tabla = 'terceros' and a.accion = 'UPDATE' then
                     jsonb_build_object('cambios', (
                       select jsonb_object_agg(k, jsonb_build_object('de', a.antes -> k, 'a', a.despues -> k))
                         from jsonb_object_keys(a.despues) as k
                        where k not in ('id', 'creado_por', 'creado_en')
                          and (a.antes -> k) is distinct from (a.despues -> k)))
                   when a.tabla = 'terceros' then
                     jsonb_build_object('razon_social', coalesce(a.despues, a.antes) ->> 'razon_social')
                   else
                     jsonb_build_object(
                       'cuenta', coalesce(bd.nombre, 'Banco') || ' · ' || (coalesce(a.despues, a.antes) ->> 'tipo_cuenta')
                                 || ' ' || (coalesce(a.despues, a.antes) ->> 'numero_cuenta'),
                       'cuenta_antes', case when a.accion = 'UPDATE'
                                            and (a.antes ->> 'banco_id', a.antes ->> 'tipo_cuenta', a.antes ->> 'numero_cuenta')
                                                is distinct from (a.despues ->> 'banco_id', a.despues ->> 'tipo_cuenta', a.despues ->> 'numero_cuenta')
                                       then coalesce(ba.nombre, 'Banco') || ' · ' || (a.antes ->> 'tipo_cuenta') || ' ' || (a.antes ->> 'numero_cuenta')
                                       end,
                       'estado', coalesce(a.despues, a.antes) ->> 'estado')
                 end as datos
            from public.terceros_auditoria a
            left join public.bancos bd on bd.id = (coalesce(a.despues, a.antes) ->> 'banco_id')::uuid
            left join public.bancos ba on ba.id = (a.antes ->> 'banco_id')::uuid
           where (a.tabla = 'terceros' and a.registro_id = p_id)
              or (a.tabla = 'terceros_cuentas'
                  and a.registro_id in (select c.id from public.terceros_cuentas c where c.tercero_id = p_id))
        ) ev
        left join public.perfiles pf on pf.id = ev.usuario_id
        left join public.roles r on r.id = pf.rol_id
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre, 'usuario_rol', r.nombre,
             'motivo', h.motivo, 'datos', h.datos, 'created_at', h.created_at
           ) order by h.created_at, h.id)
      from public.historial_eventos h
      left join public.perfiles pf on pf.id = h.usuario_id
      left join public.roles r on r.id = pf.rol_id
     where h.entidad_tipo = p_tipo and h.entidad_id = p_id
  ), '[]'::jsonb);
end;
$function$;
