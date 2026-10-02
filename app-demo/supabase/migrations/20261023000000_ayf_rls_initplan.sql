-- A&F · Migración 9: políticas RLS con el patrón que reconoce el linter.
--
-- La migración 8 ya evaluaba el permiso una sola vez por consulta, pero el
-- asesor de rendimiento de Supabase (auth_rls_initplan) solo da por bueno
-- `(select auth.uid())` escrito literalmente. Mismas reglas de acceso; solo
-- cambia cómo está escrito.

drop policy if exists terceros_select on public.terceros;
create policy terceros_select on public.terceros
  for select to authenticated
  using ((select
    public.tiene_pestana((select auth.uid()), 'ayf.terceros')
    or public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
    or public.tiene_pestana((select auth.uid()), 'ayf.consolidado')
  ));

drop policy if exists terceros_insert on public.terceros;
create policy terceros_insert on public.terceros
  for insert to authenticated
  with check ((select public.tiene_accion((select auth.uid()), 'editar_terceros')));

drop policy if exists terceros_update on public.terceros;
create policy terceros_update on public.terceros
  for update to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_terceros')))
  with check ((select public.tiene_accion((select auth.uid()), 'editar_terceros')));

drop policy if exists terceros_cuentas_select on public.terceros_cuentas;
create policy terceros_cuentas_select on public.terceros_cuentas
  for select to authenticated
  using ((select
    public.tiene_pestana((select auth.uid()), 'ayf.terceros')
    or public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
    or public.tiene_pestana((select auth.uid()), 'ayf.consolidado')
  ));

drop policy if exists terceros_cuentas_insert on public.terceros_cuentas;
create policy terceros_cuentas_insert on public.terceros_cuentas
  for insert to authenticated
  with check ((select public.tiene_accion((select auth.uid()), 'editar_terceros')));

drop policy if exists terceros_cuentas_update on public.terceros_cuentas;
create policy terceros_cuentas_update on public.terceros_cuentas
  for update to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_terceros')))
  with check ((select public.tiene_accion((select auth.uid()), 'editar_terceros')));

drop policy if exists cuentas_empresa_select on public.cuentas_empresa;
create policy cuentas_empresa_select on public.cuentas_empresa
  for select to authenticated
  using ((select public.es_admin((select auth.uid()))));

drop policy if exists terceros_auditoria_select on public.terceros_auditoria;
create policy terceros_auditoria_select on public.terceros_auditoria
  for select to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'verificar_terceros')));

drop policy if exists pagos_select on public.pagos;
create policy pagos_select on public.pagos
  for select to authenticated
  using ((select
    public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
    or public.tiene_pestana((select auth.uid()), 'ayf.consolidado')
  ));

drop policy if exists pagos_fallos_select on public.pagos_fallos;
create policy pagos_fallos_select on public.pagos_fallos
  for select to authenticated
  using ((select public.tiene_pestana((select auth.uid()), 'ayf.consolidado')));
