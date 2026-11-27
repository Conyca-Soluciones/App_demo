-- Tope de los contratos de mano de obra = el valor aprobado de la mano de
-- obra, SIN la herramienta menor (decisión del usuario, 2026-11-27; cambia
-- 20261124000000 y 20270101004400, que sumaban el % de herramienta menor del
-- APU). Caso: Fabricación de loseta aprobada en $ 18.750 salía con tope
-- $ 20.625 (+10 %).
--
-- Vale para todo contrato de mano de obra: la mano de obra completa de un
-- ítem, cada trabajo de una mano de obra dividida y las actividades nuevas de
-- un otrosí. El valor del ítem en el presupuesto y _valor_mano_obra_item
-- (Control del proyecto) NO cambian: siguen con la herramienta menor.
--
-- Valor aprobado de la mano de obra de un ítem (_tope_mano_obra_item):
-- - categorías del catálogo: su valor (1 por unidad del ítem, como siempre),
--   sin el % de herramienta menor del APU;
-- - subcontrato de mano de obra sin insumos (línea fija de la modalidad): la
--   línea completa, 50 % del precio oficial de mano de obra + herramienta
--   menor, como antes (decisión del usuario: ahí SÍ va la herramienta menor);
-- - administración: su línea fija (no lleva contrato).
-- Sin mano de obra en el APU: el ítem completo, como antes.
--
-- Va después de 20270101007900 (antes 006500). Sin contratos de mano de obra en la base al
-- escribirla (2026-11-27). Reversa en supabase/reversa/.
--
-- Se aplicó en Supabase (2026-11-27) con el número 20270101006600, que en main ya
-- usaba otra migración; se renombró a 20270101008000. Los textos que deja en las
-- funciones siguen diciendo "(20270101006600)": así quedaron en la base y la
-- reversa y verificar_migraciones.sql los buscan tal cual. No cambiarlos.

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

-- 1. Valor aprobado de la mano de obra (sin herramienta menor) -------------------------

create or replace function public._tope_mano_obra_item(p_presupuesto_item_id uuid)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce((
    select round(coalesce(sum(moc.valor_unitario), 0)
             + coalesce(sum(case when ia.concepto_fijo in ('mano_obra_subcontrato', 'mano_obra_administracion')
                              then ia.valor_fijo end), 0), 2)
      from presupuesto_items pi
      join item_apu ia on ia.apu_id = pi.apu_id
      left join mano_obra_categorias moc on moc.id = ia.mano_obra_categoria_id
     where pi.id = p_presupuesto_item_id), 0)
$function$;

revoke execute on function public._tope_mano_obra_item(uuid) from public;

create or replace function public._tope_valor_unitario_item(p_presupuesto_item_id uuid, p_tipo_contrato text)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $function$
  select case when p_tipo_contrato = 'mano_obra' and m.valor > 0 then least(m.valor, pi.valor_unitario)
              else pi.valor_unitario end
    from presupuesto_items pi
    cross join lateral (select public._tope_mano_obra_item(pi.id) as valor) m
   where pi.id = p_presupuesto_item_id
$function$;

-- 2. Trabajos: su valor del catálogo, sin parte de herramienta menor ------------------

create or replace function public._trabajos_item(p_item uuid)
returns table(categoria_id uuid, nombre text, valor numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  with pi as (
    select id, apu_id from presupuesto_items where id = p_item
  ),
  lineas as (
    select moc.id, moc.categoria, sum(moc.valor_unitario) as valor
      from pi
      join item_apu ia on ia.apu_id = pi.apu_id
      join mano_obra_categorias moc on moc.id = ia.mano_obra_categoria_id
     group by moc.id, moc.categoria
  )
  select l.id, l.categoria, round(coalesce(l.valor, 0), 2)
    from lineas l
   -- 2 o más categorías, o la mano de obra dividida (20270101006500).
   where ((select count(*) from lineas) >= 2
          or exists (select 1 from apu_import_revision r
                      where r.presupuesto_item_id = p_item and r.dividida_de is not null))
     and not exists (select 1 from pi join item_apu ia on ia.apu_id = pi.apu_id
                      where ia.concepto_fijo in ('mano_obra_subcontrato', 'mano_obra_administracion'))
   order by l.categoria, l.id
$function$;

-- 3. Formulario de contratos y de otrosí ------------------------------------------------

select pg_temp._parche('public.items_presupuesto_para_contrato(uuid)'::regprocedure,
  'round(coalesce(sum(moc.valor_unitario), 0) * (1 + coalesce(sum(ia.porcentaje_mano_obra / 100.0), 0))
             + coalesce(sum(ia.valor_fijo) filter (where ia.concepto_fijo in (''mano_obra_subcontrato'', ''mano_obra_administracion'')), 0), 2) as valor',
  '-- Tope sin herramienta menor (20270101006600, igual que _tope_mano_obra_item).
           round(coalesce(sum(moc.valor_unitario), 0)
             + coalesce(sum(case when ia.concepto_fijo in (''mano_obra_subcontrato'', ''mano_obra_administracion'')
                              then ia.valor_fijo end), 0), 2) as valor');

select pg_temp._parche('public.actividades_para_otrosi(uuid)'::regprocedure,
  'round(coalesce(sum(moc.valor_unitario), 0) * (1 + coalesce(sum(ia.porcentaje_mano_obra / 100.0), 0)), 2) as valor',
  '-- Tope sin herramienta menor (20270101006600, igual que _tope_mano_obra_item).
             round(coalesce(sum(moc.valor_unitario), 0)
               + coalesce(sum(case when ia.concepto_fijo in (''mano_obra_subcontrato'', ''mano_obra_administracion'')
                                then ia.valor_fijo end), 0), 2) as valor');

select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  'v_tope := case when c.tipo = ''mano_obra'' and v_mo > 0 then least(v_mo, v_pi.valor_unitario) else v_pi.valor_unitario end;',
  'v_tope := public._tope_valor_unitario_item(v_pi.id, c.tipo); -- sin herramienta menor (20270101006600)');

commit;
