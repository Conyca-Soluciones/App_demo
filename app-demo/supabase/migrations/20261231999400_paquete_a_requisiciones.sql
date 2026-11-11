-- Paquete A: requisiciones administrativas y empresa que factura (decisiones
-- del usuario, 2026-11-11).
--
-- 1. Las requisiciones administrativas NUEVAS nacen pendientes y las aprueba
--    Subgerencia (acción aprobar_requisiciones_administrativas, pestaña
--    "Aprobación de requisiciones administrativas"), la requisición completa.
--    Al aprobarla pasa a Compras (y se le avisa); al rechazarla, con motivo,
--    se le avisa a quien la pidió. Las que ya existen no cambian (aprobadas).
-- 2. Aviso a quien pidió un insumo nuevo cuando se aprueba ("ya puedes hacer
--    la requisición"), como el que ya existía al rechazarlo.
-- 3. Dirección de entrega OBLIGATORIA en las requisiciones (normales,
--    extraordinarias y administrativas): requisiciones.direccion_entrega. Las
--    funciones de siempre no cambian de firma; las nuevas *_con_direccion las
--    envuelven en la misma transacción. Las requisiciones de antes quedan sin
--    dirección.
-- 4. Empresa que factura la orden de compra: ordenes_compra.empresa_id (null =
--    la del proyecto, como antes). Compras la elige al generar la OC
--    (crear_orden_compra_empresa). De ella salen la empresa y el consolidado
--    del pago, el saldo a favor y el encabezado del PDF.
--
-- La app está en vivo: solo agrega. Los ajustes a funciones vivas son parches
-- por texto exacto (fallan si no encuentran el texto, no hacen nada si ya
-- están). Se puede correr dos veces. Reversa en
-- supabase/reversa/20261231999400_paquete_a_requisiciones.sql.

begin;

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  -- El archivo puede llegar con fin de línea de Windows.
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
$$;

-- ===========================================================================
-- 0. Notificaciones nuevas
-- ===========================================================================
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo = any (array[
  'acta_por_facturar', 'pedido_rechazado', 'pedido_aprobado', 'orden_compra_rechazada', 'orden_compra_aprobada',
  'insumo_sobre_presupuesto', 'orden_compra_precio_sobre_efectivo', 'contrato_por_revisar', 'contrato_aprobado',
  'contrato_devuelto', 'contrato_rechazado', 'acta_aprobada', 'acta_rechazada', 'minuta_por_revisar',
  'minuta_aprobada', 'minuta_devuelta', 'contrato_vencido', 'contrato_vencido_juridica', 'insumo_rechazado',
  'otrosi_por_revisar', 'otrosi_por_aprobar', 'otrosi_devuelto', 'otrosi_rechazado', 'otrosi_aprobado',
  'otrosi_devuelto_subgerencia', 'poliza_pendiente', 'poliza_por_revisar', 'poliza_aprobada', 'poliza_devuelta',
  'requisicion_admin_aprobada', 'requisicion_admin_rechazada', 'requisicion_extraordinaria',
  'requisicion_administrativa', 'insumo_por_convertir',
  -- Paquete A
  'requisicion_administrativa_por_aprobar', 'requisicion_administrativa_aprobada',
  'requisicion_administrativa_rechazada', 'insumo_aprobado'
])) not valid;

-- ===========================================================================
-- 1. Dirección de entrega
-- ===========================================================================
alter table public.requisiciones add column if not exists direccion_entrega text;

create or replace view public.requisiciones_vista with (security_invoker = true) as
 SELECT r.id,
    r.numero,
    r.proyecto_id,
    pr.codigo AS proyecto_codigo,
    pr.nombre AS proyecto_nombre,
    r.solicitado_por,
    pf.nombre AS solicitante_nombre,
    r.fecha_requerida,
    r.urgente,
    r.observaciones,
    r.soporte_url,
    r.created_at,
    r.n_lineas,
    r.estado,
    r.estado_compra,
    r.extraordinaria,
    r.justificacion,
    r.codigo,
    _fecha_estimada_requisicion(r.id) AS fecha_estimada,
    r.direccion_entrega,
    r.administrativa
   FROM ((requisiciones r
     LEFT JOIN proyectos pr ON ((pr.id = r.proyecto_id)))
     LEFT JOIN perfiles pf ON ((pf.id = r.solicitado_por)));

