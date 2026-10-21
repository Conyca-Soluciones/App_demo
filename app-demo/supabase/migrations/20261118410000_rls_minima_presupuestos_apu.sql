-- Presupuestos, APU, maestra de insumos, solicitudes y catálogos de MO/equipo
-- con el mínimo acceso (auditoría RLS 2026-10-20, regla del usuario: "dar
-- acceso a las tablas únicamente a las personas que lo necesitan").
-- Informe: docs/agentes/revisiones/2026-10-20/auditoria-rls.md
--
-- Antes: presupuestos / ítems / versiones = cualquiera con el proyecto
-- asignado; APU, líneas de APU, revisión del import, transporte, maestra de
-- insumos (con precios), solicitudes y catálogos de MO/equipo = CUALQUIERA con
-- sesión, de todos los proyectos.
--
-- Ahora (además del proyecto donde la tabla lo tiene):
--   presupuestos (presupuesto_items y presupuesto_versiones heredan: su
--   política hace exists sobre presupuestos, que aplica esta)
--     Elaboración de presupuestos, o las pestañas de Requisiciones
--     (Elaboración: el cupo sale del presupuesto vigente; Registro y
--     Aprobación: el ítem de cada línea). Las de Requisiciones no se pueden
--     quitar sin romper pedidos_insumos, cuya política lee el proyecto a
--     través de presupuesto_items/presupuestos.
--   presupuesto_items, además: SOLO los ítems que están en el anexo de un
--     contrato que la persona ya ve (código del ítem en el detalle del
--     contrato), para las pestañas de Contratos.
--   apu: Elaboración, Aprobación de insumos o Aprobación de MO y equipos.
--   item_apu: lo mismo y las pestañas de Requisiciones
--     (buscar_insumos_presupuesto, disponible_insumos_items e
--     insumos_presupuesto_por_ids son SECURITY INVOKER y leen item_apu).
--   Los dos siguen sin filtro de proyecto (APU recomendados de otros
--   proyectos; opción B pendiente).
--   apu_import_revision / transporte_precios: Elaboración, Aprobación de
--     insumos o Aprobación de MO y equipos.
--   maestro_insumos: todas las pestañas de Presupuestos, Requisiciones,
--     Compras, Almacén y Control, o Comprar. Quedan fuera las que no tocan
--     insumos: A&F (Contabilidad, Financiera), Contratos (Jurídica) y RRHH.
--   solicitudes_insumos: las propias, Elaboración o Aprobar insumos.
--   solicitudes_mano_obra / solicitudes_equipo: las propias, Elaboración o
--     Aprobar mano de obra.
--   mano_obra_categorias / equipo_categorias: Elaboración, Aprobación de
--     insumos o Aprobación de MO y equipos.
-- Escribir no cambia. Los que escriben (editar_presupuestos, aprobar_insumos,
-- aprobar_mano_obra) tienen hoy esas pestañas en la matriz. Sin sesión, nada.

-- --------------------------------------------------------------------------
-- presupuestos
-- --------------------------------------------------------------------------
drop policy if exists "ver presupuestos de proyectos permitidos" on public.presupuestos;
create policy "ver presupuestos de proyectos permitidos" on public.presupuestos
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'presupuestos.elaboracion')
         or public.tiene_pestana((select auth.uid()), 'tecnico.pedidos')
         or public.tiene_pestana((select auth.uid()), 'tecnico.registro_pedidos')
         or public.tiene_pestana((select auth.uid()), 'tecnico.aprobar_pedidos'))
    and (
      proyecto_id in (select public.proyectos_visibles((select auth.uid())))
      or (proyecto_id is null
          and (select public.usuario_puede_ver_proyecto((select auth.uid()), null::uuid)))
    )
  );

-- --------------------------------------------------------------------------
-- presupuesto_items: ítems del anexo de los contratos que la persona ve (la
-- subconsulta aplica las políticas de contrato_anexo_items -> contratos).
-- --------------------------------------------------------------------------
drop policy if exists presupuesto_items_select_de_contratos on public.presupuesto_items;
create policy presupuesto_items_select_de_contratos on public.presupuesto_items
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'contratos.solicitar')
         or public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion')
         or public.tiene_pestana((select auth.uid()), 'contratos.contratos')
         or public.tiene_pestana((select auth.uid()), 'contratos.aprobar_minutas')
         or public.tiene_pestana((select auth.uid()), 'admin.visualizacion'))
    and exists (
      select 1 from public.contrato_anexo_items cai
      where cai.presupuesto_item_id = presupuesto_items.id
    )
  );

-- --------------------------------------------------------------------------
-- apu / item_apu
-- --------------------------------------------------------------------------
drop policy if exists apu_select on public.apu;
create policy apu_select on public.apu
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'presupuestos.elaboracion')
         or public.tiene_pestana((select auth.uid()), 'almacen.aprobar_insumos')
         or public.tiene_pestana((select auth.uid()), 'tecnico.aprobar_mano_obra'))
  );

drop policy if exists item_apu_select on public.item_apu;
create policy item_apu_select on public.item_apu
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'presupuestos.elaboracion')
         or public.tiene_pestana((select auth.uid()), 'almacen.aprobar_insumos')
         or public.tiene_pestana((select auth.uid()), 'tecnico.aprobar_mano_obra')
         or public.tiene_pestana((select auth.uid()), 'tecnico.pedidos')
         or public.tiene_pestana((select auth.uid()), 'tecnico.registro_pedidos')
         or public.tiene_pestana((select auth.uid()), 'tecnico.aprobar_pedidos'))
  );

