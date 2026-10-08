-- Seguridad de APU: escribir exige "Editar presupuestos".
--
-- apu, item_apu, apu_import_revision y transporte_precios tenían una sola
-- política: cualquier usuario con sesión lee y MODIFICA todo. La pantalla se
-- oculta por rol, pero con la llave pública cualquiera (Compras, Legal,
-- Almacén...) podía cambiar o borrar líneas de APU de cualquier proyecto por la
-- API: eso mueve el valor del presupuesto y el cupo de las requisiciones
-- (cantidad del APU × cantidad del ítem).
--
-- Ahora (opción A, decisión del usuario):
--   * Leer: igual que antes, cualquier usuario con sesión (los APU recomendados
--     y el import leen APU de otros proyectos).
--   * Crear / modificar / borrar: acción editar_presupuestos.
--   * item_apu además: crear y modificar con aprobar_insumos, porque
--     aprobarSolicitudInsumo ajusta la unidad de las líneas del import y agrega
--     la línea del insumo nuevo en el flujo manual.
-- Lo que escriben los disparadores y funciones SECURITY DEFINER (aprobar
-- solicitudes de MO/equipo, descartar un import abandonado, borrar APU
-- huérfanos) no pasa por estas políticas. Todos los usuarios tienen rol
-- (rol_id), así que tiene_accion decide por la matriz de Roles.
--
-- Pendiente (opción B): restringir también por proyecto.
-- Se puede correr más de una vez.

-- ------------------------------------------------------------------- apu
drop policy if exists "autenticados leen y modifican apu" on public.apu;
drop policy if exists apu_select on public.apu;
drop policy if exists apu_insert on public.apu;
drop policy if exists apu_update on public.apu;
drop policy if exists apu_delete on public.apu;

create policy apu_select on public.apu for select to authenticated
  using ((select auth.uid()) is not null);
create policy apu_insert on public.apu for insert to authenticated
  with check ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos')));
create policy apu_update on public.apu for update to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos')))
  with check ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos')));
create policy apu_delete on public.apu for delete to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos')));

-- -------------------------------------------------------------- item_apu
drop policy if exists "autenticados leen y modifican item_apu" on public.item_apu;
drop policy if exists item_apu_select on public.item_apu;
drop policy if exists item_apu_insert on public.item_apu;
drop policy if exists item_apu_update on public.item_apu;
drop policy if exists item_apu_delete on public.item_apu;

create policy item_apu_select on public.item_apu for select to authenticated
  using ((select auth.uid()) is not null);
create policy item_apu_insert on public.item_apu for insert to authenticated
  with check ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
              or (select public.tiene_accion((select auth.uid()), 'aprobar_insumos')));
create policy item_apu_update on public.item_apu for update to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
         or (select public.tiene_accion((select auth.uid()), 'aprobar_insumos')))
  with check ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
              or (select public.tiene_accion((select auth.uid()), 'aprobar_insumos')));
create policy item_apu_delete on public.item_apu for delete to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos')));

-- --------------------------------------------------- apu_import_revision
drop policy if exists "autenticados leen y modifican apu_import_revision" on public.apu_import_revision;
drop policy if exists apu_import_revision_select on public.apu_import_revision;
drop policy if exists apu_import_revision_insert on public.apu_import_revision;
drop policy if exists apu_import_revision_update on public.apu_import_revision;
drop policy if exists apu_import_revision_delete on public.apu_import_revision;

create policy apu_import_revision_select on public.apu_import_revision for select to authenticated
  using ((select auth.uid()) is not null);
create policy apu_import_revision_insert on public.apu_import_revision for insert to authenticated
  with check ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos')));
create policy apu_import_revision_update on public.apu_import_revision for update to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos')))
  with check ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos')));
create policy apu_import_revision_delete on public.apu_import_revision for delete to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos')));

-- ---------------------------------------------------- transporte_precios
drop policy if exists "autenticados leen y modifican transporte_precios" on public.transporte_precios;
drop policy if exists transporte_precios_select on public.transporte_precios;
drop policy if exists transporte_precios_insert on public.transporte_precios;
drop policy if exists transporte_precios_update on public.transporte_precios;
drop policy if exists transporte_precios_delete on public.transporte_precios;

create policy transporte_precios_select on public.transporte_precios for select to authenticated
  using ((select auth.uid()) is not null);
create policy transporte_precios_insert on public.transporte_precios for insert to authenticated
  with check ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos')));
create policy transporte_precios_update on public.transporte_precios for update to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos')))
  with check ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos')));
create policy transporte_precios_delete on public.transporte_precios for delete to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos')));
