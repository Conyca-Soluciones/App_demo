-- Reversa de 20261231999400_paquete_a_requisiciones.sql.
-- Deshace los parches (texto nuevo -> texto de antes) y quita lo agregado.
-- Las columnas requisiciones.direccion_entrega y ordenes_compra.empresa_id se
-- dejan (borrarlas perdería datos): sin las funciones nuevas nadie las escribe
-- y, con los parches deshechos, la empresa vuelve a salir del proyecto.
-- Las requisiciones administrativas que queden pendientes hay que resolverlas
-- antes (o aprobar sus líneas a mano).

begin;

create or replace function pg_temp._deshacer(p_fn regprocedure, p_nuevo text, p_viejo text)
returns void
language plpgsql
as $$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  p_nuevo := replace(p_nuevo, E'\r\n', E'\n');
  p_viejo := replace(p_viejo, E'\r\n', E'\n');
  if position(p_nuevo in d) = 0 then
    return;
  end if;
  execute replace(d, p_nuevo, p_viejo);
end;
$$;

-- 4. Empresa que factura
drop function if exists public.crear_orden_compra_empresa(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, uuid, numeric, numeric, text, date, jsonb, jsonb, text, date);
drop function if exists public.saldos_favor_proveedor_empresa(uuid, uuid, uuid);

select pg_temp._deshacer('public.cerrar_orden_con_faltante(uuid,text)'::regprocedure,
  $b$  select o.id, o.proyecto_id, o.proveedor_id, o.codigo, coalesce(o.empresa_id, p.empresa_id) as empresa_id$b$,
  $a$  select o.id, o.proyecto_id, o.proveedor_id, o.codigo, p.empresa_id$a$);
select pg_temp._deshacer('public._aplicar_saldo_favor_orden(uuid,numeric)'::regprocedure,
  $b$  select o.id, o.estado, o.proveedor_id, o.saldo_favor_aplicado, coalesce(o.empresa_id, p.empresa_id) as empresa_id$b$,
  $a$  select o.id, o.estado, o.proveedor_id, o.saldo_favor_aplicado, p.empresa_id$a$);
select pg_temp._deshacer('public._crear_pagos_orden(uuid)'::regprocedure,
  $b$         coalesce(oc.empresa_id, py.empresa_id) as empresa_id, e.consolidado_id, pr.nombre as proveedor_nombre,$b$,
  $a$         py.empresa_id, e.consolidado_id, pr.nombre as proveedor_nombre,$a$);
select pg_temp._deshacer('public._crear_pagos_orden(uuid)'::regprocedure,
  $b$    left join public.empresas e on e.id = coalesce(oc.empresa_id, py.empresa_id)$b$,
  $a$    left join public.empresas e on e.id = py.empresa_id$a$);

