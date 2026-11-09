-- Fecha estimada de entrega (decisión del usuario, 2026-11-09). Compras la
-- pone en Generar OC (ordenes_compra.fecha_entrega, el campo que ya existía
-- como "Fecha de entrega (opcional)") y el Registro de requisiciones la
-- muestra junto a la fecha de la requisición y la fecha requerida.
--
-- Una requisición puede quedar en varias órdenes: su fecha estimada es la MÁS
-- TARDÍA de sus órdenes vigentes (pendientes de aprobar o aprobadas), o sea
-- cuándo debería tener todo. Las rechazadas y canceladas no cuentan.
--
-- SECURITY DEFINER: requisiciones_vista es security_invoker y quien hizo la
-- requisición (el ingeniero) normalmente no lee órdenes de compra. La función
-- solo devuelve una fecha y la vista ya filtra las requisiciones por su RLS.

create or replace function public._fecha_estimada_requisicion(p_requisicion_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select max(oc.fecha_entrega)
    from pedidos_insumos p
    join ordenes_compra_items oci on oci.pedido_insumo_id = p.id
    join ordenes_compra oc on oc.id = oci.orden_compra_id
   where p.grupo_pedido_id = p_requisicion_id
     and oc.estado in ('pendiente_aprobacion', 'aprobada')
$$;

revoke execute on function public._fecha_estimada_requisicion(uuid) from public, anon;
grant execute on function public._fecha_estimada_requisicion(uuid) to authenticated;

-- La columna nueva va AL FINAL (create or replace view no deja reordenar).
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
    public._fecha_estimada_requisicion(r.id) AS fecha_estimada
   FROM requisiciones r
     LEFT JOIN proyectos pr ON pr.id = r.proyecto_id
     LEFT JOIN perfiles pf ON pf.id = r.solicitado_por;
