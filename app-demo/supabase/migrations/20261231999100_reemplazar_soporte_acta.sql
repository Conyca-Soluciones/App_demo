-- Modificar un soporte del acta (decisión del usuario, 2026-11-11): junto a
-- cada soporte, "Modificar soporte" lo reemplaza por otro archivo del mismo
-- tipo (p. ej. la factura equivocada). Vale en cualquier estado del acta;
-- queda en el historial del acta con el nombre del archivo anterior y el
-- nuevo. Quien elabora actas y ve el proyecto. Devuelve la ruta del archivo
-- anterior para borrarlo del bucket (la política de borrado solo deja quitar
-- archivos que ya no son soporte de nada). Se puede correr más de una vez.

create or replace function public.reemplazar_soporte_acta(p_acta_id uuid, p_soporte_id uuid, p_soporte jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  s record;
begin
  if not public.tiene_accion(auth.uid(), 'elaborar_actas') then
    raise exception 'No tienes permiso para modificar los soportes del acta.';
  end if;
  select a.id, c.proyecto_id into v
    from actas a join contratos c on c.id = a.contrato_id where a.id = p_acta_id for update of a;
  if not found or not public.puede_ver_actas(v.proyecto_id) then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;

  delete from acta_soportes where id = p_soporte_id and acta_id = p_acta_id
  returning tipo, ruta, nombre_archivo into s;
  if not found then
    raise exception 'El soporte ya no existe (actualiza la página).';
  end if;

  -- El nuevo conserva el tipo del que reemplaza.
  perform public._agregar_soportes_acta(p_acta_id, jsonb_build_array(p_soporte || jsonb_build_object('tipo', s.tipo)));

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('acta', p_acta_id, 'soporte_reemplazado', auth.uid(),
          jsonb_build_object('tipo', s.tipo, 'anterior', s.nombre_archivo, 'nuevo', p_soporte->>'nombre_archivo'));
  return jsonb_build_object('ruta_anterior', s.ruta);
end;
$$;
revoke execute on function public.reemplazar_soporte_acta(uuid, uuid, jsonb) from public;
grant execute on function public.reemplazar_soporte_acta(uuid, uuid, jsonb) to authenticated;
