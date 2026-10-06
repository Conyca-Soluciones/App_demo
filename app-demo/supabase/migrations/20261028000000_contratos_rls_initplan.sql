-- Contratos · políticas de lectura de contratistas con (select auth.uid()) literal.
--
-- El asesor de rendimiento de Supabase (auth_rls_initplan) marca estas dos
-- políticas aunque ya se evalúan una vez por consulta, porque solo reconoce
-- `(select auth.uid())` escrito tal cual. Mismas reglas de acceso que la
-- versión de 20261014000000_preaprobacion_contratos.sql (la última): solo
-- cambia cómo está escrito.

drop policy if exists contratistas_select on public.contratistas;
create policy contratistas_select on public.contratistas for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'contratos.contratistas'))
    or (select public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion'))
    or (select public.tiene_accion((select auth.uid()), 'gestionar_contratistas'))
    or (select public.tiene_accion((select auth.uid()), 'solicitar_contratos'))
  );

drop policy if exists contratista_documentos_select on public.contratista_documentos;
create policy contratista_documentos_select on public.contratista_documentos for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'contratos.contratistas'))
    or (select public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion'))
    or (select public.tiene_accion((select auth.uid()), 'gestionar_contratistas'))
    or (select public.tiene_accion((select auth.uid()), 'solicitar_contratos'))
  );
