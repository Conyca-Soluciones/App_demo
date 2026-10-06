-- Total del ítem = valor unitario redondeado × cantidad.
--
-- presupuesto_items.valor_unitario es numeric(14,2): la base lo redondea a 2
-- decimales al guardarlo, pero recalcular_valor_apus calculaba valor_total con
-- el valor SIN redondear. En pantalla, en el Excel y en los contratos "unitario
-- × cantidad" no daba el total (31 ítems; ej. 7.357,83 × 47.647,79 =
-- 350.584.338,70 pero se guardaba 350.584.497,52).
--
-- Mismo cálculo que 20261025000000_unidades_presentacion.sql; solo cambia el
-- redondeo del unitario antes de multiplicar. Se puede correr más de una vez.

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
      round(
        coalesce(sum(moc.valor_unitario), 0)
        + coalesce(sum(ia.cantidad * ia.rendimiento
                       * coalesce(ia.precio_unitario_congelado, mi.vr_unitario / ia.factor_unidad))
                     filter (where mi.id is not null), 0)
        + coalesce(sum(ia.cantidad * ia.rendimiento * ec.valor_unitario), 0)
        + coalesce(sum(tp.valor_unitario), 0)
        + coalesce(sum(ia.porcentaje_mano_obra / 100.0) * coalesce(sum(moc.valor_unitario), 0), 0),
        2) as total
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
        valor_total = case when pi.cantidad is not null then round(t.total * pi.cantidad, 2) else null end
    from totales t
    where pi.apu_id = t.apu_id
    returning pi.id
  )
  select t.apu_id, t.total from totales t
$function$;

-- Los totales ya guardados con la diferencia.
update public.presupuesto_items
set valor_total = round(valor_unitario * cantidad, 2)
where cantidad is not null
  and valor_unitario is not null
  and valor_total is distinct from round(valor_unitario * cantidad, 2);
