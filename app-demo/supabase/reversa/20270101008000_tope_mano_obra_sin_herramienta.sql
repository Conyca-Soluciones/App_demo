-- Reversa de 20270101008000_tope_mano_obra_sin_herramienta.sql (aplicada como 20270101006600): el tope de los
-- contratos de mano de obra vuelve a sumar la herramienta menor del APU.
-- _trabajos_item queda como en 20270101006500 (con la mano de obra dividida
-- aunque falte aprobar un trabajo); si también se revierte 007900, correr
-- después su reversa.

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

select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  'v_tope := public._tope_valor_unitario_item(v_pi.id, c.tipo); -- sin herramienta menor (20270101006600)',
  'v_tope := case when c.tipo = ''mano_obra'' and v_mo > 0 then least(v_mo, v_pi.valor_unitario) else v_pi.valor_unitario end;');

select pg_temp._parche('public.actividades_para_otrosi(uuid)'::regprocedure,
  '-- Tope sin herramienta menor (20270101006600, igual que _tope_mano_obra_item).
             round(coalesce(sum(moc.valor_unitario), 0)
               + coalesce(sum(case when ia.concepto_fijo in (''mano_obra_subcontrato'', ''mano_obra_administracion'')
                                then ia.valor_fijo end), 0), 2) as valor',
  'round(coalesce(sum(moc.valor_unitario), 0) * (1 + coalesce(sum(ia.porcentaje_mano_obra / 100.0), 0)), 2) as valor');

select pg_temp._parche('public.items_presupuesto_para_contrato(uuid)'::regprocedure,
  '-- Tope sin herramienta menor (20270101006600, igual que _tope_mano_obra_item).
           round(coalesce(sum(moc.valor_unitario), 0)
             + coalesce(sum(case when ia.concepto_fijo in (''mano_obra_subcontrato'', ''mano_obra_administracion'')
                              then ia.valor_fijo end), 0), 2) as valor',
  'round(coalesce(sum(moc.valor_unitario), 0) * (1 + coalesce(sum(ia.porcentaje_mano_obra / 100.0), 0))
             + coalesce(sum(ia.valor_fijo) filter (where ia.concepto_fijo in (''mano_obra_subcontrato'', ''mano_obra_administracion'')), 0), 2) as valor');

create or replace function public._trabajos_item(p_item uuid)
returns table(categoria_id uuid, nombre text, valor numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  with pi as (
    select id, apu_id from presupuesto_items where id = p_item
  ),
  hm as (
    select coalesce(sum(ia.porcentaje_mano_obra), 0) as pct
      from pi join item_apu ia on ia.apu_id = pi.apu_id
  ),
  lineas as (
    select moc.id, moc.categoria, sum(moc.valor_unitario) as valor
      from pi
      join item_apu ia on ia.apu_id = pi.apu_id
      join mano_obra_categorias moc on moc.id = ia.mano_obra_categoria_id
     group by moc.id, moc.categoria
  )
  select l.id, l.categoria, round(coalesce(l.valor, 0) * (1 + (select pct from hm) / 100.0), 2)
    from lineas l
   where ((select count(*) from lineas) >= 2
          or exists (select 1 from apu_import_revision r
                      where r.presupuesto_item_id = p_item and r.dividida_de is not null))
     and not exists (select 1 from pi join item_apu ia on ia.apu_id = pi.apu_id
                      where ia.concepto_fijo in ('mano_obra_subcontrato', 'mano_obra_administracion'))
   order by l.categoria, l.id
$function$;

create or replace function public._tope_valor_unitario_item(p_presupuesto_item_id uuid, p_tipo_contrato text)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $function$
  select case when p_tipo_contrato = 'mano_obra' and m.valor > 0 then least(m.valor, pi.valor_unitario)
              else pi.valor_unitario end
    from presupuesto_items pi
    cross join lateral (select public._valor_mano_obra_item(pi.id) as valor) m
   where pi.id = p_presupuesto_item_id
$function$;

drop function if exists public._tope_mano_obra_item(uuid);

commit;