-- Valida y guarda la dirección (interna: la llaman las funciones *_con_direccion).
create or replace function public._fijar_direccion_requisicion(p_id uuid, p_direccion text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v text := nullif(btrim(regexp_replace(coalesce(p_direccion, ''), '\s+', ' ', 'g')), '');
begin
  if v is null then
    raise exception 'La dirección de entrega es obligatoria.';
  end if;
  if length(v) > 300 then
    raise exception 'La dirección de entrega es muy larga (máximo 300 caracteres).';
  end if;
  update public.requisiciones set direccion_entrega = v where id = p_id;
  if not found then
    raise exception 'La requisición no existe.';
  end if;
end;
$$;
revoke all on function public._fijar_direccion_requisicion(uuid, text) from public, anon, authenticated;

create or replace function public.crear_requisicion_con_direccion(
  p_lineas jsonb, p_fecha_requerida date, p_urgente boolean, p_observaciones text, p_soporte_url text,
  p_direccion_entrega text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  if nullif(btrim(coalesce(p_direccion_entrega, '')), '') is null then
    raise exception 'La dirección de entrega es obligatoria.';
  end if;
  r := public.crear_requisicion(p_lineas, p_fecha_requerida, p_urgente, p_observaciones, p_soporte_url);
  perform public._fijar_direccion_requisicion((r ->> 'id')::uuid, p_direccion_entrega);
  return r;
end;
$$;
revoke all on function public.crear_requisicion_con_direccion(jsonb, date, boolean, text, text, text) from public, anon;
grant execute on function public.crear_requisicion_con_direccion(jsonb, date, boolean, text, text, text) to authenticated;

create or replace function public.crear_requisicion_extraordinaria_con_direccion(
  p_lineas jsonb, p_fecha_requerida date, p_urgente boolean, p_justificacion text, p_direccion_entrega text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  if nullif(btrim(coalesce(p_direccion_entrega, '')), '') is null then
    raise exception 'La dirección de entrega es obligatoria.';
  end if;
  r := public.crear_requisicion_extraordinaria(p_lineas, p_fecha_requerida, p_urgente, p_justificacion);
  perform public._fijar_direccion_requisicion((r ->> 'id')::uuid, p_direccion_entrega);
  return r;
end;
$$;
revoke all on function public.crear_requisicion_extraordinaria_con_direccion(jsonb, date, boolean, text, text) from public, anon;
grant execute on function public.crear_requisicion_extraordinaria_con_direccion(jsonb, date, boolean, text, text) to authenticated;

-- modificar_requisicion ya revisa quién puede y que se pueda modificar.
create or replace function public.modificar_requisicion_con_direccion(
  p_id uuid, p_lineas jsonb, p_fecha_requerida date, p_urgente boolean, p_observaciones text, p_direccion_entrega text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(coalesce(p_direccion_entrega, '')), '') is null then
    raise exception 'La dirección de entrega es obligatoria.';
  end if;
  perform public.modificar_requisicion(p_id, p_lineas, p_fecha_requerida, p_urgente, p_observaciones);
  perform public._fijar_direccion_requisicion(p_id, p_direccion_entrega);
end;
$$;
revoke all on function public.modificar_requisicion_con_direccion(uuid, jsonb, date, boolean, text, text) from public, anon;
grant execute on function public.modificar_requisicion_con_direccion(uuid, jsonb, date, boolean, text, text) to authenticated;

-- ===========================================================================
-- 2. Requisiciones administrativas: las aprueba Subgerencia
-- ===========================================================================

-- Acción y pestaña para Subgerencia.
insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
  from public.roles r
 cross join (values ('tab.tecnico.aprobar_administrativas'), ('accion.aprobar_requisiciones_administrativas')) as p(permiso)
 where r.clave = 'subgerencia'
   and not exists (select 1 from public.rol_permisos x where x.rol_id = r.id and x.permiso = p.permiso);

-- Quien las aprueba ve FUNCIONAMIENTO (como Compras y Almacén).
select pg_temp._parche('public.proyectos_visibles(uuid)'::regprocedure,
  $a$    and (public.tiene_accion(p_usuario_id, 'comprar') or public.tiene_accion(p_usuario_id, 'gestionar_almacen'))$a$,
  $b$    and (public.tiene_accion(p_usuario_id, 'comprar') or public.tiene_accion(p_usuario_id, 'gestionar_almacen')
         or public.tiene_accion(p_usuario_id, 'aprobar_requisiciones_administrativas'))$b$);
select pg_temp._parche('public.usuario_puede_ver_proyecto(uuid,uuid)'::regprocedure,
  $a$        and (public.tiene_accion(p_usuario_id, 'comprar') or public.tiene_accion(p_usuario_id, 'gestionar_almacen')))$a$,
  $b$        and (public.tiene_accion(p_usuario_id, 'comprar') or public.tiene_accion(p_usuario_id, 'gestionar_almacen')
             or public.tiene_accion(p_usuario_id, 'aprobar_requisiciones_administrativas')))$b$);

-- Crear: una sola versión interna (pendiente, con dirección, avisa a Subgerencia).
create or replace function public._crear_requisicion_administrativa(
  p_proyecto_id uuid, p_lineas jsonb, p_fecha_requerida date, p_urgente boolean, p_observaciones text,
  p_direccion_entrega text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_item uuid;
  v_proyecto uuid := p_proyecto_id;
  v_proyecto_txt text;
  v_numero bigint;
  v_codigo text;
  v_obs text := nullif(trim(p_observaciones), '');
  v_total int;
  l record;
begin
  if v_uid is null then raise exception 'Inicia sesión.'; end if;
  if v_proyecto is null then raise exception 'Elige FUNCIONAMIENTO o un proyecto.'; end if;
  select coalesce(codigo || ' - ', '') || nombre into v_proyecto_txt from public.proyectos
   where id = v_proyecto
     and (funcionamiento or id in (select public.proyectos_visibles(v_uid)));
  if v_proyecto_txt is null then raise exception 'El proyecto no existe o no tienes acceso.'; end if;

  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos un insumo a la requisición.';
  end if;
  if jsonb_array_length(p_lineas) > 50 then
    raise exception 'Una requisición puede tener máximo 50 insumos.';
  end if;
  if p_fecha_requerida is null then raise exception 'La fecha requerida es obligatoria.'; end if;
  if p_fecha_requerida < (now() at time zone 'America/Bogota')::date then
    raise exception 'La fecha requerida no puede ser anterior a hoy.';
  end if;

  select count(*)::int into v_total from jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric);
  if (select count(distinct insumo_id) from jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric)) <> v_total then
    raise exception 'Hay un insumo repetido en la requisición.';
  end if;
  for l in select * from jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric) loop
    if l.insumo_id is null or not exists (select 1 from public.maestro_insumos mi where mi.id = l.insumo_id) then
      raise exception 'Hay un insumo que no existe en el maestro.';
    end if;
    if l.cantidad is null or l.cantidad <= 0 or l.cantidad <> trunc(l.cantidad) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero.';
    end if;
  end loop;

  v_item := public._item_requisicion_administrativa(v_proyecto);
  if v_item is null then
    raise exception 'El proyecto no tiene presupuesto cargado: pide la requisición para FUNCIONAMIENTO o carga el presupuesto.';
  end if;

  perform pg_advisory_xact_lock(hashtext('requisicion:' || v_proyecto::text));

  insert into public.requisiciones (id, proyecto_id, solicitado_por, fecha_requerida, urgente, observaciones, administrativa)
  values (v_id, v_proyecto, v_uid, p_fecha_requerida, coalesce(p_urgente, false), v_obs, true)
  returning numero into v_numero;

  -- Nacen pendientes: las aprueba Subgerencia (Paquete A).
  insert into public.pedidos_insumos
    (grupo_pedido_id, presupuesto_item_id, item_apu_id, insumo_id, cantidad,
     fecha_requerida, urgente, observaciones, solicitado_por, estado)
  select v_id, v_item, null, x.insumo_id, x.cantidad,
         p_fecha_requerida, coalesce(p_urgente, false), v_obs, v_uid, 'pendiente'
    from jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric);

  if p_direccion_entrega is not null then
    perform public._fijar_direccion_requisicion(v_id, p_direccion_entrega);
  end if;

  perform public._evento_requisicion(v_id, 'creada', null,
    jsonb_build_object('numero', v_numero, 'insumos', v_total, 'administrativa', true));

  select codigo into v_codigo from public.requisiciones where id = v_id;
  insert into public.notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  select pf.id, 'requisicion_administrativa_por_aprobar', 'requisicion', v_id,
         case when coalesce(p_urgente, false) then 'Requisición administrativa URGENTE por aprobar'
              else 'Requisición administrativa por aprobar' end,
         'Requisición ' || v_codigo || ' (' || v_proyecto_txt || '): ' || v_total
           || case when v_total = 1 then ' insumo' else ' insumos' end || ' para el '
           || to_char(p_fecha_requerida, 'DD/MM/YYYY') || '.'
    from public.perfiles pf
    left join public.roles r on r.id = pf.rol_id
   where pf.id is distinct from v_uid
     and r.clave is distinct from 'administrador'
     and public.tiene_accion(pf.id, 'aprobar_requisiciones_administrativas')
     and public.usuario_puede_ver_proyecto(pf.id, v_proyecto);

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'codigo', v_codigo);
end;
$$;
revoke all on function public._crear_requisicion_administrativa(uuid, jsonb, date, boolean, text, text) from public, anon, authenticated;

