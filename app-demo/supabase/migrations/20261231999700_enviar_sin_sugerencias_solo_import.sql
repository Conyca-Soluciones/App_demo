-- "Enviar a aprobación insumos sin sugerencia": solo reutiliza solicitudes
-- pendientes que ya tengan líneas del import.
--
-- Antes buscaba cualquier solicitud pendiente con la misma descripción y
-- unidad. Si la única era una hecha A MANO desde el editor de APU (sin
-- líneas del import), le colgaba las líneas del Excel; al aprobarla,
-- aprobarSolicitudInsumo la trata como del import (crea solo esas líneas) y
-- la línea del ítem que la pidió a mano no se creaba nunca, sin aviso.
-- Ahora en ese caso se crea una solicitud aparte para el import. Misma regla
-- que solicitudInsumoParaLinea (presupuestos/actions.ts) y que
-- 20261231999600.
--
-- Mismo cuerpo que la versión viva (20261117000000), salvo:
--   * la solicitud que se reutiliza tiene que tener líneas del import;
--   * las recién creadas aquí se guardan en v_creadas para repartirles las
--     líneas (todavía no tienen ninguna).

create or replace function public.enviar_insumos_sin_sugerencias(p_presupuesto_id uuid)
 returns table(lineas integer, insumos integer, solicitudes_nuevas integer)
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_version uuid;
  v_proyecto uuid;
  v_lineas integer;
  v_insumos integer;
  v_nuevas integer;
  v_creadas uuid[];
begin
  if v_uid is null then
    raise exception 'Necesitas iniciar sesión.';
  end if;

  select p.version_actual_id, p.proyecto_id into v_version, v_proyecto
  from public.presupuestos p
  where p.id = p_presupuesto_id;
  if v_version is null then
    raise exception 'El presupuesto no existe o no tiene versión vigente.';
  end if;
  if not public.tiene_accion(v_uid, 'editar_presupuestos')
     or not public.usuario_puede_editar_proyecto(v_uid, v_proyecto) then
    raise exception 'No tienes permiso para editar este presupuesto.';
  end if;

  -- Dos clics seguidos no crean solicitudes repetidas.
  perform pg_advisory_xact_lock(hashtext('enviar_insumos_sin_sugerencias:' || p_presupuesto_id::text));

  with lineas as (
    select upper(regexp_replace(trim(r.descripcion_original), '\s+', ' ', 'g')) as d,
           lower(trim(coalesce(r.unidad, ''))) as u
    from public.apu_import_revision r
    join public.presupuesto_items pi on pi.id = r.presupuesto_item_id
    where pi.version_id = v_version
      and r.tipo = 'INSUMO'
      and r.estado = 'pendiente'
      and coalesce(jsonb_array_length(r.candidatos), 0) = 0
      and trim(coalesce(r.descripcion_original, '')) <> ''
  ),
  grupos as (select d, u from lineas group by d, u)
  select (select count(*) from lineas)::integer,
         (select count(*) from grupos)::integer,
         (select count(*) from grupos g
          where not exists (
            select 1 from public.solicitudes_insumos s
            where s.estado = 'pendiente'
              and upper(regexp_replace(trim(s.descripcion), '\s+', ' ', 'g')) = g.d
              and lower(trim(coalesce(s.u_m, ''))) = g.u
              and exists (select 1 from public.apu_import_revision ar where ar.solicitud_id = s.id)
          ))::integer
  into v_lineas, v_insumos, v_nuevas;

  if v_lineas = 0 then
    return query select v_lineas, v_insumos, v_nuevas;
    return;
  end if;

  -- Una solicitud por insumo que todavía no tenga una pendiente del import.
  -- La descripción y la unidad son las de la primera línea del grupo; el
  -- ítem, el de esa misma línea (solo para mostrar de dónde salió).
  with creadas as (
    insert into public.solicitudes_insumos (descripcion, u_m, solicitado_por, presupuesto_item_id, estado)
    select distinct on (x.d, x.u)
           regexp_replace(trim(x.descripcion_original), '\s+', ' ', 'g'),
           nullif(trim(coalesce(x.unidad, '')), ''),
           v_uid,
           x.presupuesto_item_id,
           'pendiente'
    from (
      select r.*,
             upper(regexp_replace(trim(r.descripcion_original), '\s+', ' ', 'g')) as d,
             lower(trim(coalesce(r.unidad, ''))) as u
      from public.apu_import_revision r
      join public.presupuesto_items pi on pi.id = r.presupuesto_item_id
      where pi.version_id = v_version
        and r.tipo = 'INSUMO'
        and r.estado = 'pendiente'
        and coalesce(jsonb_array_length(r.candidatos), 0) = 0
        and trim(coalesce(r.descripcion_original, '')) <> ''
    ) x
    where not exists (
      select 1 from public.solicitudes_insumos s
      where s.estado = 'pendiente'
        and upper(regexp_replace(trim(s.descripcion), '\s+', ' ', 'g')) = x.d
        and lower(trim(coalesce(s.u_m, ''))) = x.u
        and exists (select 1 from public.apu_import_revision ar where ar.solicitud_id = s.id)
    )
    order by x.d, x.u, x.created_at, x.id
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_creadas from creadas;

  -- Cada línea a la solicitud pendiente más antigua de su insumo, entre las
  -- del import (con líneas) y las recién creadas.
  with destino as (
    select distinct on (d, u) id, d, u
    from (
      select s.id, s.created_at,
             upper(regexp_replace(trim(s.descripcion), '\s+', ' ', 'g')) as d,
             lower(trim(coalesce(s.u_m, ''))) as u
      from public.solicitudes_insumos s
      where s.estado = 'pendiente'
        and (s.id = any(v_creadas)
             or exists (select 1 from public.apu_import_revision ar where ar.solicitud_id = s.id))
    ) s
    order by d, u, created_at, id
  )
  update public.apu_import_revision r
  set estado = 'solicitud_pendiente',
      solicitud_id = destino.id
  from public.presupuesto_items pi, destino
  where destino.d = upper(regexp_replace(trim(r.descripcion_original), '\s+', ' ', 'g'))
    and destino.u = lower(trim(coalesce(r.unidad, '')))
    and pi.id = r.presupuesto_item_id
    and pi.version_id = v_version
    and r.tipo = 'INSUMO'
    and r.estado = 'pendiente'
    and coalesce(jsonb_array_length(r.candidatos), 0) = 0
    and trim(coalesce(r.descripcion_original, '')) <> '';

  return query select v_lineas, v_insumos, v_nuevas;
end;
$function$;
