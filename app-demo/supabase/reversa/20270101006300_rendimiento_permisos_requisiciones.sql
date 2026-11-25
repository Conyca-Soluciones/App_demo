-- Reversa de 20270101006300: devuelve las políticas a como estaban y borra las funciones.
begin;
alter policy requisiciones_select on public.requisiciones
  using (exists (select 1 from public.pedidos_insumos p where p.grupo_pedido_id = requisiciones.id));

alter policy requisicion_anexos_select on public.requisicion_anexos
  using (exists (select 1 from public.requisiciones r where r.id = requisicion_anexos.requisicion_id));

alter policy requisiciones_anexos_select on storage.objects
  using (bucket_id = 'requisiciones' and name in (select a.ruta from public.requisicion_anexos a));

alter policy pedidos_insumos_select on public.pedidos_insumos
  using (
    ((((select public.admin_insumos((select auth.uid()))) or (select public.admin_proyectos((select auth.uid()))))
      and proyecto_id in (select public.proyectos_visibles((select auth.uid())))))
    or ((select (public.tiene_pestana((select auth.uid()), 'tecnico.pedidos')
              or public.tiene_pestana((select auth.uid()), 'tecnico.registro_pedidos')
              or public.tiene_pestana((select auth.uid()), 'tecnico.aprobar_pedidos')))
      and exists (select 1 from public.presupuesto_items pi join public.presupuestos p on p.id = pi.presupuesto_id
                  where pi.id = pedidos_insumos.presupuesto_item_id
                    and (p.proyecto_id in (select public.proyectos_visibles((select auth.uid())))
                         or (p.proyecto_id is null and (select public.usuario_puede_ver_proyecto((select auth.uid()), null::uuid))))))
  );

alter policy pedidos_insumos_select_de_ordenes on public.pedidos_insumos
  using (
    (select (public.tiene_pestana((select auth.uid()), 'compras.ordenes')
          or public.tiene_pestana((select auth.uid()), 'compras.aprobar_oc')
          or public.tiene_pestana((select auth.uid()), 'admin.visualizacion')))
    and exists (select 1 from public.ordenes_compra_items oci where oci.pedido_insumo_id = pedidos_insumos.id)
  );

alter policy pedidos_insumos_select_de_pagos on public.pedidos_insumos
  using (
    (select (public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
          or public._ve_algun_consolidado((select auth.uid()))))
    and id in (select i.pedido_insumo_id from public.ordenes_compra_items i
               where i.orden_compra_id in (select pg.orden_compra_id from public.pagos pg))
  );

drop function if exists public._requisiciones_visibles();
drop function if exists public._rutas_anexos_visibles();
drop function if exists public._items_pedido_visibles();
drop function if exists public._pedidos_en_ordenes();
drop function if exists public._pedidos_en_pagos();
commit;
