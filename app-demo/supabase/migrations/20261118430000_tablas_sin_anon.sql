-- Sin sesión no se lee ni se escribe ninguna tabla de public (auditoría RLS
-- 2026-10-20). Informe: docs/agentes/revisiones/2026-10-20/auditoria-rls.md
--
-- Hoy anon (la llave pública, sin iniciar sesión) tiene SELECT, INSERT,
-- UPDATE y DELETE sobre casi todas las tablas y vistas de public. Lo único que
-- lo frena son las políticas que piden auth.uid(); varias son "to public"
-- (empresas, grupos, maestro_insumos, solicitudes...). Una política nueva mal
-- escrita (por ejemplo "using (true)" sin "to authenticated") quedaría abierta
-- a internet. Con esto, la defensa no depende de cada política.
-- Ninguna pantalla lee tablas sin sesión: el login usa Supabase Auth y las
-- funciones ya no son ejecutables por anon (20261005200000_funciones_sin_anon).

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Las tablas nuevas tampoco.
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;