-- La de siempre (la usa la app hasta el deploy): también queda pendiente.
create or replace function public.crear_requisicion_administrativa(
  p_proyecto_id uuid, p_lineas jsonb, p_fecha_requerida date, p_urgente boolean, p_observaciones text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._crear_requisicion_administrativa(p_proyecto_id, p_lineas, p_fecha_requerida, p_urgente, p_observaciones, null);
end;
$$;

create or replace function public.crear_requisicion_administrativa_con_direccion(
  p_proyecto_id uuid, p_lineas jsonb, p_fecha_requerida date, p_urgente boolean, p_observaciones text,
  p_direccion_entrega text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(coalesce(p_direccion_entrega, '')), '') is null then
    raise exception 'La dirección de entrega es obligatoria.';
  end if;
  return public._crear_requisicion_administrativa(p_proyecto_id, p_lineas, p_fecha_requerida, p_urgente, p_observaciones, p_direccion_entrega);
end;
$$;
revoke all on function public.crear_requisicion_administrativa_con_direccion(uuid, jsonb, date, boolean, text, text) from public, anon;
grant execute on function public.crear_requisicion_administrativa_con_direccion(uuid, jsonb, date, boolean, text, text) to authenticated;

-- Quien la hizo la cancela también mientras está por aprobar.
select pg_temp._parche('public.cancelar_requisicion_administrativa(uuid,text)'::regprocedure,
  $a$   where grupo_pedido_id = p_id and estado = 'aprobado';$a$,
  $b$   where grupo_pedido_id = p_id and estado in ('pendiente', 'aprobado');$b$);

-- Detalle para quien la pidió: dirección y quién la resolvió; cancelable
-- también por aprobar.
select pg_temp._parche('public.detalle_requisicion_administrativa(uuid)'::regprocedure,
  $a$    'cancelable', v_r.solicitado_por = v_uid and v_r.estado = 'aprobada'$a$,
  $b$    'cancelable', v_r.solicitado_por = v_uid and v_r.estado in ('pendiente', 'aprobada')$b$);
select pg_temp._parche('public.detalle_requisicion_administrativa(uuid)'::regprocedure,
  $a$    'created_at', v_r.created_at, 'es_mia', v_r.solicitado_por = v_uid,$a$,
  $b$    'created_at', v_r.created_at, 'es_mia', v_r.solicitado_por = v_uid,
    'direccion_entrega', v_r.direccion_entrega,
    'resolucion', (select jsonb_build_object('por', pf.nombre, 'at', p.resuelto_at, 'motivo', p.comentario_resolucion)
                     from public.pedidos_insumos p
                     left join public.perfiles pf on pf.id = p.resuelto_por
                    where p.grupo_pedido_id = p_id and p.resuelto_por is not null
                    order by p.resuelto_at desc
                    limit 1),$b$);

-- Aprobar / rechazar: el mismo resolver de las extraordinarias.
create or replace function public.resolver_requisicion(p_id uuid, p_estado text, p_comentario text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._exigir_proyecto(public._proyecto_de_requisicion(p_id));
  perform public._resolver_requisicion_sin_proyecto(p_id, p_estado, p_comentario);
end;
$$;

select pg_temp._parche('public._resolver_requisicion_sin_proyecto(uuid,text,text)'::regprocedure,
  $a$  elsif not public.tiene_accion(v_uid, 'aprobar_pedidos') then$a$,
  $b$  elsif v_h.administrativa then
    if not public.tiene_accion(v_uid, 'aprobar_requisiciones_administrativas') then
      raise exception 'No autorizado -- las requisiciones administrativas las aprueba Subgerencia.';
    end if;
  elsif not public.tiene_accion(v_uid, 'aprobar_pedidos') then$b$);

select pg_temp._parche('public._resolver_requisicion_sin_proyecto(uuid,text,text)'::regprocedure,
  $a$  v_nombre := case when v_h.extraordinaria then 'requisición extraordinaria' else 'requisición' end;$a$,
  $b$  v_nombre := case when v_h.extraordinaria then 'requisición extraordinaria'
                    when v_h.administrativa then 'requisición administrativa' else 'requisición' end;$b$);

select pg_temp._parche('public._resolver_requisicion_sin_proyecto(uuid,text,text)'::regprocedure,
  $a$    case p_estado when 'aprobado' then 'pedido_aprobado' else 'pedido_rechazado' end,$a$,
  $b$    case when v_h.administrativa then
           case p_estado when 'aprobado' then 'requisicion_administrativa_aprobada' else 'requisicion_administrativa_rechazada' end
         else case p_estado when 'aprobado' then 'pedido_aprobado' else 'pedido_rechazado' end end,$b$);

select pg_temp._parche('public._resolver_requisicion_sin_proyecto(uuid,text,text)'::regprocedure,
  $a$      case when p_estado = 'rechazado' then ' Motivo: ' || v_motivo else '' end
  );
$a$,
  $b$      case when p_estado = 'rechazado' then ' Motivo: ' || v_motivo else '' end
  );

  -- Administrativa aprobada: ahora sí pasa a Compras (Paquete A).
  if v_h.administrativa and p_estado = 'aprobado' then
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    select pf.id, 'requisicion_administrativa', 'requisicion', p_id,
           case when v_h.urgente then 'Requisición administrativa URGENTE por comprar' else 'Requisición administrativa por comprar' end,
           'Requisición ' || v_h.codigo || ' (' || coalesce(py.codigo || ' - ', '') || py.nombre || '): ' || v_n
             || case when v_n = 1 then ' insumo' else ' insumos' end || ' para el '
             || to_char(v_h.fecha_requerida, 'DD/MM/YYYY') || '. Aprobada por Subgerencia.'
      from perfiles pf
      left join roles r on r.id = pf.rol_id
      join proyectos py on py.id = v_h.proyecto_id
     where pf.id is distinct from v_uid
       and r.clave is distinct from 'administrador'
       and public.tiene_accion(pf.id, 'comprar')
       and public.usuario_puede_ver_proyecto(pf.id, v_h.proyecto_id);
  end if;
$b$);

