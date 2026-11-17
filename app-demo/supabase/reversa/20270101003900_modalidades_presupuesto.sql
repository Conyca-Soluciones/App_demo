-- Reversa de 20270101003900_modalidades_presupuesto.sql.
-- Primero devuelve cada ítem con modalidad a como estaba (sus líneas guardadas
-- vuelven al APU y se quita la línea fija); después deshace los parches y quita
-- las funciones. Las columnas se dejan (sin uso) salvo la línea fija.
-- Las solicitudes que se borraron al aplicar modalidades no vuelven.

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

do $$
declare
  v uuid;
begin
  for v in select id from public.presupuesto_items where modalidad is not null or apu_guardado_id is not null loop
    perform public._aplicar_modalidad_item(v, null);
  end loop;
end;
$$;

delete from public.apu a using public.presupuesto_items pi where pi.apu_guardado_id = a.id
  and not exists (select 1 from public.item_apu ia where ia.apu_id = a.id);
update public.presupuesto_items set apu_guardado_id = null where apu_guardado_id is not null;

drop function if exists public.fijar_modalidades_presupuesto(uuid, jsonb, boolean);
drop function if exists public._aplicar_modalidad_item(uuid, text);
drop function if exists public._info_modalidad_item(uuid);

create or replace function public._motivo_item_no_listo(p_presupuesto_item_id uuid, p_tipo text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_tipo = 'mano_obra' and exists (
           select 1 from public.apu_import_revision r
            where r.presupuesto_item_id = p_presupuesto_item_id and r.tipo = 'MO'
              and r.estado in ('pendiente', 'solicitud_pendiente', 'rechazado'))
      then 'falta aprobar la mano de obra de su APU'
    when p_tipo = 'obra' then (
      select case when count(*) > 0 then 'su APU tiene ' || count(*) || ' línea(s) sin resolver' end
        from public.apu_import_revision r
       where r.presupuesto_item_id = p_presupuesto_item_id
         and r.estado in ('pendiente', 'solicitud_pendiente', 'rechazado'))
  end
$$;
revoke all on function public._motivo_item_no_listo(uuid, text) from public, anon, authenticated;

select pg_temp._parche('public.crear_nueva_version(uuid,text)',
  '(v_apus->>pi.apu_id::text)::uuid, pi.precio_original, pi.lineas_apu_oficial,
         pi.modalidad, pi.mano_obra_oficial, pi.herramienta_menor_pct, (v_apus->>pi.apu_guardado_id::text)::uuid',
  '(v_apus->>pi.apu_id::text)::uuid, pi.precio_original, pi.lineas_apu_oficial');
select pg_temp._parche('public.crear_nueva_version(uuid,text)',
  'apu_id, precio_original, lineas_apu_oficial,
                                 modalidad, mano_obra_oficial, herramienta_menor_pct, apu_guardado_id)',
  'apu_id, precio_original, lineas_apu_oficial)');
select pg_temp._parche('public.crear_nueva_version(uuid,text)',
  'ia.desperdicio_pct, ia.desperdicio_clave, ia.concepto_fijo, ia.valor_fijo
    from item_apu ia',
  'ia.desperdicio_pct, ia.desperdicio_clave
    from item_apu ia');
select pg_temp._parche('public.crear_nueva_version(uuid,text)',
  'no_aplica, cantidad_base, desperdicio_pct, desperdicio_clave, concepto_fijo, valor_fijo)',
  'no_aplica, cantidad_base, desperdicio_pct, desperdicio_clave)');
select pg_temp._parche('public.crear_nueva_version(uuid,text)',
  'where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual and pi.apu_id is not null
          union
          select pi.apu_guardado_id from presupuesto_items pi
           where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual and pi.apu_guardado_id is not null) x;',
  'where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual and pi.apu_id is not null) x;');

