-- A&F · Migración 5: quien ve pagos también puede LEER los terceros y sus
-- cuentas.
--
-- Las pantallas de Aprobación de pagos y del Consolidado muestran a quién se le
-- paga y a qué cuenta. Sin esto, un rol con esas pestañas pero sin la pestaña
-- Terceros (por ejemplo Gerencia) vería los pagos sin el nombre del tercero.
-- Solo lectura: crear, editar y verificar siguen exigiendo sus acciones.

drop policy if exists terceros_select on public.terceros;
create policy terceros_select on public.terceros
  for select to authenticated
  using (
    public.tiene_pestana((select auth.uid()), 'ayf.terceros')
    or public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
    or public.tiene_pestana((select auth.uid()), 'ayf.consolidado')
  );

drop policy if exists terceros_cuentas_select on public.terceros_cuentas;
create policy terceros_cuentas_select on public.terceros_cuentas
  for select to authenticated
  using (
    public.tiene_pestana((select auth.uid()), 'ayf.terceros')
    or public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
    or public.tiene_pestana((select auth.uid()), 'ayf.consolidado')
  );
