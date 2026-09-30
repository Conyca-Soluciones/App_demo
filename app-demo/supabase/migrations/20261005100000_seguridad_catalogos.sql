-- Seguridad de catálogos (punto 5.1 de REPORTE-cambios-y-rendimiento.md y S3
-- del reporte de lcpr).
--
-- Antes: cualquier usuario con sesión podía
--   * actualizar maestro_insumos (precios, descripciones) desde el navegador
--   * crear, editar y BORRAR mano_obra_categorias y equipo_categorias.
--
-- Ahora (la lectura sigue abierta a cualquier autenticado: los ingenieros
-- las necesitan para armar APUs):
--   * maestro_insumos UPDATE  -> acción aprobar_insumos (o Administrador)
--   * catálogos MO/equipo INSERT/UPDATE/DELETE -> acción aprobar_mano_obra
--
-- Verificado antes de aplicar: ningún código de la app hace UPDATE a
-- maestro_insumos (solo INSERT al aprobar una solicitud, que ya exigía
-- admin_insumos), y ninguna función/trigger de la base escribe en estas
-- tablas. Los catálogos MO/equipo se escriben solo desde el panel de
-- aprobación de mano de obra y al aprobar solicitudes (que ya exigían la
-- acción aprobar_mano_obra en el servidor).
--
-- (select auth.uid()) en vez de auth.uid(): Postgres lo evalúa una vez por
-- consulta (InitPlan) y no por fila (aviso auth_rls_initplan de Supabase).

-- ---- maestro_insumos --------------------------------------------------------
drop policy if exists "autenticados actualizan insumos" on public.maestro_insumos;
drop policy if exists maestro_insumos_update on public.maestro_insumos;
create policy maestro_insumos_update on public.maestro_insumos
  for update to authenticated
  using (public.tiene_accion((select auth.uid()), 'aprobar_insumos'))
  with check (public.tiene_accion((select auth.uid()), 'aprobar_insumos'));

-- ---- mano_obra_categorias ---------------------------------------------------
drop policy if exists "autenticados leen y modifican mano_obra_categorias" on public.mano_obra_categorias;
drop policy if exists mano_obra_categorias_select on public.mano_obra_categorias;
drop policy if exists mano_obra_categorias_insert on public.mano_obra_categorias;
drop policy if exists mano_obra_categorias_update on public.mano_obra_categorias;
drop policy if exists mano_obra_categorias_delete on public.mano_obra_categorias;
create policy mano_obra_categorias_select on public.mano_obra_categorias
  for select to authenticated using (true);
create policy mano_obra_categorias_insert on public.mano_obra_categorias
  for insert to authenticated
  with check (public.tiene_accion((select auth.uid()), 'aprobar_mano_obra'));
create policy mano_obra_categorias_update on public.mano_obra_categorias
  for update to authenticated
  using (public.tiene_accion((select auth.uid()), 'aprobar_mano_obra'))
  with check (public.tiene_accion((select auth.uid()), 'aprobar_mano_obra'));
create policy mano_obra_categorias_delete on public.mano_obra_categorias
  for delete to authenticated
  using (public.tiene_accion((select auth.uid()), 'aprobar_mano_obra'));

-- ---- equipo_categorias ------------------------------------------------------
drop policy if exists "autenticados leen y modifican equipo_categorias" on public.equipo_categorias;
drop policy if exists equipo_categorias_select on public.equipo_categorias;
drop policy if exists equipo_categorias_insert on public.equipo_categorias;
drop policy if exists equipo_categorias_update on public.equipo_categorias;
drop policy if exists equipo_categorias_delete on public.equipo_categorias;
create policy equipo_categorias_select on public.equipo_categorias
  for select to authenticated using (true);
create policy equipo_categorias_insert on public.equipo_categorias
  for insert to authenticated
  with check (public.tiene_accion((select auth.uid()), 'aprobar_mano_obra'));
create policy equipo_categorias_update on public.equipo_categorias
  for update to authenticated
  using (public.tiene_accion((select auth.uid()), 'aprobar_mano_obra'))
  with check (public.tiene_accion((select auth.uid()), 'aprobar_mano_obra'));
create policy equipo_categorias_delete on public.equipo_categorias
  for delete to authenticated
  using (public.tiene_accion((select auth.uid()), 'aprobar_mano_obra'));