-- Bandeja de Subgerencia.
create or replace function public.listar_requisiciones_administrativas_aprobacion(
  p_estado text default null, p_offset integer default 0, p_limite integer default 51
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_res jsonb;
begin
  if v_uid is null then raise exception 'No autenticado.'; end if;
  if not public.tiene_pestana(v_uid, 'tecnico.aprobar_administrativas') then
    raise exception 'No tienes acceso a Aprobación de requisiciones administrativas.';
  end if;

  with pagina as (
    select r.*,
           row_number() over (order by
             case when p_estado = 'pendiente' then r.urgente end desc nulls last,
             case when p_estado = 'pendiente' then r.created_at end asc,
             r.created_at desc,
             r.id) as ord
      from requisiciones r
     where r.administrativa
       and r.proyecto_id in (select public.proyectos_visibles(v_uid))
       and (p_estado is null or r.estado = p_estado)
     order by ord
     offset greatest(coalesce(p_offset, 0), 0)
     limit least(greatest(coalesce(p_limite, 51), 1), 201)
  ),
  lineas as (
    select p.grupo_pedido_id,
           jsonb_agg(jsonb_build_object(
             'id', p.id,
             'insumo_codigo', mi.codigo,
             'insumo_descripcion', mi.descripcion,
             'insumo_um', mi.u_m,
             'cantidad', p.cantidad,
             'estado', p.estado
           ) order by p.created_at, p.id) as lineas
      from pedidos_insumos p
      join pagina pg on pg.id = p.grupo_pedido_id
      left join maestro_insumos mi on mi.id = p.insumo_id
     group by p.grupo_pedido_id
  ),
  resolucion as (
    select distinct on (p.grupo_pedido_id) p.grupo_pedido_id, p.comentario_resolucion, p.resuelto_at, p.resuelto_por
      from pedidos_insumos p
      join pagina pg on pg.id = p.grupo_pedido_id
     where p.resuelto_por is not null
     order by p.grupo_pedido_id, p.resuelto_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pg.id,
           'codigo', pg.codigo,
           'proyecto_codigo', pr.codigo,
           'proyecto_nombre', pr.nombre,
           'funcionamiento', coalesce(pr.funcionamiento, false),
           'solicitante_nombre', sol.nombre,
           'created_at', pg.created_at,
           'fecha_requerida', pg.fecha_requerida,
           'urgente', pg.urgente,
           'estado', pg.estado,
           'observaciones', pg.observaciones,
           'direccion_entrega', pg.direccion_entrega,
           'motivo_resolucion', rs.comentario_resolucion,
           'resuelto_at', rs.resuelto_at,
           'resuelto_por_nombre', res.nombre,
           'lineas', coalesce(l.lineas, '[]'::jsonb)
         ) order by pg.ord), '[]'::jsonb)
    into v_res
    from pagina pg
    left join lineas l on l.grupo_pedido_id = pg.id
    left join resolucion rs on rs.grupo_pedido_id = pg.id
    left join proyectos pr on pr.id = pg.proyecto_id
    left join perfiles sol on sol.id = pg.solicitado_por
    left join perfiles res on res.id = rs.resuelto_por;

  return v_res;
