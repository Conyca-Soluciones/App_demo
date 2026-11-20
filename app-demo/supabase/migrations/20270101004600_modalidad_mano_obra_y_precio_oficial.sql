-- Excel de modalidades del Malecón (decisiones del usuario, 2026-11-20).
--
-- 1. Subcontrato de mano de obra para ítems SIN mano de obra en su APU pero con
--    insumos (los de "suministro e instalación": juegos, puertas, ventanas...).
--    Antes daba error. Ahora la modalidad agrega al APU una línea de mano de
--    obra PENDIENTE (apu_import_revision.agregada_por_modalidad) que se resuelve
--    en Revisar pendientes con el catálogo, como cualquier otra (la app le pone
--    candidatos). Si el ítem cambia de modalidad, se guarda aparte como las
--    demás y vuelve si regresa. Esa mano de obra "agregada" no cuenta como
--    mano de obra del Excel: en administración no pide mano de obra oficial.
--    Dividirla en trabajos sí se puede (los trabajos heredan la marca).
-- 2. El Excel de modalidades también trae el PRECIO OFICIAL (ajustado a la
--    propuesta): fijar_modalidades_presupuesto acepta precio_oficial por fila;
--    si cambia, actualiza presupuesto_items.precio_original antes de aplicar la
--    modalidad (a todo costo el valor sale de él) y lo deja en el historial
--    (codigo, antes, después). La vista previa dice cuántos cambian.
-- 3. Dato: en el Malecón el capítulo "ESTRUCTURA MODULAR METALICA" quedó con
--    código "15.1" (repetido con ACCESO) por el import; es "15.10".
--
-- Va ANTES del código. Reversa en supabase/reversa/.

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
  if position(p_b in d) > 0 then
    return;
  end if;
  if position(p_a in d) = 0 then
    raise exception '% no tiene el texto esperado: %', p_fn, left(p_a, 120);
  end if;
  execute replace(d, p_a, p_b);
end;
$f$;

alter table public.apu_import_revision add column if not exists agregada_por_modalidad boolean not null default false;

-- 1. Mano de obra agregada por la modalidad ------------------------------------------

-- No cuenta como mano de obra del ítem (ni su línea del APU ya resuelta).
select pg_temp._parche('public._info_modalidad_item(uuid)'::regprocedure,
  '    exists (select 1 from apu_import_revision r where r.presupuesto_item_id = pi.id and r.tipo = ''MO'')
      or exists (select 1 from item_apu ia
                  where ia.apu_id in (pi.apu_id, pi.apu_guardado_id)
                    and (ia.mano_obra_categoria_id is not null
                         or ia.concepto_fijo in (''mano_obra_subcontrato'', ''mano_obra_administracion''))),',
  '    exists (select 1 from apu_import_revision r where r.presupuesto_item_id = pi.id and r.tipo = ''MO''
                and not r.agregada_por_modalidad)
      or exists (select 1 from item_apu ia
                  where ia.apu_id in (pi.apu_id, pi.apu_guardado_id)
                    and (ia.mano_obra_categoria_id is not null
                         or ia.concepto_fijo in (''mano_obra_subcontrato'', ''mano_obra_administracion''))
                    and not exists (select 1 from apu_import_revision r2
                                     where r2.item_apu_id = ia.id and r2.agregada_por_modalidad)),');

