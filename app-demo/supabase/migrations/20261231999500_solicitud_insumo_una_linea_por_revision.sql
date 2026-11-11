-- Aprobar una solicitud de insumo nuevo: cada línea del import recibe SU
-- propia línea de APU, con SU cantidad, y queda enlazada a ella.
--
-- Antes el disparador insertaba todas las líneas de un APU juntas y después
-- las enlazaba buscando por (apu_id, insumo_id). Las cantidades quedaban
-- bien, pero si el mismo insumo estaba dos veces en el mismo APU (dos
-- líneas del Excel en el mismo ítem), las dos líneas de revisión quedaban
-- enlazadas a la MISMA fila de item_apu: la conversión de unidad que pone
-- aprobarSolicitudInsumo, o corregir el insumo después, caía en la fila
-- equivocada. Ahora se inserta línea por línea y se guarda el id que
-- devuelve el insert. Importa más desde que las solicitudes iguales se
-- juntan en una sola (2026-11-11): una solicitud puede tener muchas líneas.
--
-- Recálculo: una vez por APU, al final (como antes).

create or replace function public.sincronizar_apu_import_revision()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_insumo_id uuid;
  v_r record;
  v_item_apu_id uuid;
  v_apu_id uuid;
begin
  -- Solo actuar si el estado de verdad cambió, y solo para transiciones
  -- desde 'pendiente' -- evita re-disparar si algo más toca la fila.
  if new.estado = old.estado or old.estado <> 'pendiente' then
    return new;
  end if;

  if new.estado = 'aprobado' then
    select id into v_insumo_id
    from public.maestro_insumos
    where codigo = new.codigo_maestro_asignado;

    if v_insumo_id is null then
      return new; -- no debería pasar, pero por seguridad no truena el trigger
    end if;

    for v_r in
      select r.id, r.apu_id, r.cantidad, r.tipo, r.unidad
      from public.apu_import_revision r
      where r.solicitud_id = new.id and r.item_apu_id is null
      order by r.apu_id, r.id
    loop
      insert into public.item_apu (apu_id, insumo_id, cantidad, tipo, rendimiento, unidad)
      values (v_r.apu_id, v_insumo_id, v_r.cantidad, v_r.tipo, 1, v_r.unidad)
      returning id into v_item_apu_id;

      update public.apu_import_revision
      set estado = 'resuelto',
          insumo_id_asignado = v_insumo_id,
          item_apu_id = v_item_apu_id
      where id = v_r.id;
    end loop;

    for v_apu_id in
      select distinct r.apu_id
      from public.apu_import_revision r
      where r.solicitud_id = new.id and r.insumo_id_asignado = v_insumo_id
    loop
      perform public.recalcular_valor_apu(v_apu_id);
    end loop;

  elsif new.estado = 'rechazado' then
    update public.apu_import_revision
    set estado = 'rechazado'
    where solicitud_id = new.id;
  end if;

  return new;
end;
$function$;
