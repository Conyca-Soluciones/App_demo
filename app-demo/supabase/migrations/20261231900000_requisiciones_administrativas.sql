-- =============================================================================
-- Requisiciones administrativas: lo que compra Compras para FUNCIONAMIENTO
-- (decisiones del usuario, 2026-11-06).
--
-- (Lo que antes se llamaba "requisiciones administrativas" ahora es "Pagos
-- administrativos": 20261231800000.)
--
-- - Se piden para FUNCIONAMIENTO o para un proyecto (decisión del usuario): el
--   que las hace elige FUNCIONAMIENTO o uno de sus proyectos con presupuesto.
-- - Proyecto FUNCIONAMIENTO (código 000, número 000, empresa Conyca Soluciones
--   SAS -> Consolidado): los pedidos que no son de una obra. proyectos.funcionamiento
--   lo marca.
-- - pedidos_insumos exige un ítem: cada presupuesto tiene un ítem oculto "000"
--   SIN VERSIÓN (version_id null) al que van estas líneas. No sale en la tabla
--   del presupuesto ni se copia a versiones nuevas (todo eso filtra por versión),
--   no suma al valor y no tiene cupo; en Control del proyecto lo comprado sale
--   "sin ítem". Se crea la primera vez que se necesita
--   (_item_requisicion_administrativa). Así no se toca Compras, órdenes,
--   entradas, inventario ni pagos.
-- - Las hace CUALQUIER usuario con sesión (A&F › Administrativo, ruta libre),
--   con el mismo formulario de las técnicas: fecha requerida, insumos del
--   maestro (si no está, se solicita como en presupuestos), urgente y
--   observaciones.
-- - No tienen presupuesto (no revisan cupo) y NADIE las aprueba: nacen
--   aprobadas y van directo a Compras (Requisiciones por comprar, proyecto
--   FUNCIONAMIENTO). requisiciones.administrativa las marca; Aprobación de
--   requisiciones no las ve y no se pueden aprobar, rechazar ni desaprobar.
-- - Compras y Almacén ven FUNCIONAMIENTO sin que se lo asignen (acciones comprar
--   o gestionar_almacen), para comprarlas y recibirlas.
-- - Sus compras entran al precio dinámico de los insumos como cualquier OC
--   aprobada (precios_efectivos_insumos no filtra por proyecto).
-- =============================================================================

-- 1. Proyecto FUNCIONAMIENTO ---------------------------------------------------------

alter table public.proyectos drop constraint if exists proyectos_numero_rango;
alter table public.proyectos add constraint proyectos_numero_rango check (numero between 0 and 999);
alter table public.proyectos add column if not exists funcionamiento boolean not null default false;
create unique index if not exists proyectos_funcionamiento_unico on public.proyectos (funcionamiento) where funcionamiento;

alter table public.requisiciones add column if not exists administrativa boolean not null default false;

do $$
declare
  v_proyecto uuid;
  v_empresa uuid;
  v_presupuesto uuid;
  v_version uuid;
begin
  select id into v_proyecto from public.proyectos where funcionamiento;
  if v_proyecto is null then
    select e.id into v_empresa from public.empresas e
     where e.razon_social = 'Conyca Soluciones SAS' and e.consolidado_id is not null
     order by e.id limit 1;
    insert into public.proyectos (nombre, codigo, numero, empresa_id, funcionamiento)
    values ('FUNCIONAMIENTO', '000', 0, v_empresa, true)
    returning id into v_proyecto;
  end if;

  select id into v_presupuesto from public.presupuestos where proyecto_id = v_proyecto;
  if v_presupuesto is null then
    insert into public.presupuestos (proyecto_id, nombre, monto_total, estado)
    values (v_proyecto, 'FUNCIONAMIENTO', 0, 'En ejecucion')
    returning id into v_presupuesto;
    insert into public.presupuesto_versiones (presupuesto_id, numero, nombre)
    values (v_presupuesto, 1, 'Funcionamiento')
    returning id into v_version;
    update public.presupuestos set version_actual_id = v_version where id = v_presupuesto;
  end if;
end;
$$;

-- El ítem oculto (sin versión) del presupuesto del proyecto al que van las
-- líneas de las requisiciones administrativas; lo crea si no existe. Null si el
-- proyecto no tiene presupuesto.
create or replace function public._item_requisicion_administrativa(p_proyecto_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_presupuesto uuid;
  v_funcionamiento boolean;
  v_item uuid;
begin
  select pr.id, p.funcionamiento into v_presupuesto, v_funcionamiento
    from public.proyectos p
    join public.presupuestos pr on pr.proyecto_id = p.id
   where p.id = p_proyecto_id;
  if v_presupuesto is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('item_req_administrativa:' || v_presupuesto::text));
  select id into v_item from public.presupuesto_items
   where presupuesto_id = v_presupuesto and version_id is null and codigo = '000';
  if v_item is null then
    insert into public.presupuesto_items (presupuesto_id, version_id, nivel, codigo, descripcion, unidad, cantidad, valor_unitario, valor_total)
    values (v_presupuesto, null, 1, '000',
            case when v_funcionamiento then 'Gastos de funcionamiento' else 'Requisiciones administrativas' end,
            'GL', 0, 0, 0)
    returning id into v_item;
  end if;
  return v_item;
end;
$$;

revoke all on function public._item_requisicion_administrativa(uuid) from public, anon, authenticated;

select public._item_requisicion_administrativa(id) from public.proyectos where funcionamiento;

-- Para dónde se puede pedir: FUNCIONAMIENTO (primero) y los proyectos que la
-- persona ve y que tienen presupuesto.
create or replace function public.proyectos_requisicion_administrativa()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'codigo', p.codigo, 'nombre', p.nombre, 'funcionamiento', p.funcionamiento
         ) order by p.funcionamiento desc, p.codigo, p.nombre), '[]'::jsonb)
    from public.proyectos p
   where exists (select 1 from public.presupuestos pr where pr.proyecto_id = p.id)
     and (p.funcionamiento or p.id in (select public.proyectos_visibles(auth.uid())))
