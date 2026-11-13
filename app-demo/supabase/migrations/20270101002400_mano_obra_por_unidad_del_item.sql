-- Aprobación de mano de obra y equipo (decisiones del usuario, 2026-11-12).
-- Ya aplicada en producción con el número 20270101002100; se renumeró al unir
-- con main, que usó ese número para los correos.
--
-- 1. La mano de obra se contrata por unidad de la actividad: 1 por unidad del
--    ítem (el total del ítem = valor de la actividad × cantidad del ítem). Los
--    cálculos ya lo hacían así (recalcular_valor_apus, _valor_mano_obra_item,
--    control_proyecto y la pantalla ignoran la cantidad de la línea de mano de
--    obra), pero el aprobador guardaba la cantidad de la línea del Excel, que
--    son HORAS de cuadrilla (0,5333): ahora guarda 1, para que lo guardado diga
--    lo mismo que se calcula. Y UNA sola línea por APU: con dos líneas de la
--    misma actividad el APU sumaba el valor dos veces. Las 52 líneas que ya
--    estaban con horas no se tocan (no cambian ningún valor).
--    Equipo no cambia (su cantidad sí es la del Excel).
-- 2. Solicitudes iguales = una sola: misma actividad (nombre sin mayúsculas ni
--    espacios de más) y misma unidad. Se guarda la unidad en la solicitud
--    (mano de obra: la del ítem; equipo: la de la línea del Excel) y se juntan
--    las pendientes que ya existen: sus líneas pasan a la más vieja, cada una
--    con su ítem y su cantidad. A futuro la app reutiliza la pendiente igual.
-- 3. solicitudes_recurso_por_aprobar(tipo): lo que muestra la pantalla de
--    aprobación (ítems con su cantidad y su capítulo).
--
-- No toca las líneas de mano de obra que ya están en los APU (no hace falta:
-- ningún cálculo usa su cantidad). Se puede correr más de una vez.

begin;

alter table public.solicitudes_mano_obra add column if not exists unidad text;
alter table public.solicitudes_equipo add column if not exists unidad text;

-- Clave para comparar unidades ("m²" = "M2" = " m2 ").
create or replace function public._clave_unidad(p text)
returns text
language sql
immutable
as $$
  select lower(trim(replace(replace(coalesce(p, ''), '²', '2'), '³', '3')))
$$;

