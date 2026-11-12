-- Correos de 360, segunda parte (decisiones del usuario, 2026-11-12).
--
-- 1. Por correo solo salen los avisos elegidos (ajustes_correo.tipos; la
--    campanita no cambia): contratos, minutas, otrosí, pólizas, actas (pago
--    aprobado con su avance, por facturar, rechazado; autorización de pago a
--    otro tercero), requisiciones (comprada, extraordinaria por aprobar,
--    rechazada, administrativa por aprobar / aprobada / rechazada), órdenes de
--    compra aprobadas o rechazadas y pagos administrativos aprobados o rechazados.
-- 2. Aviso nuevo "requisicion_comprada": al aprobarse una OC, a quien pidió
--    cada requisición que compra.
-- 3. OC aprobada o rechazada: también a Líder Compras (los que ven el proyecto).
-- 4. Resúmenes (perfiles.correo_resumen, por omisión sí):
--    - Lunes a viernes 12:00 (hora Colombia): "Tienes N pagos por aprobar /
--      preparar / liquidar / dispersar, PSE por pagar y cuentas por verificar",
--      según lo que haga cada quien. Solo si tiene algo.
--    - Lunes 8:00: los pendientes de la semana de cada persona (Mis pendientes).
--
-- Solo agrega; el único cambio sobre algo vivo es la lista de tipos de aviso
-- (se agrega 'requisicion_comprada' a la lista actual). Reversa en
-- supabase/reversa/20270101002300_correos_resumenes.sql.

begin;

-- 1. Tipos que salen por correo -----------------------------------------------------
alter table public.ajustes_correo add column if not exists tipos text[] not null default '{}';
update public.ajustes_correo set tipos = array[
  'contrato_por_revisar', 'contrato_aprobado', 'contrato_devuelto', 'contrato_rechazado',
  'minuta_por_revisar', 'minuta_aprobada', 'minuta_devuelta', 'contrato_vencido', 'contrato_vencido_juridica',
  'otrosi_por_revisar', 'otrosi_por_aprobar', 'otrosi_devuelto', 'otrosi_rechazado', 'otrosi_aprobado', 'otrosi_devuelto_subgerencia',
  'poliza_pendiente', 'poliza_por_revisar', 'poliza_aprobada', 'poliza_devuelta',
  'acta_aprobada', 'acta_por_facturar', 'acta_rechazada',
  'autorizacion_tercero_por_revisar', 'autorizacion_tercero_aprobada', 'autorizacion_tercero_rechazada',
  'requisicion_comprada', 'requisicion_extraordinaria', 'pedido_rechazado',
  'requisicion_administrativa_por_aprobar', 'requisicion_administrativa_aprobada', 'requisicion_administrativa_rechazada',
  'orden_compra_aprobada', 'orden_compra_rechazada',
  'requisicion_admin_aprobada', 'requisicion_admin_rechazada'
] where id and tipos = '{}';

create or replace function public._encolar_correo_notificacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_correo text;
  v_ajustes record;
begin
  begin
    select a.activo, a.url_app, a.tipos into v_ajustes from public.ajustes_correo a where a.id;
    if not coalesce(v_ajustes.activo, false) or not (new.tipo = any (v_ajustes.tipos)) then
      return null;
    end if;
    select u.email into v_correo
      from public.perfiles p join auth.users u on u.id = p.id
     where p.id = new.usuario_id and p.correo_avisos = 'inmediato';
    if v_correo is null then
      return null;
    end if;
    insert into public.correos_salientes (usuario_id, para, asunto, titulo, mensaje, enlace, notificacion_id)
    values (new.usuario_id, v_correo, left('CONYCA 360 · ' || new.titulo, 200), new.titulo, new.mensaje,
            case when v_ajustes.url_app is not null then rtrim(v_ajustes.url_app, '/') || '/notificaciones/' || new.id end,
            new.id);
  exception when others then
    raise warning 'No se pudo encolar el correo de la notificación %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

