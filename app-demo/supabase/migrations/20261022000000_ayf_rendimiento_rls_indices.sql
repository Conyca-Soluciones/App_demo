-- A&F · Migración 8: rendimiento de las políticas RLS e índices que faltaban.
--
-- 1. Las políticas de A&F llamaban tiene_pestana / tiene_accion UNA VEZ POR
--    FILA leída (el (select auth.uid()) solo fija el argumento, no la
--    llamada). Es lineal, pero con costo alto por fila: como en la auditoría
--    de Contratos (migración 20261012100000), la llamada completa va dentro de
--    (select ...) para que Postgres la evalúe UNA vez por consulta (initplan).
--    Las reglas de acceso son exactamente las mismas.
-- 2. pagos.orden_compra_id no tenía un índice completo: al devolver o cancelar
--    una orden, buscar sus pagos en dispersión recorría toda la tabla pagos
--    (O(n) por orden). Ahora es una búsqueda por índice.
-- 3. terceros_cuentas.estado sin índice: el filtro "cuentas pendientes de
--    verificar" (la pantalla de trabajo de Financiera) recorría todas las
--    cuentas.

-- ------------------------------------------------------------------ índices
create index if not exists idx_pagos_orden on public.pagos(orden_compra_id);
create index if not exists idx_terceros_cuentas_estado on public.terceros_cuentas(estado, tercero_id);

-- ---------------------------------------------------------------- políticas
drop policy if exists terceros_select on public.terceros;
create policy terceros_select on public.terceros
  for select to authenticated
  using ((select
    public.tiene_pestana(auth.uid(), 'ayf.terceros')
    or public.tiene_pestana(auth.uid(), 'ayf.aprobacion_pagos')
    or public.tiene_pestana(auth.uid(), 'ayf.consolidado')
  ));

drop policy if exists terceros_insert on public.terceros;
create policy terceros_insert on public.terceros
  for insert to authenticated
  with check ((select public.tiene_accion(auth.uid(), 'editar_terceros')));

drop policy if exists terceros_update on public.terceros;
create policy terceros_update on public.terceros
  for update to authenticated
  using ((select public.tiene_accion(auth.uid(), 'editar_terceros')))
  with check ((select public.tiene_accion(auth.uid(), 'editar_terceros')));

drop policy if exists terceros_cuentas_select on public.terceros_cuentas;
create policy terceros_cuentas_select on public.terceros_cuentas
  for select to authenticated
  using ((select
    public.tiene_pestana(auth.uid(), 'ayf.terceros')
    or public.tiene_pestana(auth.uid(), 'ayf.aprobacion_pagos')
    or public.tiene_pestana(auth.uid(), 'ayf.consolidado')
  ));

drop policy if exists terceros_cuentas_insert on public.terceros_cuentas;
create policy terceros_cuentas_insert on public.terceros_cuentas
  for insert to authenticated
  with check ((select public.tiene_accion(auth.uid(), 'editar_terceros')));

drop policy if exists terceros_cuentas_update on public.terceros_cuentas;
create policy terceros_cuentas_update on public.terceros_cuentas
  for update to authenticated
  using ((select public.tiene_accion(auth.uid(), 'editar_terceros')))
  with check ((select public.tiene_accion(auth.uid(), 'editar_terceros')));

drop policy if exists cuentas_empresa_select on public.cuentas_empresa;
create policy cuentas_empresa_select on public.cuentas_empresa
  for select to authenticated
  using ((select public.es_admin(auth.uid())));

drop policy if exists terceros_auditoria_select on public.terceros_auditoria;
create policy terceros_auditoria_select on public.terceros_auditoria
  for select to authenticated
  using ((select public.tiene_accion(auth.uid(), 'verificar_terceros')));

drop policy if exists pagos_select on public.pagos;
create policy pagos_select on public.pagos
  for select to authenticated
  using ((select
    public.tiene_pestana(auth.uid(), 'ayf.aprobacion_pagos')
    or public.tiene_pestana(auth.uid(), 'ayf.consolidado')
  ));

drop policy if exists pagos_fallos_select on public.pagos_fallos;
create policy pagos_fallos_select on public.pagos_fallos
  for select to authenticated
  using ((select public.tiene_pestana(auth.uid(), 'ayf.consolidado')));
