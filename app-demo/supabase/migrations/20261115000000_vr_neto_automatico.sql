-- vr_neto se calcula solo (decisión del usuario, 2026-10-15).
--
-- Desde la corrección del IVA (20261114100000_maestro_iva_doble.sql):
-- vr_unitario = precio SIN IVA y vr_neto = precio CON IVA una vez. Hasta ahora
-- solo la aprobación de insumos lo calculaba bien; un INSERT o UPDATE por la
-- API podía volver a descuadrarlo. Este disparador lo calcula siempre al crear
-- un insumo y cada vez que cambian vr_unitario, iva_porcentaje o excluye_iva:
--   vr_neto = vr_unitario × (1 + iva_porcentaje / 100), redondeado a centavos
--   (= vr_unitario si el insumo excluye IVA o no tiene %).
-- Lo que se mande en vr_neto se ignora.
-- Se puede correr más de una vez.

create or replace function public._calcular_vr_neto_insumo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.vr_unitario is null then
    new.vr_neto := null;
  elsif coalesce(new.excluye_iva, false) or coalesce(new.iva_porcentaje, 0) = 0 then
    new.vr_neto := new.vr_unitario;
  else
    new.vr_neto := round(new.vr_unitario * (1 + new.iva_porcentaje / 100.0), 2);
  end if;
  return new;
end;
$$;

drop trigger if exists maestro_insumos_vr_neto on public.maestro_insumos;
create trigger maestro_insumos_vr_neto
  before insert or update of vr_unitario, iva_porcentaje, excluye_iva, vr_neto on public.maestro_insumos
  for each row execute function public._calcular_vr_neto_insumo();
