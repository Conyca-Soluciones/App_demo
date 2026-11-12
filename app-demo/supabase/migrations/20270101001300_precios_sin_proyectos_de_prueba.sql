-- Las compras de proyectos de prueba no cuentan para el precio de los insumos
-- (decisión del usuario, 2026-11-12).
--
-- precios_efectivos_insumos promediaba las OC aprobadas de TODOS los proyectos.
-- En CAPACITACION se compró concreto, alambre y tela verde a $20 / $1.000 de
-- prueba, y ese precio se congeló en líneas de APU del Malecón (concreto 4000
-- a $23,80 el m³). Ahora un proyecto con proyectos.excluir_de_precios = true no
-- entra al promedio (CAPACITACION queda marcado). La usan el precio del
-- presupuesto (precios_presupuesto_insumos), el aviso de sobrecosto de Generar
-- OC y la Maestra: todos dejan de ver esas compras.
--
-- Para marcar otro proyecto de prueba:
--   update proyectos set excluir_de_precios = true where codigo = '...';
-- Se puede correr más de una vez.

alter table public.proyectos add column if not exists excluir_de_precios boolean not null default false;

update public.proyectos set excluir_de_precios = true where codigo = 'CAPACITACION';

-- Mismo cuerpo que la versión viva + el filtro del proyecto.
create or replace function public.precios_efectivos_insumos(p_insumo_ids uuid[])
returns table(insumo_id uuid, precio_efectivo numeric, tipo text)
language sql
stable security definer
set search_path to 'public'
as $function$
  with compras as (
    select h.insumo_id,
           h.precio_unitario * (1 - h.porcentaje_descuento / 100.0) as precio,
           h.fecha_compra as fecha
    from historico_precios_compra h
    where h.insumo_id = any(p_insumo_ids)
    union all
    select pi.insumo_id,
           oci.precio_unitario * (1 - oci.porcentaje_descuento / 100.0),
           oci.created_at::date
    from ordenes_compra_items oci
    join pedidos_insumos pi on pi.id = oci.pedido_insumo_id
    join ordenes_compra oc on oc.id = oci.orden_compra_id
    left join proyectos py on py.id = oc.proyecto_id
    where pi.insumo_id = any(p_insumo_ids)
      and oc.estado = 'aprobada'
      and not coalesce(py.excluir_de_precios, false)
  ),
  promedios as (
    select c.insumo_id,
           avg(c.precio) filter (where c.fecha >= (now() - interval '6 months')::date) as reciente,
           avg(c.precio) as historico
    from compras c
    group by c.insumo_id
  )
  select mi.id, coalesce(p.reciente, p.historico, mi.vr_unitario), mi.tipo
  from maestro_insumos mi
  left join promedios p on p.insumo_id = mi.id
  where mi.id = any(p_insumo_ids)
$function$;