select pg_temp._parche('public.eliminar_apu_huerfano()',
  '  if old.apu_guardado_id is not null and not exists (
      select 1 from public.presupuesto_items
       where (apu_id = old.apu_guardado_id or apu_guardado_id = old.apu_guardado_id) and id <> old.id
    ) then
    delete from public.apu where id = old.apu_guardado_id;
  end if;
  return old;',
  '  return old;');

select pg_temp._parche('public.sincronizar_apu_import_revision()',
  'r.item_apu_id is null and r.estado <> ''no_requerido''', 'r.item_apu_id is null');
select pg_temp._parche('public.sincronizar_apu_import_revision()',
  'where solicitud_id = new.id and estado <> ''no_requerido'';', 'where solicitud_id = new.id;');
select pg_temp._parche('public.sincronizar_apu_import_revision_mano_obra()',
  'r.item_apu_id is null and r.estado <> ''no_requerido''', 'r.item_apu_id is null');
select pg_temp._parche('public.sincronizar_apu_import_revision_mano_obra()',
  'where solicitud_mano_obra_id = new.id and estado <> ''no_requerido'';', 'where solicitud_mano_obra_id = new.id;');
select pg_temp._parche('public.sincronizar_apu_import_revision_equipo()',
  'r.item_apu_id is null and r.estado <> ''no_requerido''', 'r.item_apu_id is null');
select pg_temp._parche('public.sincronizar_apu_import_revision_equipo()',
  'where solicitud_equipo_id = new.id and estado <> ''no_requerido'';', 'where solicitud_equipo_id = new.id;');

select pg_temp._parche('public.control_proyecto(uuid)',
  'coalesce(moc.valor_unitario, case when ia.concepto_fijo in (''mano_obra_subcontrato'', ''mano_obra_administracion'') then ia.valor_fijo end) as valor_mo',
  'moc.valor_unitario as valor_mo');
select pg_temp._parche('public.items_presupuesto_para_contrato(uuid)',
  '(1 + coalesce(sum(ia.porcentaje_mano_obra / 100.0), 0))
             + coalesce(sum(ia.valor_fijo) filter (where ia.concepto_fijo in (''mano_obra_subcontrato'', ''mano_obra_administracion'')), 0), 2)',
  '(1 + coalesce(sum(ia.porcentaje_mano_obra / 100.0), 0)), 2)');
select pg_temp._parche('public._valor_mano_obra_item(uuid)',
  '(1 + coalesce(sum(ia.porcentaje_mano_obra / 100.0), 0))
             + coalesce(sum(ia.valor_fijo) filter (where ia.concepto_fijo in (''mano_obra_subcontrato'', ''mano_obra_administracion'')), 0), 2)',
  '(1 + coalesce(sum(ia.porcentaje_mano_obra / 100.0), 0)), 2)');
select pg_temp._parche('public.recalcular_valor_apus(uuid[])',
  'coalesce(sum(moc.valor_unitario), 0), 0)
        + coalesce(sum(ia.valor_fijo), 0),',
  'coalesce(sum(moc.valor_unitario), 0), 0),');

update public.apu_import_revision set estado = 'pendiente' where estado = 'no_requerido';
alter table public.apu_import_revision drop constraint if exists apu_import_revision_estado_check;
alter table public.apu_import_revision add constraint apu_import_revision_estado_check
  check (estado in ('auto_match', 'pendiente', 'solicitud_pendiente', 'resuelto', 'rechazado'));

delete from public.item_apu where concepto_fijo is not null;
alter table public.item_apu drop constraint if exists item_apu_recurso_unico_check;
alter table public.item_apu add constraint item_apu_recurso_unico_check
  check (num_nonnulls(insumo_id, mano_obra_categoria_id, porcentaje_mano_obra, equipo_categoria_id, transporte_precio_id)
         = case when no_aplica is null then 1 else 0 end);
alter table public.item_apu drop constraint if exists item_apu_concepto_fijo_check;
alter table public.item_apu drop column if exists valor_fijo;
alter table public.item_apu drop column if exists concepto_fijo;

commit;
