-- Volumen: inventario y ejecución completos, y solicitudes resueltas que no se
-- guardan.
--
-- 1. Inventario y resumen de ejecución en UNA respuesta jsonb. La API corta
--    cada respuesta en 1000 FILAS sin avisar: inventario_proyecto y
--    resumen_ejecucion_proyecto devuelven una fila por insumo, así que un
--    proyecto con más de 1000 insumos se veía incompleto (y en Salidas un
--    insumo fuera de esas filas aparecía "sin disponible"). Un jsonb es una
--    sola fila: llega completo en un viaje, calculado una sola vez (pedir por
--    páginas con .range recalcularía todo el proyecto en cada página).
--    Los totales de Visualización se siguen sumando en el navegador: con la
--    lista completa la suma es exacta y lineal.
--
-- 2. Solicitudes de insumo / mano de obra / equipo: solo existen mientras
--    están pendientes. Al aprobarlas o rechazarlas, la acción del servidor
--    llama a borrar_solicitud_resuelta AL FINAL (no en un trigger: aprobar un
--    insumo todavía lee las líneas del import por solicitud_id después del
--    UPDATE, y la FK con ON DELETE SET NULL las soltaría antes de tiempo).
--    El motivo de rechazo, que el ingeniero ve en la revisión del import,
--    pasa a apu_import_revision.motivo_rechazo antes de borrar.
--
-- Se puede correr más de una vez.

-- ------------------------------------------------- 1. respuestas completas
create or replace function public.inventario_proyecto_completo(p_proyecto_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes permiso para ver el inventario de este proyecto.';
  end if;
  return coalesce(
    (select jsonb_agg(to_jsonb(i) order by i.insumo_codigo) from public._inventario_proyecto(p_proyecto_id) i),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.inventario_proyecto_completo(uuid) from public, anon;
grant execute on function public.inventario_proyecto_completo(uuid) to authenticated;

create or replace function public.resumen_ejecucion_proyecto_completo(p_proyecto_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  -- _resumen_ejecucion_proyecto valida la pestaña admin.visualizacion y el
  -- acceso al proyecto.
  return coalesce(
    (select jsonb_agg(to_jsonb(r) order by r.insumo_codigo) from public._resumen_ejecucion_proyecto(p_proyecto_id) r),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.resumen_ejecucion_proyecto_completo(uuid) from public, anon;
grant execute on function public.resumen_ejecucion_proyecto_completo(uuid) to authenticated;

-- ------------------------------------- 2. solicitudes resueltas se borran
alter table public.apu_import_revision
  add column if not exists motivo_rechazo text;

-- p_tipo: 'insumo' | 'mano_obra' | 'equipo'. Solo borra si ya no está
-- pendiente y si ninguna línea del import sigue esperándola (si el trigger de
-- aprobación no alcanzó a resolverlas, borrarla las dejaría huérfanas).
create or replace function public.borrar_solicitud_resuelta(p_tipo text, p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_estado text;
  v_motivo text;
begin
  if p_tipo = 'insumo' then
    if not public.admin_insumos(auth.uid()) then
      raise exception 'No tienes permiso para resolver solicitudes de insumos.';
    end if;
    select estado, motivo_rechazo into v_estado, v_motivo
      from solicitudes_insumos where id = p_id for update;
    if v_estado is null or v_estado = 'pendiente' then return; end if;
    if exists (select 1 from apu_import_revision
                where solicitud_id = p_id and estado in ('pendiente', 'solicitud_pendiente')) then
      return;
    end if;
    if v_estado = 'rechazado' then
      update apu_import_revision set motivo_rechazo = v_motivo where solicitud_id = p_id;
    end if;
    delete from solicitudes_insumos where id = p_id;

  elsif p_tipo = 'mano_obra' then
    if not public.tiene_accion(auth.uid(), 'aprobar_mano_obra') then
      raise exception 'No tienes permiso para resolver solicitudes de mano de obra.';
    end if;
    select estado, motivo_rechazo into v_estado, v_motivo
      from solicitudes_mano_obra where id = p_id for update;
    if v_estado is null or v_estado = 'pendiente' then return; end if;
    if exists (select 1 from apu_import_revision
                where solicitud_mano_obra_id = p_id and estado in ('pendiente', 'solicitud_pendiente')) then
      return;
    end if;
    if v_estado = 'rechazado' then
      update apu_import_revision set motivo_rechazo = v_motivo where solicitud_mano_obra_id = p_id;
    end if;
    delete from solicitudes_mano_obra where id = p_id;

  elsif p_tipo = 'equipo' then
    if not public.tiene_accion(auth.uid(), 'aprobar_mano_obra') then
      raise exception 'No tienes permiso para resolver solicitudes de equipo.';
    end if;
    select estado, motivo_rechazo into v_estado, v_motivo
      from solicitudes_equipo where id = p_id for update;
    if v_estado is null or v_estado = 'pendiente' then return; end if;
    if exists (select 1 from apu_import_revision
                where solicitud_equipo_id = p_id and estado in ('pendiente', 'solicitud_pendiente')) then
      return;
    end if;
    if v_estado = 'rechazado' then
      update apu_import_revision set motivo_rechazo = v_motivo where solicitud_equipo_id = p_id;
    end if;
    delete from solicitudes_equipo where id = p_id;

  else
    raise exception 'Tipo de solicitud desconocido: %', p_tipo;
  end if;
end;
$$;

revoke all on function public.borrar_solicitud_resuelta(text, uuid) from public, anon;
grant execute on function public.borrar_solicitud_resuelta(text, uuid) to authenticated;

-- ------------------------------------- limpieza de las ya resueltas (una vez)
-- Mismas reglas que borrar_solicitud_resuelta: copiar el motivo, y no tocar
-- las que todavía tienen líneas del import esperándolas.
update public.apu_import_revision r set motivo_rechazo = s.motivo_rechazo
  from public.solicitudes_insumos s
 where r.solicitud_id = s.id and s.estado = 'rechazado' and r.motivo_rechazo is null;
update public.apu_import_revision r set motivo_rechazo = s.motivo_rechazo
  from public.solicitudes_mano_obra s
 where r.solicitud_mano_obra_id = s.id and s.estado = 'rechazado' and r.motivo_rechazo is null;
update public.apu_import_revision r set motivo_rechazo = s.motivo_rechazo
  from public.solicitudes_equipo s
 where r.solicitud_equipo_id = s.id and s.estado = 'rechazado' and r.motivo_rechazo is null;

delete from public.solicitudes_insumos s
 where s.estado <> 'pendiente'
   and not exists (select 1 from public.apu_import_revision r
                    where r.solicitud_id = s.id and r.estado in ('pendiente', 'solicitud_pendiente'));
delete from public.solicitudes_mano_obra s
 where s.estado <> 'pendiente'
   and not exists (select 1 from public.apu_import_revision r
                    where r.solicitud_mano_obra_id = s.id and r.estado in ('pendiente', 'solicitud_pendiente'));
delete from public.solicitudes_equipo s
 where s.estado <> 'pendiente'
   and not exists (select 1 from public.apu_import_revision r
                    where r.solicitud_equipo_id = s.id and r.estado in ('pendiente', 'solicitud_pendiente'));
