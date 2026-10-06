-- Unidades de los insumos en el APU (2026-10-05).
--
-- Problema: el maestro tiene "CEMENTO X 50 KG" con u_m UND y el precio del
-- bulto ($29.576). Si el APU dice "cemento 8,5 kg" y se enlaza a ese insumo,
-- la línea costaba 8,5 bultos (50 veces más). Lo mismo con rollos de tela,
-- tubos de 6 m, cable por 100 m...
--
-- 1. Presentación del insumo: u_m sigue siendo la unidad en que se compra y
--    en la que está el precio (bulto, rollo, tubo); unidad_uso + contenido
--    dicen cuánto trae (1 bulto = 50 KG). La define quien aprueba insumos.
-- 2. Cada línea de APU guarda su unidad y factor_unidad: el precio del
--    insumo se divide por ese factor (50 si la línea está en kg y el precio
--    es del bulto de 50 kg; 1 si está en la misma unidad del precio).
--    precio_unitario_congelado ya se guarda dividido, en la unidad de la
--    línea; el factor se usa cuando no hay precio congelado y, después, para
--    pasar las requisiciones a unidades de compra.
-- 3. presupuesto_items.lineas_apu_oficial: cuántas líneas tenía el APU del
--    ítem en la hoja APU del Excel, para avisar si el APU guardado tiene más
--    o menos.
--
-- Se puede correr dos veces.

alter table public.maestro_insumos
  add column if not exists unidad_uso text,
  add column if not exists contenido numeric(14,4);

alter table public.maestro_insumos drop constraint if exists maestro_insumos_presentacion_check;
alter table public.maestro_insumos add constraint maestro_insumos_presentacion_check
  check ((unidad_uso is null) = (contenido is null) and (contenido is null or contenido > 0));

alter table public.item_apu
  add column if not exists unidad text,
  add column if not exists factor_unidad numeric(14,4) not null default 1;

alter table public.item_apu drop constraint if exists item_apu_factor_unidad_check;
alter table public.item_apu add constraint item_apu_factor_unidad_check check (factor_unidad > 0);

alter table public.presupuesto_items
  add column if not exists lineas_apu_oficial integer;

-- Mismo cálculo de antes; solo cambia el precio de insumo sin congelar, que
-- ahora se divide por el factor de la línea.
create or replace function public.recalcular_valor_apus(p_apu_ids uuid[])
returns table(apu_id uuid, valor numeric)
language sql
set search_path to 'public'
as $function$
  with apus as (
    select distinct unnest(p_apu_ids) as id
  ),
  totales as (
    select a.id as apu_id,
      coalesce(sum(moc.valor_unitario), 0)
      + coalesce(sum(ia.cantidad * ia.rendimiento
                     * coalesce(ia.precio_unitario_congelado, mi.vr_unitario / ia.factor_unidad))
                   filter (where mi.id is not null), 0)
      + coalesce(sum(ia.cantidad * ia.rendimiento * ec.valor_unitario), 0)
      + coalesce(sum(tp.valor_unitario), 0)
      + coalesce(sum(ia.porcentaje_mano_obra / 100.0) * coalesce(sum(moc.valor_unitario), 0), 0)
        as total
    from apus a
    left join public.item_apu ia on ia.apu_id = a.id
    left join public.mano_obra_categorias moc on moc.id = ia.mano_obra_categoria_id
    left join public.maestro_insumos mi on mi.id = ia.insumo_id
    left join public.equipo_categorias ec on ec.id = ia.equipo_categoria_id
    left join public.transporte_precios tp on tp.id = ia.transporte_precio_id
    group by a.id
  ),
  actualizados as (
    update public.presupuesto_items pi
    set valor_unitario = t.total,
        valor_total = case when pi.cantidad is not null then t.total * pi.cantidad else null end
    from totales t
    where pi.apu_id = t.apu_id
    returning pi.id
  )
  select t.apu_id, t.total from totales t
$function$;

-- Al aprobar una solicitud de insumo que vino de un import, la línea nueva
-- guarda la unidad del Excel. El factor lo corrige la app justo después
-- (aprobarSolicitudInsumo) si el insumo quedó con presentación.
create or replace function public.sincronizar_apu_import_revision()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_insumo_id uuid;
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

    -- una fila de item_apu por cada línea de revisión pendiente de esta
    -- solicitud (normalmente es una sola, pero no se asume)
    for v_apu_id in
      select distinct r.apu_id
      from public.apu_import_revision r
      where r.solicitud_id = new.id and r.item_apu_id is null
    loop
      insert into public.item_apu (apu_id, insumo_id, cantidad, tipo, rendimiento, unidad)
      select r.apu_id, v_insumo_id, r.cantidad, r.tipo, 1, r.unidad
      from public.apu_import_revision r
      where r.solicitud_id = new.id and r.apu_id = v_apu_id and r.item_apu_id is null;

      perform public.recalcular_valor_apu(v_apu_id);
    end loop;

    update public.apu_import_revision r
    set estado = 'resuelto',
        insumo_id_asignado = v_insumo_id,
        item_apu_id = ia.id
    from public.item_apu ia
    where r.solicitud_id = new.id
      and r.item_apu_id is null
      and ia.apu_id = r.apu_id
      and ia.insumo_id = v_insumo_id;

  elsif new.estado = 'rechazado' then
    update public.apu_import_revision
    set estado = 'rechazado'
    where solicitud_id = new.id;
  end if;

  return new;
end;
$function$;