-- Clave para comparar nombres de actividad.
create or replace function public._clave_actividad(p text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;

update public.solicitudes_mano_obra s
   set unidad = pi.unidad
  from public.presupuesto_items pi
 where pi.id = s.presupuesto_item_id and s.unidad is null;

update public.solicitudes_equipo s
   set unidad = (select r.unidad from public.apu_import_revision r
                  where r.solicitud_equipo_id = s.id and r.unidad is not null
                  order by r.created_at limit 1)
 where s.unidad is null;

-- Juntar las pendientes iguales: las líneas pasan a la más vieja.
update public.apu_import_revision r
   set solicitud_mano_obra_id = g.queda
  from (select id,
               first_value(id) over w as queda,
               row_number() over w as n
          from public.solicitudes_mano_obra
         where estado = 'pendiente'
        window w as (partition by public._clave_actividad(descripcion), public._clave_unidad(unidad) order by created_at, id)) g
 where r.solicitud_mano_obra_id = g.id and g.n > 1;

delete from public.solicitudes_mano_obra s
 using (select id,
               row_number() over (partition by public._clave_actividad(descripcion), public._clave_unidad(unidad) order by created_at, id) as n
          from public.solicitudes_mano_obra
         where estado = 'pendiente') g
 where s.id = g.id and g.n > 1
   and not exists (select 1 from public.apu_import_revision r where r.solicitud_mano_obra_id = s.id);

update public.apu_import_revision r
   set solicitud_equipo_id = g.queda
  from (select id,
               first_value(id) over w as queda,
               row_number() over w as n
          from public.solicitudes_equipo
         where estado = 'pendiente'
        window w as (partition by public._clave_actividad(descripcion), public._clave_unidad(unidad) order by created_at, id)) g
 where r.solicitud_equipo_id = g.id and g.n > 1;

delete from public.solicitudes_equipo s
 using (select id,
               row_number() over (partition by public._clave_actividad(descripcion), public._clave_unidad(unidad) order by created_at, id) as n
          from public.solicitudes_equipo
         where estado = 'pendiente') g
 where s.id = g.id and g.n > 1
   and not exists (select 1 from public.apu_import_revision r where r.solicitud_equipo_id = s.id);

-- Al aprobar mano de obra: una línea por APU, cantidad 1 por unidad del ítem.
create or replace function public.sincronizar_apu_import_revision_mano_obra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apu_id uuid;
  v_item_apu uuid;
begin
  if new.estado = old.estado or old.estado <> 'pendiente' then
    return new;
  end if;

  if new.estado = 'aprobado' then
    if new.categoria_asignada_id is null then
      return new;
    end if;

    for v_apu_id in
      select distinct r.apu_id
        from public.apu_import_revision r
       where r.solicitud_mano_obra_id = new.id and r.item_apu_id is null
    loop
      insert into public.item_apu (apu_id, mano_obra_categoria_id, cantidad, rendimiento, tipo)
      values (v_apu_id, new.categoria_asignada_id, 1, 1, 'MO')
      returning id into v_item_apu;

      update public.apu_import_revision r
         set estado = 'resuelto',
             mano_obra_categoria_id_asignado = new.categoria_asignada_id,
             item_apu_id = v_item_apu
       where r.solicitud_mano_obra_id = new.id
         and r.apu_id = v_apu_id
         and r.item_apu_id is null;

      perform public.recalcular_valor_apu(v_apu_id);
    end loop;

  elsif new.estado = 'rechazado' then
    update public.apu_import_revision
       set estado = 'rechazado'
     where solicitud_mano_obra_id = new.id;
  end if;

  return new;
end;
$$;

-- Lo que muestra Aprobación de mano de obra y equipos: cada solicitud con los
-- ítems que la usan (código, cantidad, unidad, capítulo y proyecto). Con la
-- RLS de quien consulta (ve solo los ítems de sus proyectos, como antes).
create or replace function public.solicitudes_recurso_por_aprobar(p_tipo text)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_mano_obra') then
    raise exception 'No tienes permiso para aprobar mano de obra y equipos.';
  end if;
  if p_tipo not in ('mano_obra', 'equipo') then
    raise exception 'Tipo no válido.';
  end if;

  with recursive sol as (
    select s.id, s.descripcion, s.unidad, s.grupo_sugerido, s.valor_propuesto, s.created_at,
           s.solicitado_por, s.presupuesto_item_id
      from public.solicitudes_mano_obra s
     where p_tipo = 'mano_obra' and s.estado = 'pendiente'
    union all
    select s.id, s.descripcion, s.unidad, s.grupo_sugerido, s.valor_propuesto, s.created_at,
           s.solicitado_por, s.presupuesto_item_id
      from public.solicitudes_equipo s
     where p_tipo = 'equipo' and s.estado = 'pendiente'
  ), lin as (
    select r.solicitud_mano_obra_id as sid, r.presupuesto_item_id as pid
      from public.apu_import_revision r
     where p_tipo = 'mano_obra' and r.solicitud_mano_obra_id in (select id from sol)
    union
    select r.solicitud_equipo_id, r.presupuesto_item_id
      from public.apu_import_revision r
     where p_tipo = 'equipo' and r.solicitud_equipo_id in (select id from sol)
    union
    select id, presupuesto_item_id from sol where presupuesto_item_id is not null
  ), sube as (
    select distinct l.pid, pi.id as actual, pi.padre_id as padre
      from lin l join public.presupuesto_items pi on pi.id = l.pid
    union all
    select s.pid, p.id, p.padre_id
      from sube s join public.presupuesto_items p on p.id = s.padre
  ), cap as (
    select s.pid, p.codigo, p.descripcion
      from sube s join public.presupuesto_items p on p.id = s.actual
     where s.padre is null
  ), it as (
    select l.sid, pi.codigo, pi.cantidad, pi.unidad, c.codigo as cap_codigo, c.descripcion as cap_desc,
           pr.codigo as proyecto
      from lin l
      join public.presupuesto_items pi on pi.id = l.pid
      left join cap c on c.pid = l.pid
      left join public.presupuestos p on p.id = pi.presupuesto_id
      left join public.proyectos pr on pr.id = p.proyecto_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'descripcion', s.descripcion,
           'unidad', s.unidad,
           'grupo_sugerido', s.grupo_sugerido,
           'valor_propuesto', s.valor_propuesto,
           'created_at', s.created_at,
           'solicitado_por_nombre', pf.nombre,
           'items', coalesce((select jsonb_agg(jsonb_build_object(
                      'codigo', i.codigo, 'cantidad', i.cantidad, 'unidad', i.unidad,
                      'capitulo_codigo', i.cap_codigo, 'capitulo', i.cap_desc, 'proyecto', i.proyecto))
                      from it i where i.sid = s.id), '[]'::jsonb))
           order by s.created_at, s.id), '[]'::jsonb)
    into v
    from sol s
    left join public.perfiles pf on pf.id = s.solicitado_por;
  return v;
end;
$$;
revoke all on function public.solicitudes_recurso_por_aprobar(text) from public, anon;
grant execute on function public.solicitudes_recurso_por_aprobar(text) to authenticated;

commit;
