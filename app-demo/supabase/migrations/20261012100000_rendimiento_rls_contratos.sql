-- Rendimiento de las políticas RLS de Contratos (medido con datos simulados,
-- en una transacción revertida):
--
--   3.000 contratistas + 12.000 documentos:      97 ms ->   7 ms
--   2.000 solicitudes de un proyecto (lista):   2.122 ms ->   8 ms
--   detalle de una solicitud:                    23 ms ->   5 ms
--
-- No eran O(n²), pero cada política llamaba sus funciones de permiso UNA VEZ
-- POR FILA (tiene_pestana / tiene_accion / usuario_puede_ver_proyecto, cada
-- una con sus propias consultas). Ahora:
--   * Lo que no depende de la fila va en (select f(...)): Postgres lo evalúa
--     una sola vez por consulta (initplan).
--   * "¿Puede ver el proyecto?" se resuelve con el CONJUNTO de proyectos
--     visibles del usuario, calculado una vez (proyectos_visibles), en vez de
--     una llamada por fila.
--   * Las tablas hijas (obligaciones, anexo, documentos...) solo exigen que el
--     contrato exista: la subconsulta a `contratos` ya pasa por SU política.

-- Mismos proyectos que acepta usuario_puede_ver_proyecto (verificado para
-- todos los usuarios x proyectos al aplicar esta migración).
create or replace function public.proyectos_visibles(p_usuario_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.proyectos p
  where public.es_admin(p_usuario_id) or public.usuario_ve_todos_proyectos(p_usuario_id)
  union
  select up.proyecto_id from public.usuario_proyectos up where up.usuario_id = p_usuario_id
  union
  -- Los grupos solo cuentan para usuarios que todavía no tienen rol.
  select gp.proyecto_id
  from public.perfiles pf
  join public.usuario_grupos ug on ug.usuario_id = pf.id
  join public.grupo_proyectos gp on gp.grupo_id = ug.grupo_id
  where pf.id = p_usuario_id and pf.rol_id is null
$$;
revoke all on function public.proyectos_visibles(uuid) from public, anon;
grant execute on function public.proyectos_visibles(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- contratistas
drop policy if exists contratistas_select on public.contratistas;
create policy contratistas_select on public.contratistas for select to authenticated
  using (
    (select public.tiene_pestana(auth.uid(), 'contratos.contratistas'))
    or (select public.tiene_accion(auth.uid(), 'gestionar_contratistas'))
    or (select public.tiene_accion(auth.uid(), 'solicitar_contratos'))
  );

drop policy if exists contratista_documentos_select on public.contratista_documentos;
create policy contratista_documentos_select on public.contratista_documentos for select to authenticated
  using (
    (select public.tiene_pestana(auth.uid(), 'contratos.contratistas'))
    or (select public.tiene_accion(auth.uid(), 'gestionar_contratistas'))
    or (select public.tiene_accion(auth.uid(), 'solicitar_contratos'))
  );

-- ---------------------------------------------------------------- contratos
drop policy if exists contratos_select on public.contratos;
create policy contratos_select on public.contratos for select to authenticated
  using (
    (
      (select public.tiene_pestana(auth.uid(), 'contratos.solicitar'))
      or (select public.tiene_pestana(auth.uid(), 'contratos.contratos'))
    )
    and proyecto_id in (select public.proyectos_visibles((select auth.uid())))
  );

drop policy if exists contrato_obligaciones_select on public.contrato_obligaciones;
create policy contrato_obligaciones_select on public.contrato_obligaciones for select to authenticated
  using (exists (select 1 from public.contratos c where c.id = contrato_id));

drop policy if exists contrato_entregables_select on public.contrato_entregables;
create policy contrato_entregables_select on public.contrato_entregables for select to authenticated
  using (exists (select 1 from public.contratos c where c.id = contrato_id));

drop policy if exists contrato_anexo_items_select on public.contrato_anexo_items;
create policy contrato_anexo_items_select on public.contrato_anexo_items for select to authenticated
  using (exists (select 1 from public.contratos c where c.id = contrato_id));

drop policy if exists contrato_documentos_select on public.contrato_documentos;
create policy contrato_documentos_select on public.contrato_documentos for select to authenticated
  using (exists (select 1 from public.contratos c where c.id = contrato_id));

-- ---------------------------------------------------------------- Storage
drop policy if exists contratistas_archivos_select on storage.objects;
create policy contratistas_archivos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'contratistas'
    and (
      (select public.tiene_pestana(auth.uid(), 'contratos.contratistas'))
      or (select public.tiene_accion(auth.uid(), 'gestionar_contratistas'))
    )
  );

-- Un archivo de `contratos` se ve si su contrato (carpeta) es visible: la
-- subconsulta a `contratos` ya aplica la política de arriba.
drop policy if exists contratos_archivos_select on storage.objects;
create policy contratos_archivos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'contratos'
    and exists (select 1 from public.contratos c where c.id::text = (storage.foldername(name))[1])
  );

-- Ya no la usa ninguna política (la reemplazan las de arriba).
drop function if exists public.puede_ver_contrato(uuid);