end;
$$;
revoke all on function public.listar_requisiciones_administrativas_aprobacion(text, integer, integer) from public, anon;
grant execute on function public.listar_requisiciones_administrativas_aprobacion(text, integer, integer) to authenticated;

-- Mis pendientes: la bandeja de Subgerencia; las administrativas no van a
-- "Requisiciones por aprobar" (esa es de aprobar_pedidos).
select pg_temp._parche('public._pendientes_de(uuid)'::regprocedure,
  $a$   where v_aprobar_pedidos and r.estado = 'pendiente' and not r.extraordinaria and r.proyecto_id = any(v_proys)
$a$,
  $b$   where v_aprobar_pedidos and r.estado = 'pendiente' and not r.extraordinaria and not r.administrativa and r.proyecto_id = any(v_proys)
$b$);

select pg_temp._parche('public._pendientes_de(uuid)'::regprocedure,
  $a$
  -- ------------------------------------------------ Requisiciones por comprar
$a$,
  $b$
  -- ------------------------------------------------ Requisiciones administrativas por aprobar (Paquete A)
  union all
  select 'req_administrativa_por_aprobar', 'hacer', r.id, r.proyecto_id,
         'Requisición administrativa ' || r.codigo,
         r.n_lineas || case when r.n_lineas = 1 then ' insumo' else ' insumos' end
           || case when r.urgente then ' · urgente' else '' end,
         null::numeric, r.created_at, r.solicitado_por, r.fecha_requerida, '/almacen/aprobacion-requisiciones-administrativas'
    from requisiciones r
   where (select public.tiene_accion(p_uid, 'aprobar_requisiciones_administrativas'))
     and r.administrativa and r.estado = 'pendiente' and r.proyecto_id = any(v_proys)

  -- ------------------------------------------------ Requisiciones por comprar
$b$);