$$;

revoke all on function public.proyectos_requisicion_administrativa() from public, anon;
grant execute on function public.proyectos_requisicion_administrativa() to authenticated;

-- 2. Compras y Almacén ven FUNCIONAMIENTO -------------------------------------------

create or replace function public.proyectos_visibles(p_usuario_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.proyectos p
  where public.es_admin(p_usuario_id) or public.usuario_ve_todos_proyectos(p_usuario_id)
  union
  select up.proyecto_id from public.usuario_proyectos up where up.usuario_id = p_usuario_id
  union
  select gp.proyecto_id
  from public.perfiles pf
  join public.usuario_grupos ug on ug.usuario_id = pf.id
  join public.grupo_proyectos gp on gp.grupo_id = ug.grupo_id
  where pf.id = p_usuario_id and pf.rol_id is null
  union
  -- FUNCIONAMIENTO: quien compra o recibe en almacén (20261231900000).
  select p.id from public.proyectos p
  where p.funcionamiento
    and (public.tiene_accion(p_usuario_id, 'comprar') or public.tiene_accion(p_usuario_id, 'gestionar_almacen'))
$$;

create or replace function public.usuario_puede_ver_proyecto(p_usuario_id uuid, p_proyecto_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.es_admin(p_usuario_id)
    or public.usuario_ve_todos_proyectos(p_usuario_id)
    or exists (
      select 1 from public.usuario_proyectos up
      where up.usuario_id = p_usuario_id and up.proyecto_id = p_proyecto_id
    )
    -- Los grupos solo cuentan para usuarios que todavía no tienen rol.
    or exists (
      select 1
      from public.perfiles pf
      join public.usuario_grupos ug on ug.usuario_id = pf.id
      join public.grupo_proyectos gp on gp.grupo_id = ug.grupo_id
      where pf.id = p_usuario_id and pf.rol_id is null and gp.proyecto_id = p_proyecto_id
    )
    -- FUNCIONAMIENTO: quien compra o recibe en almacén (20261231900000).
    or (exists (select 1 from public.proyectos p where p.id = p_proyecto_id and p.funcionamiento)
        and (public.tiene_accion(p_usuario_id, 'comprar') or public.tiene_accion(p_usuario_id, 'gestionar_almacen')))
$$;

-- 3. No se aprueban ni se desaprueban -------------------------------------------------

create or replace function public.resolver_requisicion(p_id uuid, p_estado text, p_comentario text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.requisiciones where id = p_id and administrativa) then
    raise exception 'Las requisiciones administrativas no se aprueban: van directo a Compras.';
  end if;
  perform public._exigir_proyecto(public._proyecto_de_requisicion(p_id));
  perform public._resolver_requisicion_sin_proyecto(p_id, p_estado, p_comentario);
end;
$$;

create or replace function public.desaprobar_requisicion(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.requisiciones where id = p_id and administrativa) then
    raise exception 'Las requisiciones administrativas no se desaprueban: quien la hizo la puede cancelar mientras no se haya comprado nada.';
  end if;
  perform public._exigir_proyecto(public._proyecto_de_requisicion(p_id));
  perform public._desaprobar_requisicion_sin_proyecto(p_id, p_motivo);
end;
$$;

-- 4. Avisos a Compras -------------------------------------------------------------------

alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo = any (array[
  'pedido_rechazado', 'pedido_aprobado', 'orden_compra_rechazada', 'orden_compra_aprobada', 'insumo_sobre_presupuesto',
  'orden_compra_precio_sobre_efectivo', 'contrato_por_revisar', 'contrato_aprobado', 'contrato_devuelto', 'contrato_rechazado',
  'acta_aprobada', 'acta_rechazada', 'minuta_por_revisar', 'minuta_aprobada', 'minuta_devuelta', 'contrato_vencido',
  'contrato_vencido_juridica', 'insumo_rechazado', 'otrosi_por_revisar', 'otrosi_por_aprobar', 'otrosi_devuelto',
  'otrosi_rechazado', 'otrosi_aprobado', 'otrosi_devuelto_subgerencia', 'poliza_pendiente', 'poliza_por_revisar',
  'poliza_aprobada', 'poliza_devuelta', 'requisicion_admin_aprobada', 'requisicion_admin_rechazada',
  'requisicion_extraordinaria', 'requisicion_administrativa'
]::text[])) not valid;

-- 5. Crear ----------------------------------------------------------------------------
-- p_proyecto_id: FUNCIONAMIENTO o un proyecto que la persona ve.
-- p_lineas: [{insumo_id, cantidad}] (cantidades enteras, máx. 50, sin repetir insumo).

create or replace function public.crear_requisicion_administrativa(
  p_proyecto_id uuid, p_lineas jsonb, p_fecha_requerida date, p_urgente boolean, p_observaciones text
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

  -- Nacen aprobadas: van directo a Compras.
  insert into public.pedidos_insumos
    (grupo_pedido_id, presupuesto_item_id, item_apu_id, insumo_id, cantidad,
     fecha_requerida, urgente, observaciones, solicitado_por, estado, resuelto_at)
  select v_id, v_item, null, x.insumo_id, x.cantidad,
         p_fecha_requerida, coalesce(p_urgente, false), v_obs, v_uid, 'aprobado', now()
    from jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric);

  perform public._evento_requisicion(v_id, 'creada', null,
    jsonb_build_object('numero', v_numero, 'insumos', v_total, 'administrativa', true));

  insert into public.notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  select pf.id, 'requisicion_administrativa', 'requisicion', v_id,
         case when coalesce(p_urgente, false) then 'Requisición administrativa URGENTE por comprar' else 'Requisición administrativa por comprar' end,
         'Requisición #' || v_numero || ' (' || v_proyecto_txt || '): ' || v_total
           || case when v_total = 1 then ' insumo' else ' insumos' end || ' para el '
           || to_char(p_fecha_requerida, 'DD/MM/YYYY') || '.'
    from public.perfiles pf
    left join public.roles r on r.id = pf.rol_id
   where pf.id is distinct from v_uid
     and r.clave is distinct from 'administrador'
     and public.tiene_accion(pf.id, 'comprar')
     and public.usuario_puede_ver_proyecto(pf.id, v_proyecto);

  return jsonb_build_object('id', v_id, 'numero', v_numero);
end;
$$;

revoke all on function public.crear_requisicion_administrativa(uuid, jsonb, date, boolean, text) from public, anon;
grant execute on function public.crear_requisicion_administrativa(uuid, jsonb, date, boolean, text) to authenticated;

-- 6. Mis requisiciones administrativas (quien las hizo no tiene que ver el
--    proyecto) ---------------------------------------------------------------------

create or replace function public.listar_requisiciones_administrativas(p_offset integer default 0, p_limite integer default 51)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Inicia sesión.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'numero', r.numero, 'estado', r.estado, 'estado_compra', r.estado_compra,
             'n_lineas', r.n_lineas, 'fecha_requerida', r.fecha_requerida, 'urgente', r.urgente,
             'observaciones', r.observaciones, 'created_at', r.created_at,
             'proyecto', (select coalesce(p.codigo || ' - ', '') || p.nombre from public.proyectos p where p.id = r.proyecto_id)
           ) order by r.created_at desc, r.id)
      from (select * from public.requisiciones x
             where x.administrativa and x.solicitado_por = v_uid
             order by x.created_at desc, x.id
             offset greatest(coalesce(p_offset, 0), 0)
             limit least(greatest(coalesce(p_limite, 51), 1), 101)) r
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.listar_requisiciones_administrativas(integer, integer) from public, anon;
grant execute on function public.listar_requisiciones_administrativas(integer, integer) to authenticated;