select pg_temp._parche('public._aplicar_modalidad_item(uuid,text)'::regprocedure,
  '  elsif p_modalidad = ''mano_obra'' then
    if not v_tiene_mo then
      raise exception ''El ítem % no tiene mano de obra: no puede ser subcontrato de mano de obra.'', v.codigo;
    end if;',
  '  elsif p_modalidad = ''mano_obra'' then
    if not v_tiene_mo and not v_con_insumos then
      raise exception ''El ítem % no tiene mano de obra ni insumos: no puede ser subcontrato de mano de obra.'', v.codigo;
    end if;
    -- Sin mano de obra en el APU (suministro e instalación): se agrega una
    -- línea pendiente para elegirla del catálogo (20270101004600).
    if not v_tiene_mo and v_apu is not null
       and not exists (select 1 from apu_import_revision r where r.presupuesto_item_id = p_item and r.agregada_por_modalidad) then
      insert into apu_import_revision (lote_import_id, presupuesto_item_id, apu_id, descripcion_original, tipo, unidad,
                                       cantidad, candidatos, estado, agregada_por_modalidad)
      values (coalesce((select r.lote_import_id from apu_import_revision r where r.presupuesto_item_id = p_item limit 1),
                       gen_random_uuid()),
              p_item, v_apu, ''Mano de obra (la pide la modalidad)'', ''MO'', v.unidad, 1, ''[]''::jsonb, ''pendiente'', true);
    end if;');

-- La mano de obra agregada solo sirve en subcontrato de mano de obra: con otra
-- modalidad (administración) se guarda aparte, como las demás líneas que la
-- modalidad no usa (a todo costo ya se guardaba con todo).
select pg_temp._parche('public._aplicar_modalidad_item(uuid,text)'::regprocedure,
  '  if v_concepto is not null then
    insert into item_apu (apu_id, concepto_fijo, valor_fijo, cantidad, rendimiento, factor_unidad, tipo)',
  '  if p_modalidad is distinct from ''mano_obra'' and not v_todo and v_apu is not null
     and exists (select 1 from apu_import_revision r
                  where r.presupuesto_item_id = p_item and r.agregada_por_modalidad and r.estado <> ''no_requerido'') then
    if v_guardado is null then
      insert into apu (codigo, descripcion, presupuesto_id)
      values (v.codigo, ''Guardado por modalidad: '' || coalesce(v.descripcion, ''''), v.presupuesto_id)
      returning id into v_guardado;
      update presupuesto_items set apu_guardado_id = v_guardado where id = p_item;
    end if;
    update item_apu ia set apu_id = v_guardado
     where ia.apu_id = v_apu
       and ia.id in (select r.item_apu_id from apu_import_revision r
                      where r.presupuesto_item_id = p_item and r.agregada_por_modalidad and r.item_apu_id is not null);
    update apu_import_revision r
       set apu_id = v_guardado,
           estado = case when r.estado in (''pendiente'', ''solicitud_pendiente'', ''rechazado'') then ''no_requerido'' else r.estado end
     where r.presupuesto_item_id = p_item and r.agregada_por_modalidad;
    with s as (
      select distinct r.solicitud_mano_obra_id as id from apu_import_revision r
       where r.presupuesto_item_id = p_item and r.agregada_por_modalidad and r.estado = ''no_requerido''
         and r.solicitud_mano_obra_id is not null
    )
    delete from solicitudes_mano_obra x using s
     where x.id = s.id and x.estado = ''pendiente''
       and not exists (select 1 from apu_import_revision r2 where r2.solicitud_mano_obra_id = x.id and r2.estado <> ''no_requerido'');
  end if;

  if v_concepto is not null then
    insert into item_apu (apu_id, concepto_fijo, valor_fijo, cantidad, rendimiento, factor_unidad, tipo)');

-- Dividir: también la mano de obra agregada; los trabajos heredan la marca.
select pg_temp._parche('public.info_division_mano_obra(uuid)'::regprocedure,
  '    when not coalesce(v_info.tiene_mano_obra, false) then ''El ítem no tiene mano de obra.''',
  '    when not coalesce(v_info.tiene_mano_obra, false)
         and not exists (select 1 from apu_import_revision r where r.presupuesto_item_id = p_item and r.tipo = ''MO'')
      then ''El ítem no tiene mano de obra.''');

select pg_temp._parche('public.dividir_mano_obra_item(uuid,jsonb)'::regprocedure,
  '  v_por_aprobar integer := 0;
begin',
  '  v_por_aprobar integer := 0;
  v_marcada boolean;
begin');
select pg_temp._parche('public.dividir_mano_obra_item(uuid,jsonb)'::regprocedure,
  '  v_excel := coalesce(v_excel, ''Mano de obra del APU'');',
  '  v_excel := coalesce(v_excel, ''Mano de obra del APU'');
  v_marcada := exists (select 1 from apu_import_revision r
                        where r.presupuesto_item_id = p_item and r.tipo = ''MO'' and r.estado <> ''dividido''
                          and r.agregada_por_modalidad);');
select pg_temp._parche('public.dividir_mano_obra_item(uuid,jsonb)'::regprocedure,
  '                                     cantidad, candidatos, estado, dividida_de)
    values (v_lote, p_item, v.apu_id, v_nombre, ''MO'', v.unidad, 1, ''[]''::jsonb, ''pendiente'', v_excel)',
  '                                     cantidad, candidatos, estado, dividida_de, agregada_por_modalidad)
    values (v_lote, p_item, v.apu_id, v_nombre, ''MO'', v.unidad, 1, ''[]''::jsonb, ''pendiente'', v_excel, v_marcada)');

-- 2. Precio oficial en el Excel de modalidades ---------------------------------------

select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '  v_n integer := 0;
begin',
  '  v_n integer := 0;
  v_precios jsonb := ''[]''::jsonb;
begin');

select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '             e.val ? ''herramienta_menor_pct'' as trae_hm,
             (e.val->>''herramienta_menor_pct'') as hm_txt',
  '             e.val ? ''herramienta_menor_pct'' as trae_hm,
             (e.val->>''herramienta_menor_pct'') as hm_txt,
             e.val ? ''precio_oficial'' as trae_precio,
             (e.val->>''precio_oficial'') as precio_txt');

select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '      v_mo numeric;
      v_hm numeric;
    begin',
  '      v_mo numeric;
      v_hm numeric;
      v_precio numeric;
    begin');

select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '      if v_error is null then
        if not v_f.trae_mo then v_mo := v_f.mano_obra_oficial; end if;',
  '      if v_error is null and v_f.trae_precio and nullif(trim(v_f.precio_txt), '''') is not null then
        begin
          v_precio := round(v_f.precio_txt::numeric, 2);
          if v_precio <= 0 then v_error := ''el precio oficial debe ser mayor que cero''; end if;
        exception when others then
          v_error := ''el precio oficial no es un número'';
        end;
      end if;
      if v_error is null then
        if v_precio is null then v_precio := v_f.precio_original; end if;
        if not v_f.trae_mo then v_mo := v_f.mano_obra_oficial; end if;');

select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '           and v_hm is not distinct from v_f.herramienta_menor_pct then
          continue;
        end if;',
  '           and v_hm is not distinct from v_f.herramienta_menor_pct
           and v_precio is not distinct from v_f.precio_original then
          continue;
        end if;');

select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '        elsif v_f.modalidad = ''todo_costo'' and coalesce(v_f.precio_original, 0) <= 0 then
          v_error := ''no tiene precio oficial'';
        elsif v_f.modalidad = ''mano_obra'' and not v_info.tiene_mano_obra then
          v_error := ''no tiene mano de obra: no puede ser subcontrato de mano de obra'';',
  '        elsif v_f.modalidad = ''todo_costo'' and coalesce(v_precio, 0) <= 0 then
          v_error := ''no tiene precio oficial'';
        elsif v_f.modalidad = ''mano_obra'' and not v_info.tiene_mano_obra and not v_info.con_insumos then
          v_error := ''no tiene mano de obra ni insumos: no puede ser subcontrato de mano de obra'';');

select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '        v_cambios := v_cambios || jsonb_build_object(''item_id'', v_f.item_id, ''modalidad'', v_f.modalidad,
                                                     ''mano_obra_oficial'', v_mo, ''herramienta_menor_pct'', v_hm);',
  '        v_cambios := v_cambios || jsonb_build_object(''item_id'', v_f.item_id, ''modalidad'', v_f.modalidad,
                                                     ''mano_obra_oficial'', v_mo, ''herramienta_menor_pct'', v_hm,
                                                     ''precio_original'', v_precio);
        if v_precio is distinct from v_f.precio_original then
          v_precios := v_precios || jsonb_build_object(''codigo'', v_f.codigo, ''antes'', v_f.precio_original, ''despues'', v_precio);
        end if;');

select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '    return jsonb_build_object(''aplicado'', false, ''errores'', v_errores, ''cambian'', jsonb_array_length(v_cambios),
                              ''valor_antes'', v_antes);',
  '    return jsonb_build_object(''aplicado'', false, ''errores'', v_errores, ''cambian'', jsonb_array_length(v_cambios),
                              ''valor_antes'', v_antes, ''precios_cambian'', jsonb_array_length(v_precios));');

