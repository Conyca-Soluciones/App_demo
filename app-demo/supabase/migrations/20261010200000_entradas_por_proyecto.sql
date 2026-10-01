-- Entradas filtradas por el proyecto actual (selector del encabezado, igual que
-- Inventario y Salidas).
--
-- listar_ordenes_para_entrada recibe p_proyecto_id. Con proyecto, solo
-- devuelve sus órdenes y exige poder ver ese proyecto (la función es SECURITY
-- DEFINER: sin este chequeo, cualquiera con permiso de entradas vería las
-- órdenes de un proyecto ajeno pidiendo su id). Sin proyecto (null) se
-- comporta como antes: todas las órdenes.
--
-- Filtrar aquí y no en la Server Action también evita traer todas las órdenes
-- de todos los proyectos para descartarlas después (y el corte de 1000 filas
-- de la API cuando haya muchas).
--
-- Se borra la versión de un parámetro: dos versiones con valores por defecto
-- serían ambiguas para PostgREST.

drop function if exists public.listar_ordenes_para_entrada(boolean);

create or replace function public.listar_ordenes_para_entrada(
  p_incluir_entregadas boolean default false,
  p_proyecto_id uuid default null
)
returns table(
  id uuid, numero integer, estado_entrega text, proyecto_codigo text, proyecto_nombre text,
  proveedor_nombre text, fecha_entrega date, total_lineas bigint, cantidad_ordenada numeric,
  cantidad_recibida numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
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
    o.estado_entrega,
    pr.codigo::text,
    pr.nombre::text,
    pv.nombre::text,
    o.fecha_entrega::date,
    count(i.id),
    coalesce(sum(i.cantidad), 0),
    coalesce(sum(public._recibido_linea_oc(i.id)), 0)
  from ordenes_compra o
  join proyectos pr on pr.id = o.proyecto_id
  left join proveedores pv on pv.unique_id = o.proveedor_id
  left join ordenes_compra_items i on i.orden_compra_id = o.id
  where o.estado = 'aprobada'
    and (p_incluir_entregadas or o.estado_entrega in ('sin_entregar', 'entrega_parcial'))
    and (p_proyecto_id is null or o.proyecto_id = p_proyecto_id)
  group by o.id, pr.codigo, pr.nombre, pv.nombre
  order by o.numero desc;
end;
$$;

revoke all on function public.listar_ordenes_para_entrada(boolean, uuid) from public, anon;
grant execute on function public.listar_ordenes_para_entrada(boolean, uuid) to authenticated;