-- Detalle: quien la hizo, o quien ve el proyecto.
create or replace function public.detalle_requisicion_administrativa(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_r record;
begin
  select * into v_r from public.requisiciones where id = p_id and administrativa;
  if v_r.id is null
     or (v_r.solicitado_por is distinct from v_uid and not public.usuario_puede_ver_proyecto(v_uid, v_r.proyecto_id)) then
    raise exception 'La requisición no existe o no tienes acceso.';
  end if;
  return jsonb_build_object(
    'id', v_r.id, 'numero', v_r.numero, 'estado', v_r.estado, 'estado_compra', v_r.estado_compra,
    'fecha_requerida', v_r.fecha_requerida, 'urgente', v_r.urgente, 'observaciones', v_r.observaciones,
    'created_at', v_r.created_at, 'es_mia', v_r.solicitado_por = v_uid,
    'proyecto', (select coalesce(p.codigo || ' - ', '') || p.nombre from public.proyectos p where p.id = v_r.proyecto_id),
    'solicitante', (select nombre from public.perfiles where id = v_r.solicitado_por),
    'cancelable', v_r.solicitado_por = v_uid and v_r.estado = 'aprobada'
                  and not exists (select 1 from public.pedidos_insumos p
                                    join public.ordenes_compra_items oci on oci.pedido_insumo_id = p.id
                                    join public.ordenes_compra oc on oc.id = oci.orden_compra_id
                                   where p.grupo_pedido_id = p_id and oc.estado not in ('cancelada', 'rechazada')),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'insumo_codigo', mi.codigo, 'insumo_descripcion', mi.descripcion,
               'unidad', coalesce(p.unidad, mi.u_m), 'cantidad', p.cantidad, 'estado', p.estado,
               'comprado', coalesce((select sum(oci.cantidad * oci.factor_unidad)
                                       from public.ordenes_compra_items oci
                                       join public.ordenes_compra oc on oc.id = oci.orden_compra_id
                                      where oci.pedido_insumo_id = p.id and oc.estado not in ('cancelada', 'rechazada')), 0),
               'rechazado_compras', p.rechazado_compras_at is not null
             ) order by mi.descripcion)
        from public.pedidos_insumos p
        join public.maestro_insumos mi on mi.id = p.insumo_id
       where p.grupo_pedido_id = p_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.detalle_requisicion_administrativa(uuid) from public, anon;
