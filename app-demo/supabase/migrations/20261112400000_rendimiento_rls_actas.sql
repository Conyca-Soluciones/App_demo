-- Rendimiento: las políticas de actas sin funciones de permiso por fila.
--
-- actas_select llamaba puede_ver_actas(c.proyecto_id) en CADA fila (dentro del
-- exists), y acta_lineas_select y el SELECT de Storage repetían lo mismo. Con
-- el patrón del resto de la app (20261012100000 / 20261012200000):
--   * lo que no depende de la fila (¿tiene la pestaña?) va en (select f(...)):
--     se evalúa una vez por consulta;
--   * "¿puede ver el proyecto?" = proyecto_id in (select proyectos_visibles(uid)),
--     misma respuesta que usuario_puede_ver_proyecto (mismos tres caminos:
--     administrador / ve todos, proyecto asignado, grupo sin rol);
--   * las tablas hijas solo piden que el acta exista: la subconsulta sobre
--     actas ya aplica su política.
-- Mismas filas que antes. puede_ver_actas sigue existiendo (la usan las RPC).
-- Se puede correr más de una vez.

drop policy if exists actas_select on public.actas;
create policy actas_select on public.actas for select to authenticated
  using (
    ((select public.tiene_pestana((select auth.uid()), 'contratos.cortes'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_actas')))
    and exists (
      select 1 from public.contratos c
      where c.id = actas.contrato_id
        and c.proyecto_id in (select public.proyectos_visibles((select auth.uid())))
    )
  );

drop policy if exists acta_lineas_select on public.acta_lineas;
create policy acta_lineas_select on public.acta_lineas for select to authenticated
  using (exists (select 1 from public.actas a where a.id = acta_lineas.acta_id));

-- Soportes en Storage: carpeta = id del acta; ver el archivo = ver el acta.
drop policy if exists actas_archivos_select on storage.objects;
create policy actas_archivos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'actas'
    and exists (select 1 from public.actas a where a.id::text = (storage.foldername(objects.name))[1])
  );

-- Mismo envoltorio en el borrado (auth.uid() dentro del select).
drop policy if exists actas_archivos_delete on storage.objects;
create policy actas_archivos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'actas'
    and (select public.tiene_accion((select auth.uid()), 'elaborar_actas'))
    and not exists (select 1 from public.acta_soportes s where s.ruta = objects.name)
  );

drop policy if exists actas_archivos_insert on storage.objects;
create policy actas_archivos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'actas'
    and (select public.tiene_accion((select auth.uid()), 'elaborar_actas'))
  );
