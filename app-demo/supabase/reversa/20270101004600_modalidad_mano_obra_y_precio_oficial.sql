-- Reversa de 20270101004600_modalidad_mano_obra_y_precio_oficial.sql.
-- Las funciones vuelven a como estaban: subcontrato de mano de obra exige
-- mano de obra del Excel y el Excel de modalidades no cambia el precio
-- oficial. La columna agregada_por_modalidad y las líneas ya agregadas se
-- dejan (son datos); los precios oficiales actualizados no se devuelven (están
-- en el historial 'modalidades' con el valor de antes). El código 15.10 del
-- Malecón se deja corregido.

begin;
set local lock_timeout = '10s';

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $f$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  p_a := replace(p_a, E'\r\n', E'\n');
  p_b := replace(p_b, E'\r\n', E'\n');
  if position(p_a in d) = 0 then
    return;
  end if;
  execute replace(d, p_a, p_b);
end;
$f$;

select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '        elsif v_f.modalidad = ''mano_obra'' and not v_info.tiene_mano_obra and not v_info.con_insumos then
          v_error := ''no tiene mano de obra ni insumos: no puede ser subcontrato de mano de obra'';',
  '        elsif v_f.modalidad = ''mano_obra'' and not v_info.tiene_mano_obra then
          v_error := ''no tiene mano de obra: no puede ser subcontrato de mano de obra'';');
select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '             precio_original = coalesce(v_f.precio, precio_original)
       where id = v_f.item_id;', '       where id = v_f.item_id;');
select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '         set mano_obra_oficial = v_f.mo, herramienta_menor_pct = v_f.hm,
', '         set mano_obra_oficial = v_f.mo, herramienta_menor_pct = v_f.hm
');

select pg_temp._parche('public._aplicar_modalidad_item(uuid,text)'::regprocedure,
  '    if not v_tiene_mo and not v_con_insumos then
      raise exception ''El ítem % no tiene mano de obra ni insumos: no puede ser subcontrato de mano de obra.'', v.codigo;
    end if;',
  '    if not v_tiene_mo then
      raise exception ''El ítem % no tiene mano de obra: no puede ser subcontrato de mano de obra.'', v.codigo;
    end if;');

select pg_temp._parche('public._info_modalidad_item(uuid)'::regprocedure,
  '    exists (select 1 from apu_import_revision r where r.presupuesto_item_id = pi.id and r.tipo = ''MO''
                and not r.agregada_por_modalidad)',
  '    exists (select 1 from apu_import_revision r where r.presupuesto_item_id = pi.id and r.tipo = ''MO'')');

commit;
