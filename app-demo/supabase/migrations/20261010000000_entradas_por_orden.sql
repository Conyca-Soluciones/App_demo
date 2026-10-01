-- Entradas vigentes (no anuladas) de varias órdenes de compra a la vez, con
-- quién las hizo y cuándo. Las usa la lista de Entradas para mostrar "Persona
-- que hizo la entrada" y "Fecha de la entrada" y para filtrar por ellas.
create or replace function public.entradas_por_orden(p_orden_ids uuid[])
returns table (
  orden_id uuid,
  entrada_id uuid,
  numero bigint,
  created_at timestamptz,
  recibido_por uuid,
  recibido_por_nombre text
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

  return query
  select e.orden_compra_id, e.id, e.numero, e.created_at, e.recibido_por, pf.nombre::text
  from entradas_almacen e
  left join perfiles pf on pf.id = e.recibido_por
  where e.orden_compra_id = any(p_orden_ids)
    and e.anulada_at is null
  order by e.created_at, e.id;
end;
$$;

revoke all on function public.entradas_por_orden(uuid[]) from public, anon;
grant execute on function public.entradas_por_orden(uuid[]) to authenticated;