-- ===========================================================================
-- 3. Aviso cuando se aprueba un insumo nuevo
-- ===========================================================================
create or replace function public._notificar_insumo_aprobado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_presupuesto uuid;
  v_codigo text;
  v_proyecto text;
begin
  if not (old.estado = 'pendiente' and new.estado = 'aprobado') then
    return new;
  end if;
  if new.solicitado_por is null or new.solicitado_por = new.resuelto_por then
    return new;
  end if;

  select pi.presupuesto_id, pi.codigo, py.nombre
    into v_presupuesto, v_codigo, v_proyecto
  from presupuesto_items pi
  join presupuestos p on p.id = pi.presupuesto_id
  left join proyectos py on py.id = p.proyecto_id
  where pi.id = coalesce(
    new.presupuesto_item_id,
    (select r.presupuesto_item_id from apu_import_revision r where r.solicitud_id = new.id limit 1)
  );

  -- Del presupuesto: al presupuesto. Sin ítem (requisición administrativa):
  -- a Requisiciones administrativas (la campanita lo decide por entidad).
  perform public.notificar_una(
    new.solicitado_por,
    'insumo_aprobado',
    case when v_presupuesto is null then 'pedido_insumo' else 'presupuesto' end,
    coalesce(v_presupuesto, new.id),
    'Insumo nuevo aprobado',
    '"' || new.descripcion || '"'
      || coalesce(' (ítem ' || v_codigo || coalesce(' de ' || v_proyecto, '') || ')', '')
      || ' fue aprobado'
      || coalesce(' con el código ' || new.codigo_maestro_asignado::text, '')
      || '. Ya puedes hacer la requisición.'
  );
  return new;