-- --------------------------------------------------------------------------
-- apu_import_revision / transporte_precios
-- --------------------------------------------------------------------------
drop policy if exists apu_import_revision_select on public.apu_import_revision;
create policy apu_import_revision_select on public.apu_import_revision
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'presupuestos.elaboracion')
         or public.tiene_pestana((select auth.uid()), 'almacen.aprobar_insumos')
         or public.tiene_pestana((select auth.uid()), 'tecnico.aprobar_mano_obra'))
  );

drop policy if exists transporte_precios_select on public.transporte_precios;
create policy transporte_precios_select on public.transporte_precios
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'presupuestos.elaboracion')
         or public.tiene_pestana((select auth.uid()), 'almacen.aprobar_insumos')
         or public.tiene_pestana((select auth.uid()), 'tecnico.aprobar_mano_obra'))
  );

-- --------------------------------------------------------------------------
-- maestro_insumos
-- --------------------------------------------------------------------------
drop policy if exists "autenticados leen y crean insumos" on public.maestro_insumos;
drop policy if exists maestro_insumos_select on public.maestro_insumos;
create policy maestro_insumos_select on public.maestro_insumos
  for select to authenticated
  using (
    (select public.rol_compras((select auth.uid())))
    or (select public.tiene_pestana((select auth.uid()), 'presupuestos.elaboracion')
            or public.tiene_pestana((select auth.uid()), 'almacen.insumos')
            or public.tiene_pestana((select auth.uid()), 'almacen.aprobar_insumos')
            or public.tiene_pestana((select auth.uid()), 'tecnico.aprobar_mano_obra')
            or public.tiene_pestana((select auth.uid()), 'tecnico.pedidos')
            or public.tiene_pestana((select auth.uid()), 'tecnico.registro_pedidos')
            or public.tiene_pestana((select auth.uid()), 'tecnico.aprobar_pedidos')
            or public.tiene_pestana((select auth.uid()), 'compras.comprar_pedidos')
            or public.tiene_pestana((select auth.uid()), 'compras.saldos_pendientes')
            or public.tiene_pestana((select auth.uid()), 'compras.ordenes')
            or public.tiene_pestana((select auth.uid()), 'compras.aprobar_oc')
            or public.tiene_pestana((select auth.uid()), 'almacen.proveedores')
            or public.tiene_pestana((select auth.uid()), 'almacen.entradas')
            or public.tiene_pestana((select auth.uid()), 'almacen.salidas')
            or public.tiene_pestana((select auth.uid()), 'almacen.inventario')
            or public.tiene_pestana((select auth.uid()), 'admin.visualizacion'))
  );

-- --------------------------------------------------------------------------
-- solicitudes_insumos / solicitudes_mano_obra / solicitudes_equipo
-- --------------------------------------------------------------------------
drop policy if exists "autenticados ven solicitudes" on public.solicitudes_insumos;
drop policy if exists solicitudes_insumos_select on public.solicitudes_insumos;
create policy solicitudes_insumos_select on public.solicitudes_insumos
  for select to authenticated
  using (
    solicitado_por = (select auth.uid())
    or (select public.tiene_pestana((select auth.uid()), 'presupuestos.elaboracion'))
    or (select public.admin_insumos((select auth.uid())))
  );

drop policy if exists "autenticados leen solicitudes_mano_obra" on public.solicitudes_mano_obra;
drop policy if exists solicitudes_mano_obra_select on public.solicitudes_mano_obra;
create policy solicitudes_mano_obra_select on public.solicitudes_mano_obra
  for select to authenticated
  using (
    solicitado_por = (select auth.uid())
    or (select public.tiene_pestana((select auth.uid()), 'presupuestos.elaboracion'))
    or (select public.tiene_accion((select auth.uid()), 'aprobar_mano_obra'))
  );

drop policy if exists "autenticados leen solicitudes_equipo" on public.solicitudes_equipo;
drop policy if exists solicitudes_equipo_select on public.solicitudes_equipo;
create policy solicitudes_equipo_select on public.solicitudes_equipo
  for select to authenticated
  using (
    solicitado_por = (select auth.uid())
    or (select public.tiene_pestana((select auth.uid()), 'presupuestos.elaboracion'))
    or (select public.tiene_accion((select auth.uid()), 'aprobar_mano_obra'))
  );

-- --------------------------------------------------------------------------
-- mano_obra_categorias / equipo_categorias (valores unitarios de MO/equipo)
-- --------------------------------------------------------------------------
drop policy if exists mano_obra_categorias_select on public.mano_obra_categorias;
create policy mano_obra_categorias_select on public.mano_obra_categorias
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'presupuestos.elaboracion')
         or public.tiene_pestana((select auth.uid()), 'almacen.aprobar_insumos')
         or public.tiene_pestana((select auth.uid()), 'tecnico.aprobar_mano_obra'))
  );

drop policy if exists equipo_categorias_select on public.equipo_categorias;
create policy equipo_categorias_select on public.equipo_categorias
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'presupuestos.elaboracion')
         or public.tiene_pestana((select auth.uid()), 'almacen.aprobar_insumos')
         or public.tiene_pestana((select auth.uid()), 'tecnico.aprobar_mano_obra'))
  );