create or replace function public._pago_sincronizar_empresa(p_pago_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.pagos p
     set empresa_id = py.empresa_id,
         consolidado_id = e.consolidado_id
    from public.proyectos py
    left join public.empresas e on e.id = py.empresa_id
   where p.id = p_pago_id
     and py.id = p.proyecto_id
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
    join public.empresas e on e.id = p.empresa_id
   where e.consolidado_id in (select public._consolidados_visibles(p_uid))
$$;

-- 3. Aviso de insumo aprobado
drop trigger if exists trg_notificar_insumo_aprobado on public.solicitudes_insumos;
drop function if exists public._notificar_insumo_aprobado();

-- 2. Aprobación de Subgerencia
select pg_temp._deshacer('public._pendientes_de(uuid)'::regprocedure,
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
$b$,
  $a$
$a$);
select pg_temp._deshacer('public._pendientes_de(uuid)'::regprocedure,
  $b$and not r.extraordinaria and not r.administrativa and r.proyecto_id = any(v_proys)$b$,
  $a$and not r.extraordinaria and r.proyecto_id = any(v_proys)$a$);

drop function if exists public.listar_requisiciones_administrativas_aprobacion(text, integer, integer);

select pg_temp._deshacer('public._resolver_requisicion_sin_proyecto(uuid,text,text)'::regprocedure,
  $b$

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
$b$,
  $a$
$a$);
select pg_temp._deshacer('public._resolver_requisicion_sin_proyecto(uuid,text,text)'::regprocedure,
  $b$    case when v_h.administrativa then
           case p_estado when 'aprobado' then 'requisicion_administrativa_aprobada' else 'requisicion_administrativa_rechazada' end
         else case p_estado when 'aprobado' then 'pedido_aprobado' else 'pedido_rechazado' end end,$b$,
  $a$    case p_estado when 'aprobado' then 'pedido_aprobado' else 'pedido_rechazado' end,$a$);
select pg_temp._deshacer('public._resolver_requisicion_sin_proyecto(uuid,text,text)'::regprocedure,
  $b$  v_nombre := case when v_h.extraordinaria then 'requisición extraordinaria'
                    when v_h.administrativa then 'requisición administrativa' else 'requisición' end;$b$,
  $a$  v_nombre := case when v_h.extraordinaria then 'requisición extraordinaria' else 'requisición' end;$a$);
select pg_temp._deshacer('public._resolver_requisicion_sin_proyecto(uuid,text,text)'::regprocedure,
  $b$  elsif v_h.administrativa then
    if not public.tiene_accion(v_uid, 'aprobar_requisiciones_administrativas') then
      raise exception 'No autorizado -- las requisiciones administrativas las aprueba Subgerencia.';
    end if;
  elsif not public.tiene_accion(v_uid, 'aprobar_pedidos') then$b$,
  $a$  elsif not public.tiene_accion(v_uid, 'aprobar_pedidos') then$a$);

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

select pg_temp._deshacer('public.detalle_requisicion_administrativa(uuid)'::regprocedure,
  $b$
    'direccion_entrega', v_r.direccion_entrega,
    'resolucion', (select jsonb_build_object('por', pf.nombre, 'at', p.resuelto_at, 'motivo', p.comentario_resolucion)
                     from public.pedidos_insumos p
                     left join public.perfiles pf on pf.id = p.resuelto_por
                    where p.grupo_pedido_id = p_id and p.resuelto_por is not null
                    order by p.resuelto_at desc
                    limit 1),$b$,
  $a$$a$);
select pg_temp._deshacer('public.detalle_requisicion_administrativa(uuid)'::regprocedure,
  $b$    'cancelable', v_r.solicitado_por = v_uid and v_r.estado in ('pendiente', 'aprobada')$b$,
  $a$    'cancelable', v_r.solicitado_por = v_uid and v_r.estado = 'aprobada'$a$);
select pg_temp._deshacer('public.cancelar_requisicion_administrativa(uuid,text)'::regprocedure,
  $b$   where grupo_pedido_id = p_id and estado in ('pendiente', 'aprobado');$b$,
  $a$   where grupo_pedido_id = p_id and estado = 'aprobado';$a$);

-- crear_requisicion_administrativa vuelve a crear aprobadas y avisar a Compras.
create or replace function public.crear_requisicion_administrativa(
  p_proyecto_id uuid, p_lineas jsonb, p_fecha_requerida date, p_urgente boolean, p_observaciones text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_id uuid;
begin
  r := public._crear_requisicion_administrativa(p_proyecto_id, p_lineas, p_fecha_requerida, p_urgente, p_observaciones, null);
  v_id := (r ->> 'id')::uuid;
  update public.pedidos_insumos set estado = 'aprobado', resuelto_at = now()
   where grupo_pedido_id = v_id and estado = 'pendiente';
  delete from public.notificaciones where entidad_id = v_id and tipo = 'requisicion_administrativa_por_aprobar';
  insert into public.notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  select pf.id, 'requisicion_administrativa', 'requisicion', v_id,
         case when coalesce(p_urgente, false) then 'Requisición administrativa URGENTE por comprar' else 'Requisición administrativa por comprar' end,
         'Requisición ' || (r ->> 'codigo') || ' para el ' || to_char(p_fecha_requerida, 'DD/MM/YYYY') || '.'
    from public.perfiles pf
    left join public.roles ro on ro.id = pf.rol_id
   where pf.id is distinct from auth.uid()
     and ro.clave is distinct from 'administrador'
     and public.tiene_accion(pf.id, 'comprar')
     and public.usuario_puede_ver_proyecto(pf.id, p_proyecto_id);
  return r;
end;
$$;
drop function if exists public.crear_requisicion_administrativa_con_direccion(uuid, jsonb, date, boolean, text, text);

select pg_temp._deshacer('public.usuario_puede_ver_proyecto(uuid,uuid)'::regprocedure,
  $b$        and (public.tiene_accion(p_usuario_id, 'comprar') or public.tiene_accion(p_usuario_id, 'gestionar_almacen')
             or public.tiene_accion(p_usuario_id, 'aprobar_requisiciones_administrativas')))$b$,
  $a$        and (public.tiene_accion(p_usuario_id, 'comprar') or public.tiene_accion(p_usuario_id, 'gestionar_almacen')))$a$);
select pg_temp._deshacer('public.proyectos_visibles(uuid)'::regprocedure,
  $b$    and (public.tiene_accion(p_usuario_id, 'comprar') or public.tiene_accion(p_usuario_id, 'gestionar_almacen')
         or public.tiene_accion(p_usuario_id, 'aprobar_requisiciones_administrativas'))$b$,
  $a$    and (public.tiene_accion(p_usuario_id, 'comprar') or public.tiene_accion(p_usuario_id, 'gestionar_almacen'))$a$);

delete from public.rol_permisos
 where permiso in ('tab.tecnico.aprobar_administrativas', 'accion.aprobar_requisiciones_administrativas');

-- 1. Dirección de entrega
drop function if exists public.modificar_requisicion_con_direccion(uuid, jsonb, date, boolean, text, text);
drop function if exists public.crear_requisicion_extraordinaria_con_direccion(jsonb, date, boolean, text, text);
drop function if exists public.crear_requisicion_con_direccion(jsonb, date, boolean, text, text, text);
-- _fijar_direccion_requisicion y _crear_requisicion_administrativa se dejan:
-- la segunda la usa crear_requisicion_administrativa de arriba.
-- requisiciones_vista conserva las dos columnas nuevas al final (no estorban).

commit;