end;
$$;
revoke all on function public._notificar_insumo_aprobado() from public, anon, authenticated;

drop trigger if exists trg_notificar_insumo_aprobado on public.solicitudes_insumos;
create trigger trg_notificar_insumo_aprobado
  after update of estado on public.solicitudes_insumos
  for each row execute function public._notificar_insumo_aprobado();

-- ===========================================================================
-- 4. Empresa que factura la orden de compra
-- ===========================================================================
alter table public.ordenes_compra add column if not exists empresa_id uuid references public.empresas(id);
create index if not exists ordenes_compra_empresa_id_idx on public.ordenes_compra (empresa_id);

-- Pagos de la orden: la empresa de la orden (si no tiene, la del proyecto).
select pg_temp._parche('public._crear_pagos_orden(uuid)'::regprocedure,
  $a$         py.empresa_id, e.consolidado_id, pr.nombre as proveedor_nombre,$a$,
  $b$         coalesce(oc.empresa_id, py.empresa_id) as empresa_id, e.consolidado_id, pr.nombre as proveedor_nombre,$b$);
select pg_temp._parche('public._crear_pagos_orden(uuid)'::regprocedure,
  $a$    left join public.empresas e on e.id = py.empresa_id$a$,
  $b$    left join public.empresas e on e.id = coalesce(oc.empresa_id, py.empresa_id)$b$);