-- 2. Aviso "requisición comprada" -----------------------------------------------------
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo = any (array[
  'acta_por_facturar', 'pedido_rechazado', 'pedido_aprobado', 'orden_compra_rechazada', 'orden_compra_aprobada',
  'insumo_sobre_presupuesto', 'orden_compra_precio_sobre_efectivo', 'contrato_por_revisar', 'contrato_aprobado',
  'contrato_devuelto', 'contrato_rechazado', 'acta_aprobada', 'acta_rechazada', 'minuta_por_revisar',
  'minuta_aprobada', 'minuta_devuelta', 'contrato_vencido', 'contrato_vencido_juridica', 'insumo_rechazado',
  'otrosi_por_revisar', 'otrosi_por_aprobar', 'otrosi_devuelto', 'otrosi_rechazado', 'otrosi_aprobado',
  'otrosi_devuelto_subgerencia', 'poliza_pendiente', 'poliza_por_revisar', 'poliza_aprobada', 'poliza_devuelta',
  'requisicion_admin_aprobada', 'requisicion_admin_rechazada', 'requisicion_extraordinaria',
  'requisicion_administrativa', 'insumo_por_convertir', 'requisicion_administrativa_por_aprobar',
  'requisicion_administrativa_aprobada', 'requisicion_administrativa_rechazada', 'insumo_aprobado',
  'autorizacion_tercero_por_revisar', 'autorizacion_tercero_aprobada', 'autorizacion_tercero_rechazada',
  'requisicion_comprada'
])) not valid;

create or replace function public._avisar_requisiciones_compradas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_proveedor text;
begin
  if not (new.estado = 'aprobada' and old.estado is distinct from 'aprobada') then
    return null;
  end if;
  begin
    select pr.nombre into v_proveedor from public.proveedores pr where pr.id = new.proveedor_id;
    for v in
      select distinct r.id, r.codigo, r.solicitado_por
        from public.ordenes_compra_items i
        join public.pedidos_insumos pi on pi.id = i.pedido_insumo_id
        join public.requisiciones r on r.id = pi.grupo_pedido_id
       where i.orden_compra_id = new.id and r.solicitado_por is not null
    loop
      perform public.notificar_una(
        v.solicitado_por, 'requisicion_comprada', 'requisicion', v.id,
        'Requisición comprada',
        'Tu requisición ' || coalesce(v.codigo, '') || ' se compró con la orden ' || coalesce(new.codigo, '')
          || coalesce(' a ' || v_proveedor, '') || '.');
    end loop;
  exception when others then
    raise warning 'No se pudo avisar la compra de la OC %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public._avisar_requisiciones_compradas() from public, anon, authenticated;
drop trigger if exists trg_avisar_requisiciones_compradas on public.ordenes_compra;
create trigger trg_avisar_requisiciones_compradas after update of estado on public.ordenes_compra
  for each row execute function public._avisar_requisiciones_compradas();

-- 3. OC aprobada o rechazada: también a Líder Compras --------------------------------
create or replace function public._avisar_oc_lider_compras()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  if not (new.estado in ('aprobada', 'rechazada') and new.estado is distinct from old.estado) then
    return null;
  end if;
  begin
    for v_uid in
      select p.id from public.perfiles p join public.roles r on r.id = p.rol_id
       where r.clave = 'lider_compras' and p.id is distinct from new.created_by
         and new.proyecto_id in (select public.proyectos_visibles(p.id))
    loop
      perform public.notificar_una(
        v_uid,
        case new.estado when 'aprobada' then 'orden_compra_aprobada' else 'orden_compra_rechazada' end,
        'orden_compra', new.id,
        case new.estado when 'aprobada' then 'Orden de compra aprobada' else 'Orden de compra rechazada' end,
        'La orden de compra ' || coalesce(new.codigo, '') || ' fue '
          || case new.estado when 'aprobada' then 'aprobada.' else 'rechazada.' end);
    end loop;
  exception when others then
    raise warning 'No se pudo avisar a Líder Compras la OC %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public._avisar_oc_lider_compras() from public, anon, authenticated;
drop trigger if exists trg_avisar_oc_lider_compras on public.ordenes_compra;
create trigger trg_avisar_oc_lider_compras after update of estado on public.ordenes_compra
  for each row execute function public._avisar_oc_lider_compras();

-- 4. Resúmenes --------------------------------------------------------------------
alter table public.perfiles add column if not exists correo_resumen boolean not null default true;

