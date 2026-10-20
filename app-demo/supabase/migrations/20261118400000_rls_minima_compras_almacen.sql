-- Órdenes de compra, sus líneas, requisiciones, salidas e histórico de precios
-- con el mínimo acceso (auditoría RLS 2026-10-20, regla del usuario: "dar
-- acceso a las tablas únicamente a las personas que lo necesitan").
-- Informe: docs/agentes/revisiones/2026-10-20/auditoria-rls.md
--
-- Antes, bastaba con tener el proyecto asignado: RRHH, Auxiliar
-- administrativo, Contabilidad, Jurídica, Subgerencia y Financiera leían por la
-- API todas las órdenes de compra de Estuario Casa con sus precios, sus
-- requisiciones y sus salidas de almacén.
--
-- Ahora, además del proyecto, hace falta la pestaña de la pantalla que lee la
-- tabla directo (las que leen con funciones SECURITY DEFINER no la necesitan:
-- Entradas, Salidas, Inventario, Saldos pendientes, Control del proyecto -la
-- parte de control_proyecto-, Historial):
--   ordenes_compra / ordenes_compra_items
--     - Comprar: todas (igual que antes).
--     - Registro de OC, Aprobación de OC o Control del proyecto: las de sus
--       proyectos (listado, detalle, PDF, "Órdenes del período").
--     - Aprobación de pagos o Consolidado: SOLO la cabecera de las órdenes
--       que tienen un pago que la persona ya ve (el número "OC #" del pago).
--       Las líneas (precios) NO: esa política no se hereda a las líneas.
--   pedidos_insumos (y requisiciones / requisiciones_vista, que la heredan)
--     - Aprobar insumos / aprobar requisiciones (todas) y Comprar: igual.
--     - Elaboración, Registro o Aprobación de requisiciones: las de sus
--       proyectos.
--     - Registro o Aprobación de OC, o Control del proyecto: SOLO las líneas
--       de requisición que están en una orden que ya ve (el insumo de cada
--       línea en el detalle de la orden).
--   salidas_insumos: Salidas o Inventario + el proyecto (hoy nadie la lee
--     directo; todo pasa por funciones SECURITY DEFINER).
--   historico_precios_compra: Comprar o Aprobar insumos (nadie la lee directo;
--     precios_efectivos_insumos es SECURITY DEFINER).
-- Escribir no cambia (todo por funciones SECURITY DEFINER o por las políticas
-- de escritura que ya existían). Sin sesión, nada (antes eran "to public").

-- --------------------------------------------------------------------------
-- ordenes_compra
-- --------------------------------------------------------------------------
drop policy if exists ordenes_compra_select on public.ordenes_compra;
create policy ordenes_compra_select on public.ordenes_compra
  for select to authenticated
  using ((select public.rol_compras((select auth.uid()))));

drop policy if exists ordenes_compra_select_proyecto on public.ordenes_compra;
create policy ordenes_compra_select_proyecto on public.ordenes_compra
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'compras.ordenes')
         or public.tiene_pestana((select auth.uid()), 'compras.aprobar_oc')
         or public.tiene_pestana((select auth.uid()), 'admin.visualizacion'))
    and proyecto_id in (select public.proyectos_visibles((select auth.uid())))
  );

-- La subconsulta aplica la política de pagos (pestañas de A&F).
drop policy if exists ordenes_compra_select_de_pagos on public.ordenes_compra;
create policy ordenes_compra_select_de_pagos on public.ordenes_compra
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
         or public.tiene_pestana((select auth.uid()), 'ayf.consolidado'))
    and id in (select pg.orden_compra_id from public.pagos pg)
  );

-- --------------------------------------------------------------------------
-- ordenes_compra_items: las pestañas van explícitas (no "exists sobre la
-- orden") para que la cabecera que ve A&F por sus pagos no destape precios.
-- --------------------------------------------------------------------------
drop policy if exists ordenes_compra_items_select on public.ordenes_compra_items;
create policy ordenes_compra_items_select on public.ordenes_compra_items
  for select to authenticated
  using ((select public.rol_compras((select auth.uid()))));

drop policy if exists ordenes_compra_items_select_proyecto on public.ordenes_compra_items;
create policy ordenes_compra_items_select_proyecto on public.ordenes_compra_items
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'compras.ordenes')
         or public.tiene_pestana((select auth.uid()), 'compras.aprobar_oc')
         or public.tiene_pestana((select auth.uid()), 'admin.visualizacion'))
    and exists (
      select 1 from public.ordenes_compra oc
      where oc.id = ordenes_compra_items.orden_compra_id
        and oc.proyecto_id in (select public.proyectos_visibles((select auth.uid())))
    )
  );

-- --------------------------------------------------------------------------
-- pedidos_insumos (requisiciones y requisiciones_vista heredan de acá)
-- --------------------------------------------------------------------------
drop policy if exists pedidos_insumos_select on public.pedidos_insumos;
create policy pedidos_insumos_select on public.pedidos_insumos
  for select to authenticated
  using (
    (select public.admin_insumos((select auth.uid())))
    or (select public.admin_proyectos((select auth.uid())))
    or (
      (select public.tiene_pestana((select auth.uid()), 'tecnico.pedidos')
           or public.tiene_pestana((select auth.uid()), 'tecnico.registro_pedidos')
           or public.tiene_pestana((select auth.uid()), 'tecnico.aprobar_pedidos'))
      and exists (
        select 1
        from public.presupuesto_items pi
        join public.presupuestos p on p.id = pi.presupuesto_id
        where pi.id = pedidos_insumos.presupuesto_item_id
          and (
            p.proyecto_id in (select public.proyectos_visibles((select auth.uid())))
            or (p.proyecto_id is null
                and (select public.usuario_puede_ver_proyecto((select auth.uid()), null::uuid)))
          )
      )
    )
  );

drop policy if exists pedidos_insumos_select_compras on public.pedidos_insumos;
create policy pedidos_insumos_select_compras on public.pedidos_insumos
  for select to authenticated
  using ((select public.rol_compras((select auth.uid()))));

-- El insumo de cada línea en Registro / Aprobación de OC y en el detalle que
-- abre Control del proyecto (Almacenista, Gerencia). La subconsulta aplica la
-- política de ordenes_compra_items.
drop policy if exists pedidos_insumos_select_de_ordenes on public.pedidos_insumos;
create policy pedidos_insumos_select_de_ordenes on public.pedidos_insumos
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'compras.ordenes')
         or public.tiene_pestana((select auth.uid()), 'compras.aprobar_oc')
         or public.tiene_pestana((select auth.uid()), 'admin.visualizacion'))
    and exists (
      select 1 from public.ordenes_compra_items oci
      where oci.pedido_insumo_id = pedidos_insumos.id
    )
  );

-- --------------------------------------------------------------------------
-- salidas_insumos
-- --------------------------------------------------------------------------
drop policy if exists salidas_insumos_select on public.salidas_insumos;
create policy salidas_insumos_select on public.salidas_insumos
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'almacen.salidas')
         or public.tiene_pestana((select auth.uid()), 'almacen.inventario'))
    and proyecto_id in (select public.proyectos_visibles((select auth.uid())))
  );

-- --------------------------------------------------------------------------
-- historico_precios_compra
-- --------------------------------------------------------------------------
drop policy if exists "autenticados leen historico de precios" on public.historico_precios_compra;
drop policy if exists historico_precios_compra_select on public.historico_precios_compra;
create policy historico_precios_compra_select on public.historico_precios_compra
  for select to authenticated
  using (
    (select public.rol_compras((select auth.uid())))
    or (select public.admin_insumos((select auth.uid())))
  );
