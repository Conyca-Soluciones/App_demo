-- listar_ordenes_entradas (20261012050000, de lcpr) + el filtro por PROYECTO
-- ACTUAL que Entradas ya tenía en spr (20261010200000): sin él, la lista
-- paginada nueva volvía a mostrar las órdenes de todos los proyectos.
--
-- p_proyecto_id: con proyecto, solo sus órdenes y se exige poder verlo (la
-- función es SECURITY DEFINER). null = todas, como antes.
-- Se borra la firma sin proyecto: dos versiones con valores por defecto serían
-- ambiguas para PostgREST.

drop function if exists public.listar_ordenes_entradas(integer, text, uuid, text, timestamptz, timestamptz, integer, integer);

create or replace function public.listar_ordenes_entradas(
  p_proyecto_id uuid default null,
  p_numero integer default null,
  p_proveedor text default null,
  p_usuario uuid default null,
  p_estado text default null,
  p_desde timestamptz default null,
  p_hasta timestamptz default null,
  p_limite integer default 51,
  p_offset integer default 0
)
returns table (
  id uuid,
  numero integer,
  estado_entrega text,
  proyecto_codigo text,
  proyecto_nombre text,
  proveedor_nombre text,
  entrada_at timestamptz,
  entrada_por text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_filtra_entrada boolean := p_usuario is not null or p_desde is not null or p_hasta is not null;
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para gestionar entradas de almacén.';
  end if;
  if p_proyecto_id is not null and not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes acceso a este proyecto.';
  end if;

  return query
  select
    o.id,
    o.numero::integer,
    o.estado_entrega::text,
    pr.codigo::text,
    pr.nombre::text,
    pv.nombre::text,
    ult.created_at,
    ult.nombre
  from ordenes_compra o
  join proyectos pr on pr.id = o.proyecto_id
  left join proveedores pv on pv.unique_id = o.proveedor_id
  left join lateral (
    select e.created_at, pf.nombre::text as nombre
    from entradas_almacen e
    left join perfiles pf on pf.id = e.recibido_por
    where e.orden_compra_id = o.id
      and e.anulada_at is null
      and (p_usuario is null or e.recibido_por = p_usuario)
      and (p_desde is null or e.created_at >= p_desde)
      and (p_hasta is null or e.created_at <= p_hasta)
    order by e.created_at desc, e.id desc
    limit 1
  ) ult on true
  where o.estado = 'aprobada'
    and (p_proyecto_id is null or o.proyecto_id = p_proyecto_id)
    and (p_numero is null or o.numero = p_numero)
    and (p_proveedor is null or p_proveedor = '' or pv.nombre ilike '%' || p_proveedor || '%')
    and (
      p_estado is null
      or (p_estado = 'por_recibir' and o.estado_entrega in ('sin_entregar', 'entrega_parcial'))
      or (p_estado <> 'por_recibir' and o.estado_entrega = p_estado)
    )
    and (not v_filtra_entrada or ult.created_at is not null)
  order by o.numero desc
  limit greatest(p_limite, 1) offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.listar_ordenes_entradas(uuid, integer, text, uuid, text, timestamptz, timestamptz, integer, integer)
  from public, anon;
grant execute on function public.listar_ordenes_entradas(uuid, integer, text, uuid, text, timestamptz, timestamptz, integer, integer)
  to authenticated;
