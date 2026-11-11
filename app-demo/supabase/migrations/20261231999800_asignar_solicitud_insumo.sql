-- "No existe — crear solicitud" (revisión del import): buscar o crear la
-- solicitud y colgarle las líneas en UNA transacción, de a una por insumo.
--
-- solicitudInsumoParaLinea (presupuestos/actions.ts, 2026-11-11) buscaba una
-- solicitud pendiente igual y, si no había, la creaba y luego le colgaba las
-- líneas, en pasos separados. Si el ingeniero guardaba dos tarjetas del mismo
-- insumo casi a la vez (el mismo insumo sale en capítulos distintos), las dos
-- podían buscar antes de que la otra terminara y crear dos solicitudes. Con
-- el candado por descripción + unidad, la segunda espera a la primera y
-- encuentra su solicitud.
--
-- Misma regla que enviar_insumos_sin_sugerencias: descripción sin mayúsculas
-- ni espacios de más, unidad sin mayúsculas, y solo se reutilizan solicitudes
-- que ya tienen líneas del import (una hecha a mano no tiene y se aprueba por
-- otro camino). Las líneas tienen que ser del mismo insumo (las agrupa la app).
-- SECURITY INVOKER: crear la solicitud y cambiar las líneas siguen pidiendo
-- los permisos de siempre (RLS).

create or replace function public.asignar_solicitud_insumo(p_revision_ids uuid[])
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_primera record;
  v_d text;
  v_u text;
  v_solicitud uuid;
begin
  if v_uid is null then
    raise exception 'Necesitas iniciar sesión.';
  end if;
  if p_revision_ids is null or cardinality(p_revision_ids) = 0 then
    raise exception 'Faltan las líneas.';
  end if;

  select r.descripcion_original, r.tipo, r.unidad, r.presupuesto_item_id into v_primera
  from public.apu_import_revision r
  where r.id = any(p_revision_ids) and r.estado <> 'resuelto'
  order by r.created_at, r.id
  limit 1;
  if not found then
    raise exception 'Esas líneas ya están resueltas.';
  end if;

  v_d := upper(regexp_replace(trim(v_primera.descripcion_original), '\s+', ' ', 'g'));
  v_u := lower(trim(coalesce(v_primera.unidad, '')));

  -- Una petición a la vez por insumo (también entre pestañas y personas).
  perform pg_advisory_xact_lock(hashtext('solicitud_insumo:' || v_d || '|' || v_u));

  select s.id into v_solicitud
  from public.solicitudes_insumos s
  where s.estado = 'pendiente'
    and upper(regexp_replace(trim(s.descripcion), '\s+', ' ', 'g')) = v_d
    and lower(trim(coalesce(s.u_m, ''))) = v_u
    and exists (select 1 from public.apu_import_revision ar where ar.solicitud_id = s.id)
  order by s.created_at, s.id
  limit 1;

  if v_solicitud is null then
    insert into public.solicitudes_insumos (descripcion, tipo, u_m, solicitado_por, presupuesto_item_id, estado)
    values (
      regexp_replace(trim(v_primera.descripcion_original), '\s+', ' ', 'g'),
      v_primera.tipo,
      nullif(trim(coalesce(v_primera.unidad, '')), ''),
      v_uid,
      v_primera.presupuesto_item_id,
      'pendiente'
    )
    returning id into v_solicitud;
  end if;

  update public.apu_import_revision
  set estado = 'solicitud_pendiente', solicitud_id = v_solicitud
  where id = any(p_revision_ids) and estado <> 'resuelto';

  return v_solicitud;
end;
$function$;

revoke execute on function public.asignar_solicitud_insumo(uuid[]) from public, anon;
grant execute on function public.asignar_solicitud_insumo(uuid[]) to authenticated;
