-- Rendimiento: permisos de requisiciones, anexos y pedidos sin árboles anidados.
--
-- Problema (2026-11-24): la base (0,45 GB en el plan gratuito) se quedó sin memoria
-- y empezó a usar swap; todo se puso lento y hubo consultas canceladas. La memoria se
-- iba en PLANEAR las políticas: requisicion_anexos -> requisiciones -> pedidos_insumos
-- -> presupuesto_items / presupuestos / ordenes_compra_items / pagos, cada una con sus
-- propias políticas, y el planeador las expande todas dentro de cada consulta. Además,
-- en Storage las políticas de lectura se juntan para todos los buckets, así que la de
-- anexos (20270101006000) se planeaba al abrir CUALQUIER archivo. Medido con un
-- usuario real (memoria del plan):
--   ver un archivo de Storage  57 MB -> 16 MB     anexos de una requisición 49 MB -> 0,03 MB
--   lista de requisiciones     25 MB -> 0,25 MB   pedidos de insumos        16 MB -> 0,5 MB
--
-- Arreglo: la parte de cada política que lee otra tabla pasa a una función plpgsql
-- SECURITY INVOKER (no se expande en el plan; se ejecuta una vez por consulta). Como
-- es INVOKER, adentro siguen aplicando las mismas políticas de siempre: cada usuario ve
-- exactamente lo mismo. Verificado antes de aplicar, en una transacción revertida, con
-- los 29 usuarios (requisiciones, anexos y pedidos: mismos ids) y Storage (mismos
-- archivos). Reversa en supabase/reversa/.
--
-- Regla para políticas nuevas: si una política necesita leer otra tabla con RLS (sobre
-- todo en storage.objects), usar una función así en vez de un EXISTS / IN directo.

create or replace function public._requisiciones_visibles() returns setof uuid
language plpgsql stable security invoker set search_path = public as $f$
begin
  return query select distinct p.grupo_pedido_id from public.pedidos_insumos p;
end $f$;

create or replace function public._rutas_anexos_visibles() returns setof text
language plpgsql stable security invoker set search_path = public as $f$
begin
  return query select a.ruta from public.requisicion_anexos a;
end $f$;

create or replace function public._items_pedido_visibles() returns setof uuid
language plpgsql stable security invoker set search_path = public as $f$
begin
  return query
    select pi.id from public.presupuesto_items pi join public.presupuestos p on p.id = pi.presupuesto_id
    where p.proyecto_id in (select public.proyectos_visibles((select auth.uid())))
       or (p.proyecto_id is null and (select public.usuario_puede_ver_proyecto((select auth.uid()), null::uuid)));
end $f$;

create or replace function public._pedidos_en_ordenes() returns setof uuid
language plpgsql stable security invoker set search_path = public as $f$
begin
  return query select oci.pedido_insumo_id from public.ordenes_compra_items oci where oci.pedido_insumo_id is not null;
end $f$;

create or replace function public._pedidos_en_pagos() returns setof uuid
language plpgsql stable security invoker set search_path = public as $f$
begin
  return query select i.pedido_insumo_id from public.ordenes_compra_items i
    where i.pedido_insumo_id is not null and i.orden_compra_id in (select pg.orden_compra_id from public.pagos pg);
end $f$;

revoke execute on function public._requisiciones_visibles(), public._rutas_anexos_visibles(), public._items_pedido_visibles(),
  public._pedidos_en_ordenes(), public._pedidos_en_pagos() from public, anon;
grant execute on function public._requisiciones_visibles(), public._rutas_anexos_visibles(), public._items_pedido_visibles(),
  public._pedidos_en_ordenes(), public._pedidos_en_pagos() to authenticated;

alter policy requisiciones_select on public.requisiciones
  using (id in (select public._requisiciones_visibles()));

alter policy requisicion_anexos_select on public.requisicion_anexos
  using (requisicion_id in (select public._requisiciones_visibles()));

alter policy requisiciones_anexos_select on storage.objects
  using (bucket_id = 'requisiciones' and name in (select public._rutas_anexos_visibles()));

alter policy pedidos_insumos_select on public.pedidos_insumos
  using (
    (((select public.admin_insumos((select auth.uid()))) or (select public.admin_proyectos((select auth.uid()))))
      and proyecto_id in (select public.proyectos_visibles((select auth.uid()))))
    or ((select (public.tiene_pestana((select auth.uid()), 'tecnico.pedidos')
              or public.tiene_pestana((select auth.uid()), 'tecnico.registro_pedidos')
              or public.tiene_pestana((select auth.uid()), 'tecnico.aprobar_pedidos')))
      and presupuesto_item_id in (select public._items_pedido_visibles()))
  );

alter policy pedidos_insumos_select_de_ordenes on public.pedidos_insumos
  using (
    (select (public.tiene_pestana((select auth.uid()), 'compras.ordenes')
          or public.tiene_pestana((select auth.uid()), 'compras.aprobar_oc')
          or public.tiene_pestana((select auth.uid()), 'admin.visualizacion')))
    and id in (select public._pedidos_en_ordenes())
  );

alter policy pedidos_insumos_select_de_pagos on public.pedidos_insumos
  using (
    (select (public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
          or public._ve_algun_consolidado((select auth.uid()))))
    and id in (select public._pedidos_en_pagos())
  );
