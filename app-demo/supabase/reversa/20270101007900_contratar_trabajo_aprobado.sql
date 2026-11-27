-- Reversa de 20270101007900_contratar_trabajo_aprobado.sql (aplicada como 20270101006500): vuelve a pedir que
-- toda la mano de obra del ítem esté aprobada antes de contratar cualquier
-- trabajo, y los trabajos solo existen con 2 o más categorías en el APU.
-- Correr ANTES de volver al código anterior (el código nuevo lee las columnas
-- pendiente / mano_obra_pendiente_sin_dividir, que con la reversa ya no vienen:
-- el formulario las toma como false).

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

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '      -- Un trabajo aprobado se contrata aunque falten otros (20270101006500).
      if public._motivo_linea_no_lista(v_pi.id, v_tipo, nullif(d->>''mano_obra_categoria_id'', '''')::uuid) is not null then
        raise exception ''El ítem % no se puede contratar todavía: %.'', v_pi.codigo,
          public._motivo_linea_no_lista(v_pi.id, v_tipo, nullif(d->>''mano_obra_categoria_id'', '''')::uuid);
      end if;',
  '      if public._motivo_item_no_listo(v_pi.id, v_tipo) is not null then
        raise exception ''El ítem % no se puede contratar todavía: %.'', v_pi.codigo, public._motivo_item_no_listo(v_pi.id, v_tipo);
      end if;');

drop function if exists public._motivo_linea_no_lista(uuid, text, uuid);

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
   where (select count(*) from lineas) >= 2
     and not exists (select 1 from pi join item_apu ia on ia.apu_id = pi.apu_id
                      where ia.concepto_fijo in ('mano_obra_subcontrato', 'mano_obra_administracion'))
   order by l.categoria, l.id
$function$;

drop function if exists public.trabajos_items_contrato(uuid);

create function public.trabajos_items_contrato(p_proyecto_id uuid)
returns table(presupuesto_item_id uuid, mano_obra_categoria_id uuid, nombre text, valor_tope numeric,
              contratado numeric, disponible numeric)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_presupuesto uuid;
  v_version uuid;
begin
  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para solicitar contratos.';
  end if;
  if not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes acceso a este proyecto.';
  end if;
  select p.id, p.version_actual_id into v_presupuesto, v_version
    from presupuestos p where p.proyecto_id = p_proyecto_id;
  if v_version is null then
    return;
  end if;

  return query
  with candidatos as (
    select pi.id, pi.codigo, pi.cantidad
      from presupuesto_items pi
      join item_apu ia on ia.apu_id = pi.apu_id
     where pi.version_id = v_version and pi.cantidad > 0 and pi.valor_unitario > 0
       and ia.mano_obra_categoria_id is not null
     group by pi.id, pi.codigo, pi.cantidad
    having count(distinct ia.mano_obra_categoria_id) >= 2
  ),
  contratado_cat as (
    select p2.codigo, ai.mano_obra_categoria_id as cat, sum(ai.cantidad - ai.cantidad_reducida) as total
      from contrato_anexo_items ai
      join contratos c on c.id = ai.contrato_id
      join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
     where p2.presupuesto_id = v_presupuesto and c.estado <> 'rechazada'
       and p2.codigo in (select codigo from candidatos)
     group by p2.codigo, ai.mano_obra_categoria_id
  )
  select ca.id, t.categoria_id, t.nombre,
         least(t.valor, (select valor_unitario from presupuesto_items where id = ca.id)),
         coalesce((select sum(k.total) from contratado_cat k where k.codigo = ca.codigo and k.cat is null), 0)
           + coalesce((select sum(k.total) from contratado_cat k where k.codigo = ca.codigo and k.cat = t.categoria_id), 0),
         greatest(ca.cantidad
           - coalesce((select sum(k.total) from contratado_cat k where k.codigo = ca.codigo and k.cat is null), 0)
           - coalesce((select sum(k.total) from contratado_cat k where k.codigo = ca.codigo and k.cat = t.categoria_id), 0), 0)
    from candidatos ca
    cross join lateral public._trabajos_item(ca.id) t
   order by ca.codigo, t.nombre;
end;
$function$;

revoke execute on function public.trabajos_items_contrato(uuid) from public;
grant execute on function public.trabajos_items_contrato(uuid) to authenticated;

drop function if exists public.pendientes_items_contrato(uuid);

create function public.pendientes_items_contrato(p_proyecto_id uuid)
returns table(presupuesto_item_id uuid, pendientes integer, mano_obra_pendiente boolean)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para solicitar contratos.';
  end if;
  if not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes acceso a este proyecto.';
  end if;
  return query
  select r.presupuesto_item_id, count(*)::integer, bool_or(r.tipo = 'MO')
    from public.apu_import_revision r
    join public.presupuesto_items pi on pi.id = r.presupuesto_item_id
    join public.presupuestos p on p.version_actual_id = pi.version_id
   where p.proyecto_id = p_proyecto_id
     and r.estado in ('pendiente', 'solicitud_pendiente', 'rechazado')
   group by r.presupuesto_item_id
   order by r.presupuesto_item_id;
end;
$function$;

revoke execute on function public.pendientes_items_contrato(uuid) from public;
grant execute on function public.pendientes_items_contrato(uuid) to authenticated;

commit;
