-- Se quita "enviada" de las órdenes de compra.
--
--  * Ya no hay "Marcar como enviada": se elimina la función marcar_orden_enviada.
--  * Desaprobar una orden ya no depende de si fue enviada: ahora NO se puede si
--    la orden tiene entradas de almacén vigentes (material recibido). Cancelar
--    ya tenía esa misma regla (cancelar_orden_compra, 20261006400000).
--  * Se borra del historial todo lo que dice "enviada" y el disparador deja de
--    registrarlo.
--
-- La columna ordenes_compra.enviada se deja en la tabla, sin usar: así no se
-- pierde ningún dato. Cuando se quiera, se elimina con
--   alter table public.ordenes_compra drop column enviada;
-- (antes hay que quitar el check ordenes_compra_enviada_requiere_aprobada).

-- --------------------------------------------------------- función "enviada"
drop function if exists public.marcar_orden_enviada(uuid);

-- ------------------------------------------------------- desaprobar una orden
create or replace function public.desaprobar_orden_compra(p_orden_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o record;
begin
  if not public.tiene_accion(auth.uid(), 'desaprobar_oc') then
    raise exception 'No autorizado -- no tienes permiso para desaprobar órdenes de compra.';
  end if;
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo es obligatorio.';
  end if;

  select estado, estado_entrega into v_o
    from ordenes_compra where id = p_orden_id for update;

  if not found then
    raise exception 'La orden no existe.';
  end if;
  if v_o.estado <> 'aprobada' then
    raise exception 'Solo se puede desaprobar una orden aprobada.';
  end if;
  if v_o.estado_entrega <> 'sin_entregar' then
    raise exception 'La orden ya tiene material recibido: no se puede desaprobar.';
  end if;
  -- Refuerzo: aunque estado_entrega diga sin_entregar, ninguna entrada vigente.
  if exists (
    select 1
    from entradas_almacen e
    where e.orden_compra_id = p_orden_id and e.anulada_at is null
  ) then
    raise exception 'La orden tiene entradas de almacén registradas: no se puede desaprobar. Anúlalas primero.';
  end if;

  update ordenes_compra
     set estado = 'pendiente_aprobacion',
         aprobada_por = null,
         aprobada_at = null,
         desaprobada_por = auth.uid(),
         desaprobada_at = now(),
         motivo_desaprobacion = trim(p_motivo)
   where id = p_orden_id;
end;
$$;

revoke all on function public.desaprobar_orden_compra(uuid, text) from public, anon;
grant execute on function public.desaprobar_orden_compra(uuid, text) to authenticated;

-- ------------------------------------------------------------- historial
-- El disparador ya no registra "marcada_enviada".
create or replace function public.trg_historial_orden_compra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evento text;
  v_usuario uuid;
  v_motivo text;
begin
  if tg_op = 'INSERT' then
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('orden_compra', new.id, 'creada', coalesce(new.created_by, auth.uid()),
            jsonb_build_object('numero', new.numero));
    return new;
  end if;

  if new.estado is distinct from old.estado then
    if old.estado = 'pendiente_aprobacion' and new.estado = 'aprobada' then
      v_evento := 'aprobada';  v_usuario := coalesce(new.aprobada_por, auth.uid());
    elsif old.estado = 'pendiente_aprobacion' and new.estado = 'rechazada' then
      v_evento := 'rechazada'; v_usuario := coalesce(new.aprobada_por, auth.uid()); v_motivo := new.motivo_rechazo;
    elsif old.estado = 'aprobada' and new.estado = 'pendiente_aprobacion' then
      v_evento := 'desaprobada'; v_usuario := coalesce(new.desaprobada_por, auth.uid()); v_motivo := new.motivo_desaprobacion;
    elsif new.estado = 'cancelada' then
      v_evento := 'cancelada'; v_usuario := coalesce(new.cancelada_por, auth.uid()); v_motivo := new.motivo_cancelacion;
    else
      v_evento := 'estado_cambiado'; v_usuario := auth.uid();
    end if;

    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
    values ('orden_compra', new.id, v_evento, v_usuario, v_motivo,
            jsonb_build_object('estado_anterior', old.estado, 'estado_nuevo', new.estado));
  end if;

  if new.estado_entrega is distinct from old.estado_entrega then
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('orden_compra', new.id, 'entrega_actualizada', auth.uid(),
            jsonb_build_object('de', old.estado_entrega, 'a', new.estado_entrega));
  end if;

  return new;
end;
$$;

-- Se borra del historial todo lo que ya existía sobre "enviada".
delete from public.historial_eventos where evento = 'marcada_enviada';
