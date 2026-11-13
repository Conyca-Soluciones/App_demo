-- Borrar una categoría de mano de obra o de equipo devuelve sus líneas a
-- "Revisar pendientes" (2026-11-13).
--
-- item_apu tiene "on delete cascade" hacia mano_obra_categorias y
-- equipo_categorias: al borrar una categoría se borraban sus líneas del APU,
-- pero la revisión del import (apu_import_revision) seguía "resuelto" o
-- "auto_match" sin línea (item_apu_id pasa a null) y el ítem no la mostraba en
-- Revisar pendientes. Pasó con el ítem 1,7 de CAPACITACION al borrar una
-- categoría de prueba. No hay pantalla para borrar categorías: se borran a
-- mano en la base.
--
-- Disparador BEFORE DELETE en las dos tablas: devuelve a 'pendiente' las
-- revisiones de esas líneas (sin categoría asignada), borra las líneas y
-- recalcula esos APU. Arregla también el caso que ya existía.
--
-- Todo en una transacción. Se puede correr más de una vez.

begin;

create or replace function public._categoria_borrada_devuelve_pendientes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mo uuid := case when tg_table_name = 'mano_obra_categorias' then old.id end;
  v_eq uuid := case when tg_table_name = 'equipo_categorias' then old.id end;
  v_lineas uuid[];
  v_apus uuid[];
begin
  select array_agg(ia.id), array_agg(distinct ia.apu_id) into v_lineas, v_apus
    from public.item_apu ia
   where ia.mano_obra_categoria_id = v_mo or ia.equipo_categoria_id = v_eq;

  update public.apu_import_revision r
     set estado = 'pendiente',
         item_apu_id = null,
         mano_obra_categoria_id_asignado = null,
         equipo_categoria_id_asignado = null
   where r.item_apu_id = any(coalesce(v_lineas, '{}'))
      or r.mano_obra_categoria_id_asignado = v_mo
      or r.equipo_categoria_id_asignado = v_eq;

  if v_lineas is not null then
    delete from public.item_apu where id = any(v_lineas);
    perform public.recalcular_valor_apus(v_apus);
  end if;
  return old;
end;
$$;
revoke all on function public._categoria_borrada_devuelve_pendientes() from public, anon, authenticated;

drop trigger if exists trg_mo_categoria_borrada on public.mano_obra_categorias;
create trigger trg_mo_categoria_borrada
  before delete on public.mano_obra_categorias
  for each row execute function public._categoria_borrada_devuelve_pendientes();

drop trigger if exists trg_equipo_categoria_borrada on public.equipo_categorias;
create trigger trg_equipo_categoria_borrada
  before delete on public.equipo_categorias
  for each row execute function public._categoria_borrada_devuelve_pendientes();

-- Lo que ya quedó así: mano de obra o equipo "resuelto" / "auto_match" sin
-- línea ni categoría.
update public.apu_import_revision r
   set estado = 'pendiente'
 where r.tipo in ('MO', 'EQUIPO')
   and r.estado in ('resuelto', 'auto_match')
   and r.item_apu_id is null
   and r.mano_obra_categoria_id_asignado is null
   and r.equipo_categoria_id_asignado is null;

commit;
