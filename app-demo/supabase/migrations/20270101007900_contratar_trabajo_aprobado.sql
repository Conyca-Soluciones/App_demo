-- Contratar un trabajo de la mano de obra dividida apenas esté aprobado,
-- aunque otro trabajo del mismo ítem siga en Aprobación de mano de obra
-- (decisión del usuario, 2026-11-27; cambia 20270101003600 y 20270101004400).
--
-- Caso: la Loseta (5.3.2 del Malecón) se dividió en "Fabricación de loseta"
-- (aprobada en el catálogo) e "Instalación de loseta" (esperando aprobación).
-- Antes el ítem salía entero como "falta aprobar la mano de obra de su APU" y
-- tampoco tenía trabajos (hacían falta 2 categorías en el APU), así que no se
-- podía contratar la fabricación.
--
-- 1. _trabajos_item: un ítem dividido tiene trabajos aunque solo uno esté
--    aprobado (los aprobados; los demás todavía no tienen categoría).
-- 2. _motivo_linea_no_lista(item, tipo, trabajo): igual que
--    _motivo_item_no_listo, pero en un contrato de mano de obra por un
--    trabajo aprobado de un ítem dividido no cuenta la mano de obra pendiente
--    de los OTROS trabajos. La mano de obra completa sigue esperando a que se
--    aprueben todos. _guardar_solicitud_contrato la usa.
-- 3. trabajos_items_contrato devuelve también los trabajos pendientes
--    (pendiente = true, sin categoría ni cupo) para mostrarlos en gris.
-- 4. pendientes_items_contrato devuelve mano_obra_pendiente_sin_dividir:
--    mano de obra pendiente que NO es un trabajo de la división.
--
-- Va ANTES del código. Reversa en supabase/reversa/.
--
-- Se aplicó en Supabase (2026-11-27) con el número 20270101006500, que en main ya
-- usaba otra migración; se renombró a 20270101007900. Los textos que deja en las
-- funciones siguen diciendo "(20270101006500)": así quedaron en la base y la
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

-- 1. Trabajos de un ítem -------------------------------------------------------------

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
   -- 2 o más categorías, o la mano de obra dividida (aunque solo un trabajo
   -- esté aprobado todavía, 20270101006500).
   where ((select count(*) from lineas) >= 2
          or exists (select 1 from apu_import_revision r
                      where r.presupuesto_item_id = p_item and r.dividida_de is not null))
     and not exists (select 1 from pi join item_apu ia on ia.apu_id = pi.apu_id
                      where ia.concepto_fijo in ('mano_obra_subcontrato', 'mano_obra_administracion'))
   order by l.categoria, l.id
$function$;

-- 2. ¿Se puede contratar esta actividad? ----------------------------------------------

create or replace function public._motivo_linea_no_lista(p_item uuid, p_tipo text, p_trabajo uuid)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    -- Un trabajo aprobado de un ítem dividido: la mano de obra pendiente de
    -- los otros trabajos no lo frena. La modalidad sí (todo costo /
    -- administración no llevan contrato de mano de obra).
    when p_trabajo is not null and p_tipo = 'mano_obra'
         and exists (select 1 from apu_import_revision r
                      where r.presupuesto_item_id = p_item and r.dividida_de is not null)
         and not exists (select 1 from apu_import_revision r
                          where r.presupuesto_item_id = p_item and r.tipo = 'MO' and r.dividida_de is null
                            and r.estado in ('pendiente', 'solicitud_pendiente', 'rechazado'))
      then (select case when pi.modalidad in ('todo_costo', 'administracion')
                        then public._motivo_item_no_listo(p_item, p_tipo) end
              from presupuesto_items pi where pi.id = p_item)
    when p_trabajo is null and p_tipo = 'mano_obra'
         and exists (select 1 from apu_import_revision r
                      where r.presupuesto_item_id = p_item and r.dividida_de is not null
                        and r.estado in ('pendiente', 'solicitud_pendiente', 'rechazado'))
         and public._motivo_item_no_listo(p_item, p_tipo) = 'falta aprobar la mano de obra de su APU'
      then 'falta aprobar un trabajo de su mano de obra: contrata por separado los trabajos ya aprobados'
    else public._motivo_item_no_listo(p_item, p_tipo)
  end
$function$;