create or replace function public._pago_sincronizar_empresa(p_pago_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.pagos p
     set empresa_id = x.empresa_id,
         consolidado_id = e.consolidado_id
    from (select pg.id, coalesce(oc.empresa_id, py.empresa_id) as empresa_id
            from public.pagos pg
            join public.proyectos py on py.id = pg.proyecto_id
            left join public.ordenes_compra oc on oc.id = pg.orden_compra_id
           where pg.id = p_pago_id) x
    left join public.empresas e on e.id = x.empresa_id
   where p.id = x.id
     and p.fuente <> 'requisicion_admin'
     and p.semana is null
     and p.estado in ('programado', 'solicitado', 'en_espera', 'aprobado')
$$;

create or replace function public._ordenes_de_consolidados_visibles(p_uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select o.id
    from public.ordenes_compra o
    join public.proyectos p on p.id = o.proyecto_id
    join public.empresas e on e.id = coalesce(o.empresa_id, p.empresa_id)
   where e.consolidado_id in (select public._consolidados_visibles(p_uid))
$$;

-- Saldo a favor: de la empresa de la orden.
select pg_temp._parche('public._aplicar_saldo_favor_orden(uuid,numeric)'::regprocedure,
  $a$  select o.id, o.estado, o.proveedor_id, o.saldo_favor_aplicado, p.empresa_id$a$,
  $b$  select o.id, o.estado, o.proveedor_id, o.saldo_favor_aplicado, coalesce(o.empresa_id, p.empresa_id) as empresa_id$b$);
select pg_temp._parche('public.cerrar_orden_con_faltante(uuid,text)'::regprocedure,
  $a$  select o.id, o.proyecto_id, o.proveedor_id, o.codigo, p.empresa_id$a$,
  $b$  select o.id, o.proyecto_id, o.proveedor_id, o.codigo, coalesce(o.empresa_id, p.empresa_id) as empresa_id$b$);

create or replace function public.saldos_favor_proveedor_empresa(p_proveedor_id uuid, p_proyecto_id uuid, p_empresa_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.tiene_accion(auth.uid(), 'comprar') then
    raise exception 'No autorizado -- solo Compras usa saldos a favor.';
  end if;
  perform public._exigir_proyecto(p_proyecto_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'disponible', public._saldo_favor_disponible(s.id),
                                        'orden_origen', o.codigo, 'creado_at', s.created_at) order by s.created_at)
      from proveedor_saldos_favor s
      left join ordenes_compra o on o.id = s.orden_origen_id
     where s.proveedor_id = p_proveedor_id
       and s.empresa_id is not distinct from p_empresa_id
       and s.cerrado_at is null
       and public._saldo_favor_disponible(s.id) > 0), '[]'::jsonb);
end;
$$;
revoke all on function public.saldos_favor_proveedor_empresa(uuid, uuid, uuid) from public, anon;
grant execute on function public.saldos_favor_proveedor_empresa(uuid, uuid, uuid) to authenticated;

-- Crear la orden con la empresa que factura (y, si se usa, el saldo a favor).
create or replace function public.crear_orden_compra_empresa(
  p_proyecto_id uuid, p_proveedor_id uuid, p_sitio_entrega text, p_fecha_entrega date, p_contacto_nombre text,
  p_telefono text, p_ciudad text, p_email text, p_condiciones_pago text, p_observaciones text,
  p_lineas jsonb, p_soporte jsonb, p_empresa_id uuid,
  p_saldo_favor numeric default null,
  p_anticipo_porcentaje numeric default null, p_saldo_modo text default null, p_saldo_fecha date default null,
  p_titular jsonb default null, p_pago jsonb default null, p_tipo_pago text default null,
  p_fecha_pago_credito date default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_p record;
begin
  if p_empresa_id is null then
    raise exception 'Elige la empresa que factura.';
  end if;
  if not exists (select 1 from empresas where id = p_empresa_id) then
    raise exception 'La empresa que factura no existe.';
  end if;
  v_id := public.crear_orden_compra_con_soporte(
    p_proyecto_id => p_proyecto_id, p_proveedor_id => p_proveedor_id, p_sitio_entrega => p_sitio_entrega,
    p_fecha_entrega => p_fecha_entrega, p_contacto_nombre => p_contacto_nombre, p_telefono => p_telefono,
    p_ciudad => p_ciudad, p_email => p_email, p_condiciones_pago => p_condiciones_pago,
    p_observaciones => p_observaciones, p_lineas => p_lineas, p_soporte => p_soporte,
    p_anticipo_porcentaje => p_anticipo_porcentaje, p_saldo_modo => p_saldo_modo, p_saldo_fecha => p_saldo_fecha,
    p_titular => p_titular, p_pago => p_pago, p_tipo_pago => p_tipo_pago, p_fecha_pago_credito => p_fecha_pago_credito);

  update ordenes_compra set empresa_id = p_empresa_id where id = v_id;
  for v_p in select id from pagos where orden_compra_id = v_id loop
    perform public._pago_sincronizar_empresa(v_p.id);
  end loop;

  if coalesce(p_saldo_favor, 0) > 0 then
    perform public._aplicar_saldo_favor_orden(v_id, p_saldo_favor);
  end if;
  return v_id;
end;
$$;
revoke all on function public.crear_orden_compra_empresa(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, uuid, numeric, numeric, text, date, jsonb, jsonb, text, date) from public, anon;
grant execute on function public.crear_orden_compra_empresa(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, uuid, numeric, numeric, text, date, jsonb, jsonb, text, date) to authenticated;

commit;