-- Títulos de Mis pendientes (los mismos de lib/pendientes.ts, GRUPOS_PENDIENTES).
create or replace function public._titulo_pendiente(p_tipo text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_build_object(
    'mi_contrato_devuelto', 'Mis solicitudes de contrato devueltas',
    'mi_otrosi_devuelto', 'Mis otrosí devueltos',
    'mi_acta_rechazada', 'Mis actas rechazadas',
    'mi_acta_por_facturar', 'Actas aprobadas: subir la factura',
    'mi_firma', 'Mi firma',
    'mi_poliza_por_subir', 'Pólizas por subir',
    'mi_contrato_por_firmar', 'Contratos: subir la copia firmada por el contratista',
    'mi_otrosi_por_firmar', 'Otrosí: subir la copia firmada por el contratista',
    'mi_req_admin_rechazada', 'Mis pagos administrativos rechazados',
    'req_por_aprobar', 'Requisiciones por aprobar',
    'req_extra_por_aprobar', 'Requisiciones extraordinarias por aprobar',
    'req_administrativa_por_aprobar', 'Requisiciones administrativas por aprobar',
    'insumo_por_aprobar', 'Insumos nuevos por aprobar',
    'insumo_por_convertir', 'Insumos aprobados que necesitan conversión',
    'mo_por_aprobar', 'Mano de obra y equipos por aprobar',
    'req_por_comprar', 'Requisiciones por comprar',
    'oc_por_recibir', 'Órdenes de compra por recibir',
    'contrato_por_preaprobar', 'Contratos por pre-aprobar',
    'minuta_por_elaborar', 'Minutas por hacer o corregir',
    'minuta_por_aprobar', 'Minutas por aprobar',
    'otrosi_por_revisar', 'Otrosí por revisar',
    'otrosi_por_aprobar', 'Otrosí por aprobar',
    'poliza_por_revisar', 'Pólizas por revisar',
    'contrato_vencido', 'Contratos vencidos sin liquidar',
    'pago_por_aprobar', 'Pagos por aprobar',
    'req_admin_por_aprobar', 'Pagos administrativos por aprobar',
    'saldo_acta_por_pagar', 'Saldos de actas por pagar',
    'pago_sin_tercero', 'Pagos aprobados sin tercero o cuenta',
    'cuenta_por_verificar', 'Cuentas de terceros por verificar',
    'pago_observado', 'Pagos observados por Contabilidad',
    'pago_por_liquidar', 'Pagos por liquidar',
    'mi_req_atrasada', 'Mis requisiciones atrasadas'
  ) ->> p_tipo, p_tipo)
$$;

create or replace function public._fmt_pesos(p numeric)
returns text
language sql
immutable
as $$ select '$ ' || replace(to_char(coalesce(p, 0), 'FM999G999G999G999'), ',', '.') $$;