grant execute on function public.detalle_requisicion_administrativa(uuid) to authenticated;

-- 7. Cancelar: quien la hizo, mientras no haya nada en órdenes de compra vigentes.

create or replace function public.cancelar_requisicion_administrativa(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_h record;
  v_motivo text := nullif(trim(p_motivo), '');
  v_n int;
begin
  if v_motivo is null then raise exception 'El motivo de cancelación es obligatorio.'; end if;
  select * into v_h from public.requisiciones where id = p_id and administrativa for update;
  if not found then raise exception 'La requisición no existe.'; end if;
  if v_h.solicitado_por is distinct from v_uid then
    raise exception 'Solo quien hizo la requisición puede cancelarla.';
  end if;
  perform 1 from public.pedidos_insumos where grupo_pedido_id = p_id for update;
  if exists (select 1 from public.pedidos_insumos p
               join public.ordenes_compra_items oci on oci.pedido_insumo_id = p.id
               join public.ordenes_compra oc on oc.id = oci.orden_compra_id
              where p.grupo_pedido_id = p_id and oc.estado not in ('cancelada', 'rechazada')) then
    raise exception 'Compras ya hizo una orden de compra con esta requisición: ya no se puede cancelar.';
  end if;
  update public.pedidos_insumos
     set estado = 'cancelado', cancelado_por = v_uid, cancelado_at = now(), motivo_cancelacion = v_motivo
   where grupo_pedido_id = p_id and estado = 'aprobado';
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'La requisición ya no está activa.'; end if;
  perform public._evento_requisicion(p_id, 'cancelada', v_motivo, jsonb_build_object('insumos', v_n));
end;
$$;

revoke all on function public.cancelar_requisicion_administrativa(uuid, text) from public, anon;
grant execute on function public.cancelar_requisicion_administrativa(uuid, text) to authenticated;
