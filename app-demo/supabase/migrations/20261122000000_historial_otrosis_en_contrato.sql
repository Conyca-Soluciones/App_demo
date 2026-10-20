-- ---------------------------------------------------------------------------
-- Historial del contrato con sus otrosí (2026-10-20, pedido del usuario).
-- historial_entidad('contrato', id) no se toca: esta función devuelve los
-- eventos de los otrosí del contrato con el mismo formato y el evento con
-- prefijo "otrosi_" (otrosi_creado, otrosi_aprobado...), y la app los junta
-- por fecha (app/(app)/almacen/historial/actions.ts). `datos` lleva el número
-- del otrosí (si ya lo tiene) y las cláusulas. Ve quien puede ver otrosí
-- (_puede_ver_otrosis: también las pestañas que ven contratos) y el proyecto.
-- ---------------------------------------------------------------------------

create or replace function public.historial_otrosis_de_contrato(p_contrato_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public._puede_ver_otrosis(v_uid)
     or not exists (select 1 from contratos c
                     where c.id = p_contrato_id and c.proyecto_id in (select public.proyectos_visibles(v_uid))) then
    raise exception 'No tienes permiso para ver este historial.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'evento', 'otrosi_' || h.evento, 'usuario_nombre', pf.nombre, 'usuario_rol', r.nombre,
             'motivo', h.motivo,
             'datos', coalesce(h.datos, '{}'::jsonb) || jsonb_build_object(
                        'otrosi_id', o.id,
                        'otrosi_numero', coalesce((h.datos->>'numero')::int, o.numero),
                        'clausulas', (select string_agg(e->>'clausula', ' · ') from jsonb_array_elements(o.modificaciones) e)),
             'created_at', h.created_at
           ) order by h.created_at, h.id)
      from otrosis o
      join historial_eventos h on h.entidad_tipo = 'otrosi' and h.entidad_id = o.id
      left join perfiles pf on pf.id = h.usuario_id
      left join roles r on r.id = pf.rol_id
     where o.contrato_id = p_contrato_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.historial_otrosis_de_contrato(uuid) from public, anon;
grant execute on function public.historial_otrosis_de_contrato(uuid) to authenticated;
