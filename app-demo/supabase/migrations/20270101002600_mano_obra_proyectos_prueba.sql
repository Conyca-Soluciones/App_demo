-- Solicitudes de mano de obra y equipo: los proyectos de prueba no se juntan
-- con los reales (decisión del usuario, 2026-11-13).
--
-- 20270101002400 junta las solicitudes iguales (misma actividad y unidad) de
-- cualquier proyecto. Al probar en CAPACITACION, sus líneas se colgaron de las
-- solicitudes del Malecón: aprobar la prueba aprobaba también lo real.
--
-- Ámbito de un ítem (_ambito_item): el id del proyecto si es de prueba
-- (proyectos.excluir_de_precios, hoy CAPACITACION); 'real' para los demás. Las
-- solicitudes solo se juntan dentro del mismo ámbito (la app lo revisa al
-- reutilizar la pendiente igual). Esta migración separa las líneas que ya
-- quedaron en una solicitud de otro ámbito: les crea su propia solicitud (con
-- la misma actividad y unidad), cada línea con su ítem y su cantidad.
--
-- OJO: no volver a correr 20270101002400 ni 20270101002500 (juntan sin mirar el
-- ámbito). Esta sí se puede correr más de una vez.

create or replace function public._ambito_item(p_item uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case when pr.excluir_de_precios then pr.id::text else 'real' end
      from presupuesto_items pi
      join presupuestos p on p.id = pi.presupuesto_id
      join proyectos pr on pr.id = p.proyecto_id
     where pi.id = p_item), 'real')
$$;
revoke all on function public._ambito_item(uuid) from public, anon, authenticated;

do $$
declare
  g record;
  v_nueva uuid;
begin
  -- Mano de obra
  for g in
    select s.id as sid, s.descripcion, s.unidad, s.grupo_sugerido,
           public._ambito_item(r.presupuesto_item_id) as ambito,
           array_agg(r.id) as lineas,
           (array_agg(r.presupuesto_item_id order by r.created_at))[1] as item
      from public.solicitudes_mano_obra s
      join public.apu_import_revision r on r.solicitud_mano_obra_id = s.id
     where s.estado = 'pendiente'
       and public._ambito_item(r.presupuesto_item_id) <> public._ambito_item(s.presupuesto_item_id)
     group by s.id, s.descripcion, s.unidad, s.grupo_sugerido, public._ambito_item(r.presupuesto_item_id)
  loop
    insert into public.solicitudes_mano_obra (descripcion, unidad, grupo_sugerido, presupuesto_item_id, estado)
    values (g.descripcion, g.unidad, g.grupo_sugerido, g.item, 'pendiente')
    returning id into v_nueva;
    update public.apu_import_revision set solicitud_mano_obra_id = v_nueva where id = any (g.lineas);
  end loop;

  -- Equipo
  for g in
    select s.id as sid, s.descripcion, s.unidad, s.grupo_sugerido,
           public._ambito_item(r.presupuesto_item_id) as ambito,
           array_agg(r.id) as lineas,
           (array_agg(r.presupuesto_item_id order by r.created_at))[1] as item
      from public.solicitudes_equipo s
      join public.apu_import_revision r on r.solicitud_equipo_id = s.id
     where s.estado = 'pendiente'
       and public._ambito_item(r.presupuesto_item_id) <> public._ambito_item(s.presupuesto_item_id)
     group by s.id, s.descripcion, s.unidad, s.grupo_sugerido, public._ambito_item(r.presupuesto_item_id)
  loop
    insert into public.solicitudes_equipo (descripcion, unidad, grupo_sugerido, presupuesto_item_id, estado)
    values (g.descripcion, g.unidad, g.grupo_sugerido, g.item, 'pendiente')
    returning id into v_nueva;
    update public.apu_import_revision set solicitud_equipo_id = v_nueva where id = any (g.lineas);
  end loop;
end $$;