-- Las líneas del resumen de una persona. p_tipo: 'diario' (pagos y cuentas) o
-- 'semanal' (todos sus pendientes). Vacío = no se le envía nada.
create or replace function public._lineas_resumen(p_tipo text, p_uid uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lineas text[] := '{}';
  v_cant bigint;
  v_monto numeric;
  r record;
begin
  if p_tipo = 'diario' then
    -- Pagos por aprobar, por liquidar y cuentas por verificar: de Mis pendientes.
    for r in
      select x.tipo, count(*) n, sum(x.monto) monto
        from public._pendientes_de(p_uid) x
       where x.tipo in ('pago_por_aprobar', 'req_admin_por_aprobar', 'pago_por_liquidar', 'cuenta_por_verificar')
       group by x.tipo
    loop
      v_lineas := v_lineas || ('• ' || r.n || ' ' || lower(public._titulo_pendiente(r.tipo))
                               || case when r.monto > 0 then ' (' || public._fmt_pesos(r.monto) || ')' else '' end);
    end loop;
    -- Por preparar (enviar a liquidar): Financiera.
    if public.tiene_accion(p_uid, 'gestionar_pagos') then
      select count(*), sum(g.valor) into v_cant, v_monto from public.pagos g
       where g.estado = 'aprobado' and g.liquidacion_estado is null and g.semana is not null
         and g.consolidado_id in (select public._consolidados_visibles(p_uid));
      if v_cant > 0 then
        v_lineas := v_lineas || ('• ' || v_cant || ' pagos por preparar (enviar a liquidar) (' || public._fmt_pesos(v_monto) || ')');
      end if;
    end if;
    -- Por dispersar (transferencias liquidadas).
    if public.tiene_accion(p_uid, 'generar_dispersores') then
      select count(*), sum(trunc(coalesce(g.valor_a_pagar, g.valor))) into v_cant, v_monto from public.pagos g
       where g.estado = 'aprobado' and g.liquidacion_estado = 'liquidado' and g.dispersion_id is null
         and not public.pago_es_pse(g)
         and g.consolidado_id in (select public._consolidados_visibles(p_uid));
      if v_cant > 0 then
        v_lineas := v_lineas || ('• ' || v_cant || ' pagos por dispersar (' || public._fmt_pesos(v_monto) || ')');
      end if;
    end if;
    -- PSE por pagar.
    if public.tiene_accion(p_uid, 'pagar_pse') then
      select count(*), sum(coalesce(g.valor_a_pagar, g.valor)) into v_cant, v_monto from public.pagos g
       where g.estado = 'aprobado' and g.liquidacion_estado = 'liquidado' and public.pago_es_pse(g)
         and g.consolidado_id in (select public._consolidados_visibles(p_uid));
      if v_cant > 0 then
        v_lineas := v_lineas || ('• ' || v_cant || ' pagos por PSE por pagar (' || public._fmt_pesos(v_monto) || ')');
      end if;
    end if;
  else
    for r in
      select x.tipo, count(*) n from public._pendientes_de(p_uid) x group by x.tipo order by count(*) desc
    loop
      v_lineas := v_lineas || ('• ' || public._titulo_pendiente(r.tipo) || ': ' || r.n);
    end loop;
  end if;
  return v_lineas;
end;
$$;
revoke all on function public._lineas_resumen(text, uuid) from public, anon, authenticated;

create or replace function public._encolar_resumenes(p_tipo text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aj record;
  v_u record;
  v_lineas text[];
  v_n integer := 0;
  v_enlace text;
begin
  select a.activo, a.url_app into v_aj from public.ajustes_correo a where a.id;
  if not coalesce(v_aj.activo, false) then
    return 0;
  end if;
  v_enlace := case when v_aj.url_app is not null then rtrim(v_aj.url_app, '/') || '/pendientes' end;
  for v_u in
    select p.id, u.email from public.perfiles p join auth.users u on u.id = p.id
     where p.correo_resumen and u.email is not null and u.banned_until is null
  loop
    v_lineas := public._lineas_resumen(p_tipo, v_u.id);
    if coalesce(array_length(v_lineas, 1), 0) > 0 then
      insert into public.correos_salientes (usuario_id, para, asunto, titulo, mensaje, enlace)
      values (v_u.id, v_u.email,
              case p_tipo when 'diario' then 'CONYCA 360 · Tus pagos de hoy' else 'CONYCA 360 · Tus pendientes de la semana' end,
              case p_tipo when 'diario' then 'Tus pagos de hoy' else 'Tus pendientes de la semana' end,
              'Tienes:' || E'\n' || array_to_string(v_lineas, E'\n'),
              v_enlace);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- Vista previa (editor SQL): a quién le llegaría y qué, sin enviar nada.
create or replace function public.vista_previa_resumenes(p_tipo text)
returns table (nombre text, correo text, contenido text)
language sql
stable
security definer
set search_path = public
as $$
  select p.nombre, u.email, array_to_string(l.lineas, E'\n')
    from public.perfiles p join auth.users u on u.id = p.id
    cross join lateral (select public._lineas_resumen(p_tipo, p.id) lineas) l
   where p.correo_resumen and u.email is not null and u.banned_until is null
     and coalesce(array_length(l.lineas, 1), 0) > 0
   order by p.nombre
$$;
revoke all on function public.vista_previa_resumenes(text) from public, anon, authenticated;

revoke all on function public._encolar_resumenes(text) from public, anon, authenticated;

-- 12:00 de lunes a viernes y 8:00 los lunes, hora de Colombia (UTC−5).
select cron.schedule('resumen-diario-pagos', '0 17 * * 1-5', $c$ select public._encolar_resumenes('diario') $c$);
select cron.schedule('resumen-semanal-pendientes', '0 13 * * 1', $c$ select public._encolar_resumenes('semanal') $c$);

-- Preferencia de resúmenes (la propia, o la de otro si es Administrador).
create or replace function public.fijar_correo_resumen(p_usuario_id uuid, p_recibe boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión.';
  end if;
  if p_usuario_id is distinct from auth.uid() and not public.es_admin(auth.uid()) then
    raise exception 'No autorizado -- solo el Administrador cambia los correos de otra persona.';
  end if;
  update public.perfiles set correo_resumen = coalesce(p_recibe, false) where id = p_usuario_id;
end;
$$;

create or replace function public.mis_correos()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('avisos', p.correo_avisos, 'resumen', p.correo_resumen) from public.perfiles p where p.id = auth.uid()
$$;

-- Admin: también los resúmenes de cada persona.
create or replace function public.estado_correos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.es_admin(auth.uid()) then
    raise exception 'No autorizado -- solo el Administrador.';
  end if;
  return jsonb_build_object(
    'activo', coalesce((select a.activo from public.ajustes_correo a where a.id), false),
    'usuarios', coalesce((select jsonb_object_agg(p.id, p.correo_avisos) from public.perfiles p), '{}'::jsonb),
    'resumen', coalesce((select jsonb_object_agg(p.id, p.correo_resumen) from public.perfiles p), '{}'::jsonb));
end;
$$;

revoke all on function public.fijar_correo_resumen(uuid, boolean) from public, anon;
revoke all on function public.mis_correos() from public, anon;
grant execute on function public.fijar_correo_resumen(uuid, boolean) to authenticated;
grant execute on function public.mis_correos() to authenticated;

commit;
