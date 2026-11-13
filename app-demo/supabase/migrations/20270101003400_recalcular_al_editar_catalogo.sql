-- Recalcular el presupuesto cuando cambia el valor de una categoría de mano de
-- obra o de equipo (2026-11-13).
--
-- Las líneas de mano de obra y equipo del APU NO congelan el precio: toman el
-- valor_unitario del catálogo cuando se recalcula. Pero editar el catálogo
-- (Aprobación de mano de obra y equipos › catálogo) no recalculaba nada: el
-- valor guardado del ítem quedaba con el precio de antes. En el Malecón, el
-- Compresor 250 Lb pasó de $450.000 a $56.250 por hora y los ítems 3.6, 3.9,
-- 3.10, 3.12 y 3.17 seguían con el valor viejo: $2.683 millones de más.
--
-- - Disparador por sentencia en mano_obra_categorias y equipo_categorias: si
--   cambia valor_unitario, recalcula los APU que usan esas categorías en la
--   VERSIÓN VIGENTE de cada presupuesto (las versiones viejas son una foto y no
--   se tocan).
-- - Al final recalcula una vez todos los APU de las versiones vigentes, para
--   corregir los valores que ya habían quedado viejos.
--
-- Se puede correr más de una vez. Todo en una transacción.

begin;

create or replace function public._recalcular_apus_de_categorias(p_mo uuid[], p_eq uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apus uuid[];
begin
  select array_agg(distinct ia.apu_id) into v_apus
    from public.item_apu ia
    join public.presupuesto_items pi on pi.apu_id = ia.apu_id
    join public.presupuestos p on p.version_actual_id = pi.version_id
   where ia.mano_obra_categoria_id = any(coalesce(p_mo, '{}'))
      or ia.equipo_categoria_id = any(coalesce(p_eq, '{}'))
      -- herramienta menor = % de la mano de obra del mismo APU
      or (ia.porcentaje_mano_obra is not null and exists (
            select 1 from public.item_apu m
             where m.apu_id = ia.apu_id and m.mano_obra_categoria_id = any(coalesce(p_mo, '{}'))));
  if v_apus is not null then
    perform public.recalcular_valor_apus(v_apus);
  end if;
end;
$$;
revoke all on function public._recalcular_apus_de_categorias(uuid[], uuid[]) from public, anon, authenticated;

create or replace function public._catalogo_mo_recalcular()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  select array_agg(n.id) into v_ids
    from nuevos n join viejos o on o.id = n.id
   where n.valor_unitario is distinct from o.valor_unitario;
  if v_ids is not null then
    perform public._recalcular_apus_de_categorias(v_ids, null);
  end if;
  return null;
end;
$$;
revoke all on function public._catalogo_mo_recalcular() from public, anon, authenticated;

create or replace function public._catalogo_equipo_recalcular()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  select array_agg(n.id) into v_ids
    from nuevos n join viejos o on o.id = n.id
   where n.valor_unitario is distinct from o.valor_unitario;
  if v_ids is not null then
    perform public._recalcular_apus_de_categorias(null, v_ids);
  end if;
  return null;
end;
$$;
revoke all on function public._catalogo_equipo_recalcular() from public, anon, authenticated;

drop trigger if exists trg_catalogo_mo_recalcular on public.mano_obra_categorias;
create trigger trg_catalogo_mo_recalcular
  after update on public.mano_obra_categorias
  referencing old table as viejos new table as nuevos
  for each statement execute function public._catalogo_mo_recalcular();

drop trigger if exists trg_catalogo_equipo_recalcular on public.equipo_categorias;
create trigger trg_catalogo_equipo_recalcular
  after update on public.equipo_categorias
  referencing old table as viejos new table as nuevos
  for each statement execute function public._catalogo_equipo_recalcular();

-- Corrige los valores que ya quedaron viejos: todos los APU de las versiones
-- vigentes, una vez.
select public.recalcular_valor_apus(array(
  select distinct pi.apu_id
    from public.presupuesto_items pi
    join public.presupuestos p on p.version_actual_id = pi.version_id
   where pi.apu_id is not null));

commit;
