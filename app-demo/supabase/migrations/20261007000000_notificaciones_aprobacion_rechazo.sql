-- Notificaciones (campanita) cuando se aprueba o rechaza una requisición o una
-- orden de compra. Se generan con triggers en la base, así cubren cualquier
-- camino (pantalla, función, edición directa) y no dependen de que cada
-- acción del servidor se acuerde de crearlas.
--
--   requisición aprobada / rechazada (subgerencia técnica) -> a quien la hizo
--   requisición rechazada por Compras                       -> a quien la hizo
--   orden de compra aprobada / rechazada                    -> a quien la creó
--
-- Si ya existía algún trigger propio que hiciera lo mismo, no se duplica la
-- notificación: se omite si ya hay una igual (mismo usuario, tipo, entidad y
-- mensaje) del último minuto.

-- Tipos nuevos. La restricción anterior (si existía) no conocía los de
-- aprobación; se reemplaza por una que incluye todos. NOT VALID: no revisa las
-- filas viejas, solo las nuevas.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.notificaciones'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%tipo%'
  loop
    execute format('alter table public.notificaciones drop constraint %I', c.conname);
  end loop;

  alter table public.notificaciones
    add constraint notificaciones_tipo_check check (tipo in (
      'pedido_rechazado', 'pedido_aprobado',
      'orden_compra_rechazada', 'orden_compra_aprobada',
      'insumo_sobre_presupuesto', 'orden_compra_precio_sobre_efectivo'
    )) not valid;
end $$;

create or replace function public.notificar_una(
  p_usuario uuid, p_tipo text, p_entidad_tipo text, p_entidad_id uuid,
  p_titulo text, p_mensaje text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_usuario is null then return; end if;
  if exists (
    select 1 from notificaciones
    where usuario_id = p_usuario and tipo = p_tipo and entidad_id = p_entidad_id
      and mensaje = p_mensaje and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;
  insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  values (p_usuario, p_tipo, p_entidad_tipo, p_entidad_id, p_titulo, p_mensaje);
end;
$$;

-- ------------------------------------------------------------ requisiciones
create or replace function public.notificar_resolucion_pedido()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_insumo text;
  v_detalle text;
begin
  select descripcion into v_insumo from maestro_insumos where id = new.insumo_id;
  v_detalle := coalesce(v_insumo, 'Insumo') || ' (' || new.cantidad::text || ')';

  -- Aprobada / rechazada por subgerencia técnica.
  if new.estado is distinct from old.estado and new.estado in ('aprobado', 'rechazado') then
    perform public.notificar_una(
      new.solicitado_por,
      case new.estado when 'aprobado' then 'pedido_aprobado' else 'pedido_rechazado' end,
      'pedido_insumo', new.id,
      case new.estado when 'aprobado' then 'Requisición aprobada' else 'Requisición rechazada' end,
      'Tu requisición de ' || v_detalle || ' fue ' ||
        case new.estado when 'aprobado' then 'aprobada' else 'rechazada' end || '.' ||
        case when new.estado = 'rechazado' and nullif(trim(new.comentario_resolucion), '') is not null
             then ' Motivo: ' || trim(new.comentario_resolucion) else '' end
    );
  end if;

  -- Rechazada por Compras.
  if new.rechazado_compras_at is not null and old.rechazado_compras_at is null then
    perform public.notificar_una(
      new.solicitado_por, 'pedido_rechazado', 'pedido_insumo', new.id,
      'Requisición rechazada por Compras',
      'Compras rechazó tu requisición de ' || v_detalle || '.' ||
        case when nullif(trim(new.observaciones_compras), '') is not null
             then ' Motivo: ' || trim(new.observaciones_compras) else '' end
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notificar_resolucion_pedido on public.pedidos_insumos;
create trigger trg_notificar_resolucion_pedido
  after update on public.pedidos_insumos
  for each row execute function public.notificar_resolucion_pedido();

-- ------------------------------------------------------ órdenes de compra
create or replace function public.notificar_resolucion_oc()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.estado is distinct from old.estado and new.estado in ('aprobada', 'rechazada') then
    perform public.notificar_una(
      new.created_by,
      case new.estado when 'aprobada' then 'orden_compra_aprobada' else 'orden_compra_rechazada' end,
      'orden_compra', new.id,
      case new.estado when 'aprobada' then 'Orden de compra aprobada' else 'Orden de compra rechazada' end,
      'La orden de compra #' || new.numero || ' fue ' ||
        case new.estado when 'aprobada' then 'aprobada' else 'rechazada' end || '.' ||
        case when new.estado = 'rechazada' and nullif(trim(new.motivo_rechazo), '') is not null
             then ' Motivo: ' || trim(new.motivo_rechazo) else '' end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notificar_resolucion_oc on public.ordenes_compra;
create trigger trg_notificar_resolucion_oc
  after update on public.ordenes_compra
  for each row execute function public.notificar_resolucion_oc();

revoke all on function public.notificar_una(uuid, text, text, uuid, text, text) from public, anon, authenticated;
