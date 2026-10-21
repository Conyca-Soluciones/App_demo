-- Consolidados y cuentas bancarias de las empresas con el mínimo acceso
-- (auditoría RLS 2026-10-20, regla del usuario: "dar acceso a las tablas
-- únicamente a las personas que lo necesitan").
-- Informe: docs/agentes/revisiones/2026-10-20/auditoria-rls.md
--
-- Antes:
--   consolidados: cualquiera con sesión (using true).
--   empresas_cuentas_bancarias: cualquiera con sesión leía los bancos y
--     números de cuenta de las empresas del conglomerado.
-- Ahora:
--   consolidados: pestaña Consolidado de pagos (y Administrador, que la tiene
--     siempre: Control administrativo asigna el consolidado de cada empresa).
--   empresas_cuentas_bancarias: solo Administrador. Ninguna pantalla la lee
--     directo hoy (los pagos usan las cuentas de los terceros).
-- Escribir no cambia (solo Administrador).

drop policy if exists consolidados_select on public.consolidados;
create policy consolidados_select on public.consolidados
  for select to authenticated
  using ((select public.tiene_pestana((select auth.uid()), 'ayf.consolidado')));

drop policy if exists empresas_cuentas_bancarias_select on public.empresas_cuentas_bancarias;
create policy empresas_cuentas_bancarias_select on public.empresas_cuentas_bancarias
  for select to authenticated
  using ((select public.es_admin((select auth.uid()))));
