-- Líneas de APU: quien solo hace o revisa requisiciones lee las de SUS
-- proyectos, no las de todos (encontrado en la prueba por roles, 2026-10-20:
-- el Auxiliar administrativo, con solo Estuario Casa, leía por la API las 674
-- líneas de APU del Malecón con cantidades y precios).
--
-- Va después de 20261118410000_rls_minima_presupuestos_apu.sql.
--
-- item_apu_select queda en dos políticas:
--   1. Elaboración de presupuestos, Aprobación de insumos o Aprobación de mano
--      de obra y equipos: todas (los APU recomendados vienen de otros
--      proyectos; restringirlos por proyecto es la "opción B", pendiente).
--   2. Elaboración, Registro o Aprobación de requisiciones: solo las líneas de
--      los APU que usa un ítem de presupuesto que la persona ya ve (la
--      subconsulta aplica la RLS de presupuesto_items -> presupuestos, que
--      exige el proyecto). Es lo que necesitan las funciones de requisiciones
--      (buscar_insumos_presupuesto y compañía, SECURITY INVOKER).

drop policy if exists item_apu_select on public.item_apu;
create policy item_apu_select on public.item_apu
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'presupuestos.elaboracion')
         or public.tiene_pestana((select auth.uid()), 'almacen.aprobar_insumos')
         or public.tiene_pestana((select auth.uid()), 'tecnico.aprobar_mano_obra'))
  );

drop policy if exists item_apu_select_de_requisiciones on public.item_apu;
create policy item_apu_select_de_requisiciones on public.item_apu
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'tecnico.pedidos')
         or public.tiene_pestana((select auth.uid()), 'tecnico.registro_pedidos')
         or public.tiene_pestana((select auth.uid()), 'tecnico.aprobar_pedidos'))
    and apu_id in (select pi.apu_id from public.presupuesto_items pi where pi.apu_id is not null)
  );