select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '             (c->>''mano_obra_oficial'')::numeric as mo, (c->>''herramienta_menor_pct'')::numeric as hm
        from jsonb_array_elements(v_cambios) c
    loop
      update presupuesto_items
         set mano_obra_oficial = v_f.mo, herramienta_menor_pct = v_f.hm
       where id = v_f.item_id;',
  '             (c->>''mano_obra_oficial'')::numeric as mo, (c->>''herramienta_menor_pct'')::numeric as hm,
             (c->>''precio_original'')::numeric as precio
        from jsonb_array_elements(v_cambios) c
    loop
      update presupuesto_items
         set mano_obra_oficial = v_f.mo, herramienta_menor_pct = v_f.hm,
             precio_original = coalesce(v_f.precio, precio_original)
       where id = v_f.item_id;');

select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '                         ''lineas_no_requeridas'', v_revisiones, ''solicitudes_cerradas'', v_solicitudes,
                         ''valor_antes'', v_antes, ''valor_despues'', v_despues));',
  '                         ''lineas_no_requeridas'', v_revisiones, ''solicitudes_cerradas'', v_solicitudes,
                         ''valor_antes'', v_antes, ''valor_despues'', v_despues,
                         ''precios_oficiales'', v_precios));');

select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '                            ''valor_antes'', v_antes, ''valor_despues'', coalesce(v_despues, v_antes));',
  '                            ''valor_antes'', v_antes, ''valor_despues'', coalesce(v_despues, v_antes),
                            ''precios_cambian'', jsonb_array_length(v_precios));');

-- 3. Código del capítulo 15.10 del Malecón --------------------------------------------

update public.presupuesto_items pi
   set codigo = '15.10'
 where pi.version_id = '44b264ee-5d4e-4b28-80a7-12f590028527'
   and pi.codigo = '15.1' and pi.descripcion = 'ESTRUCTURA MODULAR METALICA' and pi.nivel = 2;

commit;