revoke execute on function public._motivo_linea_no_lista(uuid, text, uuid) from public;

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '      if public._motivo_item_no_listo(v_pi.id, v_tipo) is not null then
        raise exception ''El ítem % no se puede contratar todavía: %.'', v_pi.codigo, public._motivo_item_no_listo(v_pi.id, v_tipo);
      end if;',
  '      -- Un trabajo aprobado se contrata aunque falten otros (20270101006500).
      if public._motivo_linea_no_lista(v_pi.id, v_tipo, nullif(d->>''mano_obra_categoria_id'', '''')::uuid) is not null then
        raise exception ''El ítem % no se puede contratar todavía: %.'', v_pi.codigo,
          public._motivo_linea_no_lista(v_pi.id, v_tipo, nullif(d->>''mano_obra_categoria_id'', '''')::uuid);
      end if;');

-- 3. Trabajos para el formulario de contratos ------------------------------------------

drop function if exists public.trabajos_items_contrato(uuid);

create function public.trabajos_items_contrato(p_proyecto_id uuid)
returns table(presupuesto_item_id uuid, mano_obra_categoria_id uuid, nombre text, valor_tope numeric,
              contratado numeric, disponible numeric, pendiente boolean)
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
  with con_categorias as (
    -- Ítems con 2 o más categorías de mano de obra en su APU (una pasada).
    select pi.id as c_id
      from presupuesto_items pi
      join item_apu ia on ia.apu_id = pi.apu_id
     where pi.version_id = v_version and ia.mano_obra_categoria_id is not null
     group by pi.id
    having count(distinct ia.mano_obra_categoria_id) >= 2
  ),
  divididos as (
    -- Ítems con la mano de obra dividida (aunque falte aprobar algún trabajo).
    select r.presupuesto_item_id as c_id
      from apu_import_revision r
      join presupuesto_items pi on pi.id = r.presupuesto_item_id
     where pi.version_id = v_version and r.dividida_de is not null
     group by r.presupuesto_item_id
  ),
  candidatos as (
    select pi.id as c_id, pi.codigo as c_codigo, pi.cantidad as c_cantidad, pi.valor_unitario as c_vu
      from presupuesto_items pi
     where pi.id in (select c_id from con_categorias union select c_id from divididos)
       and pi.cantidad > 0 and pi.valor_unitario > 0
  ),
  contratado_cat as (
    select p2.codigo as k_codigo, ai.mano_obra_categoria_id as k_cat, sum(ai.cantidad - ai.cantidad_reducida) as k_total
      from contrato_anexo_items ai
      join contratos c on c.id = ai.contrato_id
      join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
     where p2.presupuesto_id = v_presupuesto and c.estado <> 'rechazada'
       and p2.codigo in (select c_codigo from candidatos)
     group by p2.codigo, ai.mano_obra_categoria_id
  ),
  filas as (
    -- Trabajos aprobados: con su tope y lo disponible.
    select ca.c_id as f_item, t.categoria_id as f_cat, t.nombre as f_nombre,
           least(t.valor, ca.c_vu) as f_tope,
           coalesce((select sum(k.k_total) from contratado_cat k where k.k_codigo = ca.c_codigo and k.k_cat is null), 0)
             + coalesce((select sum(k.k_total) from contratado_cat k where k.k_codigo = ca.c_codigo and k.k_cat = t.categoria_id), 0)
             as f_contratado,
           greatest(ca.c_cantidad
             - coalesce((select sum(k.k_total) from contratado_cat k where k.k_codigo = ca.c_codigo and k.k_cat is null), 0)
             - coalesce((select sum(k.k_total) from contratado_cat k where k.k_codigo = ca.c_codigo and k.k_cat = t.categoria_id), 0), 0)
             as f_disponible,
           false as f_pendiente, ca.c_codigo as f_codigo
      from candidatos ca
      cross join lateral public._trabajos_item(ca.c_id) t
    union all
    -- Trabajos que esperan aprobación (o se rechazaron): solo para mostrarlos.
    select ca.c_id, null::uuid, r.descripcion_original, null::numeric, 0::numeric, 0::numeric, true, ca.c_codigo
      from candidatos ca
      join apu_import_revision r on r.presupuesto_item_id = ca.c_id
     where r.dividida_de is not null and r.estado in ('pendiente', 'solicitud_pendiente', 'rechazado')
  )
  select f.f_item, f.f_cat, f.f_nombre, f.f_tope, f.f_contratado, f.f_disponible, f.f_pendiente
    from filas f
   order by f.f_codigo, f.f_pendiente, f.f_nombre;
end;
$function$;

revoke execute on function public.trabajos_items_contrato(uuid) from public;
grant execute on function public.trabajos_items_contrato(uuid) to authenticated;

-- 4. Pendientes de los ítems ------------------------------------------------------------

drop function if exists public.pendientes_items_contrato(uuid);

create function public.pendientes_items_contrato(p_proyecto_id uuid)
returns table(presupuesto_item_id uuid, pendientes integer, mano_obra_pendiente boolean,
              mano_obra_pendiente_sin_dividir boolean)
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
  select r.presupuesto_item_id, count(*)::integer, bool_or(r.tipo = 'MO'),
         -- Mano de obra pendiente que no es un trabajo de la división (20270101006500).
         coalesce(bool_or(r.tipo = 'MO' and r.dividida_de is null), false)
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
