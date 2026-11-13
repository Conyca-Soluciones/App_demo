-- Desperdicio como % GENERAL de la versión (decisión del usuario, 2026-11-13;
-- cambia la regla de 20270101003000, que lo guardaba insumo por insumo).
--
-- Se pone una vez (botón "Desperdicio") y se aplica solo a TODAS las líneas de
-- insumo de la versión: las que ya están y las que entren después (insumo
-- aprobado por Compras, línea resuelta en Revisar pendientes, editor de APU).
-- Así Técnica lo maneja en cualquier presupuesto sin pasos extra.
--
-- % de una línea de insumo =
--   1. la excepción del insumo en la versión (presupuesto_desperdicios; 0 =
--      ese insumo sin desperdicio, otro número = su propio %), si existe;
--   2. si no, 0 cuando la línea ya trae desperdicio: su texto del Excel
--      (apu_import_revision enlazada) o el nombre del insumo dicen
--      "desperdicio" (concretos y morteros "Básico, 5% desperdicio");
--   3. si no, el % general de la versión (presupuesto_versiones.desperdicio_pct).
--
-- - Al enlazarse una revisión del import con su línea (item_apu_id) se vuelve
--   a calcular el % de esa línea: la línea "con desperdicio" queda en 0.
-- - fijar_desperdicio_presupuesto(versión, general, excepciones) reemplaza a la
--   de 20270101003000 (otra firma).
-- - crear_nueva_version copia también el % general.
--
-- Todo en una transacción. Se puede correr más de una vez.

begin;

-- 0. crear_nueva_version copia el % general (primero: si su texto no es el
--    esperado, se detiene antes de cambiar nada)
do $$
declare
  d text := pg_get_functiondef('public.crear_nueva_version'::regproc);
  a1 text := E'  insert into presupuesto_versiones (presupuesto_id, numero, nombre)\n  values (p_presupuesto_id, v_numero, v_nombre)\n';
  b1 text := E'  insert into presupuesto_versiones (presupuesto_id, numero, nombre, desperdicio_pct)\n'
          || E'  values (p_presupuesto_id, v_numero, v_nombre,\n'
          || E'          coalesce((select x.desperdicio_pct from presupuesto_versiones x where x.id = v_actual), 0))\n';
begin
  d := replace(d, E'\r\n', E'\n');
  if position('nombre, desperdicio_pct)' in d) > 0 then
    return;
  end if;
  if position(a1 in d) = 0 then
    raise exception 'crear_nueva_version no tiene el texto esperado.';
  end if;
  execute replace(d, a1, b1);
end $$;

-- 1. % general y excepciones en 0 ------------------------------------------------
alter table public.presupuesto_versiones
  add column if not exists desperdicio_pct numeric(6,2) not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'presupuesto_versiones_desperdicio_pct_check') then
    alter table public.presupuesto_versiones add constraint presupuesto_versiones_desperdicio_pct_check
      check (desperdicio_pct >= 0 and desperdicio_pct <= 100);
  end if;
end $$;

alter table public.presupuesto_desperdicios drop constraint if exists presupuesto_desperdicios_porcentaje_check;
alter table public.presupuesto_desperdicios add constraint presupuesto_desperdicios_porcentaje_check
  check (porcentaje >= 0 and porcentaje <= 100);

-- 2. La regla ----------------------------------------------------------------
create or replace function public._desperdicio_de_linea(p_item_apu_id uuid, p_apu_id uuid, p_insumo_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when p_insumo_id is null then 0 else coalesce((
    select coalesce(d.porcentaje,
                    case when mi.descripcion ilike '%desperdicio%'
                           or exists (select 1 from public.apu_import_revision r
                                       where r.item_apu_id = p_item_apu_id
                                         and r.descripcion_original ilike '%desperdicio%')
                         then 0 else v.desperdicio_pct end)
      from public.presupuesto_items pi
      join public.presupuesto_versiones v on v.id = pi.version_id
      join public.maestro_insumos mi on mi.id = p_insumo_id
      left join public.presupuesto_desperdicios d on d.version_id = pi.version_id and d.insumo_id = p_insumo_id
     where pi.apu_id = p_apu_id
     limit 1), 0) end
$$;
revoke all on function public._desperdicio_de_linea(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public._item_apu_desperdicio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base numeric;
  v_pct numeric;
begin
  if tg_op = 'UPDATE' then
    v_base := coalesce(old.cantidad_base, old.cantidad);
    if new.cantidad is distinct from old.cantidad
       and new.cantidad_base is not distinct from old.cantidad_base
       and new.desperdicio_pct is not distinct from old.desperdicio_pct then
      v_base := new.cantidad; -- se escribió la cantidad (editor): es la base
    elsif new.cantidad_base is distinct from old.cantidad_base then
      v_base := coalesce(new.cantidad_base, new.cantidad);
    end if;
    v_pct := new.desperdicio_pct;
    if new.insumo_id is distinct from old.insumo_id or new.apu_id is distinct from old.apu_id then
      v_pct := public._desperdicio_de_linea(new.id, new.apu_id, new.insumo_id);
    end if;
  else
    v_base := coalesce(new.cantidad_base, new.cantidad);
    if new.cantidad_base is not null then
      v_pct := new.desperdicio_pct; -- copia de otra línea (versión nueva)
    else
      v_pct := public._desperdicio_de_linea(new.id, new.apu_id, new.insumo_id);
    end if;
  end if;

  if new.insumo_id is null then
    v_pct := 0;
  end if;
  v_pct := coalesce(v_pct, 0);
  if v_pct = 0 then
    new.cantidad := v_base;
    new.cantidad_base := null;
    new.desperdicio_pct := 0;
  else
    new.cantidad_base := v_base;
    new.desperdicio_pct := v_pct;
    new.cantidad := round(v_base * (1 + v_pct / 100), 4);
  end if;
  return new;
end;
$$;
revoke all on function public._item_apu_desperdicio() from public, anon, authenticated;

drop function if exists public._desperdicio_de_linea(uuid, uuid);

-- Recalcula el % de todas las líneas de insumo de esos APU con la regla.
-- Antes devolvía void: se borra para cambiar el tipo (solo la llaman funciones).
drop function if exists public._aplicar_desperdicio_apus(uuid[]);
create or replace function public._aplicar_desperdicio_apus(p_apu_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  with lineas as (
    select ia.id, public._desperdicio_de_linea(ia.id, ia.apu_id, ia.insumo_id) as pct
      from public.item_apu ia
     where ia.apu_id = any(p_apu_ids) and ia.insumo_id is not null
  )
  update public.item_apu ia
     set desperdicio_pct = l.pct
    from lineas l
   where ia.id = l.id and ia.desperdicio_pct is distinct from l.pct;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public._aplicar_desperdicio_apus(uuid[]) from public, anon, authenticated;

create or replace function public._presupuesto_items_desperdicio_ins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apus uuid[];
begin
  select array_agg(distinct n.apu_id) into v_apus
    from nuevos n
    join public.presupuesto_versiones v on v.id = n.version_id
   where n.apu_id is not null
     and (v.desperdicio_pct > 0 or exists (select 1 from public.presupuesto_desperdicios d where d.version_id = n.version_id));
  if v_apus is not null then
    perform public._aplicar_desperdicio_apus(v_apus);
  end if;
  return null;
end;
$$;
revoke all on function public._presupuesto_items_desperdicio_ins() from public, anon, authenticated;

-- 3. Al enlazar la revisión del import con su línea ---------------------------
create or replace function public._revision_desperdicio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apu uuid;
begin
  select ia.apu_id into v_apu from public.item_apu ia where ia.id = new.item_apu_id;
  if v_apu is not null then
    perform public._aplicar_desperdicio_apus(array[v_apu]);
  end if;
  return null;
end;
$$;
revoke all on function public._revision_desperdicio() from public, anon, authenticated;

drop trigger if exists trg_revision_desperdicio on public.apu_import_revision;
create trigger trg_revision_desperdicio
  after insert or update of item_apu_id on public.apu_import_revision
  for each row
  when (new.item_apu_id is not null and new.descripcion_original ilike '%desperdicio%')
  execute function public._revision_desperdicio();

-- 4. Datos para el diálogo ------------------------------------------------------
create or replace function public.insumos_para_desperdicio(p_version_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with lineas as (
    select ia.id, ia.insumo_id,
           coalesce(ia.cantidad_base, ia.cantidad) as base,
           coalesce(pi.cantidad, 0) as cant_item,
           coalesce(ia.rendimiento, 1) as rend,
           coalesce(ia.precio_unitario_congelado, coalesce(mi.vr_neto, mi.vr_unitario, 0) / nullif(coalesce(ia.factor_unidad, 1), 0), 0) as precio,
           pi.id as item_id,
           (mi.descripcion ilike '%desperdicio%'
            or exists (select 1 from public.apu_import_revision r
                        where r.item_apu_id = ia.id and r.descripcion_original ilike '%desperdicio%')) as trae
      from public.presupuesto_items pi
      join public.item_apu ia on ia.apu_id = pi.apu_id
      join public.maestro_insumos mi on mi.id = ia.insumo_id
     where pi.version_id = p_version_id
  ),
  por_insumo as (
    select l.insumo_id,
           count(distinct l.item_id) as n_items,
           sum(l.base * l.cant_item) as cantidad_base,
           sum(l.base * l.rend * l.precio * l.cant_item) as valor_base,
           -- lo que toma el % general (sin las líneas que ya traen desperdicio)
           coalesce(sum(l.base * l.rend * l.precio * l.cant_item) filter (where not l.trae), 0) as valor_aplicable,
           count(*) filter (where l.trae) as lineas_trae
      from lineas l
     group by l.insumo_id
  )
  select jsonb_build_object(
    'general', (select v.desperdicio_pct from public.presupuesto_versiones v where v.id = p_version_id),
    'valor_presupuesto', (select coalesce(sum(pi.valor_total), 0) from public.presupuesto_items pi
                           where pi.version_id = p_version_id and pi.apu_id is not null),
    'insumos', coalesce(jsonb_agg(jsonb_build_object(
      'insumo_id', p.insumo_id, 'codigo', mi.codigo, 'descripcion', mi.descripcion,
      'unidad', mi.u_m, 'tipo', mi.tipo, 'n_items', p.n_items,
      'cantidad_base', round(p.cantidad_base, 4), 'valor_base', round(p.valor_base, 2),
      'valor_aplicable', round(p.valor_aplicable, 2), 'lineas_trae', p.lineas_trae,
      'excepcion', d.porcentaje)
      order by p.valor_base desc nulls last), '[]'::jsonb))
    from por_insumo p
    join public.maestro_insumos mi on mi.id = p.insumo_id
    left join public.presupuesto_desperdicios d on d.version_id = p_version_id and d.insumo_id = p.insumo_id
$$;
revoke all on function public.insumos_para_desperdicio(uuid) from public, anon;
grant execute on function public.insumos_para_desperdicio(uuid) to authenticated;

-- 5. Guardar: % general + excepciones (lista completa) ---------------------------
drop function if exists public.fijar_desperdicio_presupuesto(uuid, jsonb);

create or replace function public.fijar_desperdicio_presupuesto(p_version_id uuid, p_general numeric, p_excepciones jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_presupuesto uuid;
  v_proyecto uuid;
  v_actual uuid;
  v_apus uuid[];
  v_antes numeric;
  v_despues numeric;
  v_lineas integer := 0;
  v_n integer;
begin
  if v_uid is null or not public.tiene_accion(v_uid, 'editar_presupuestos') then
    raise exception 'No tienes permiso para editar presupuestos.';
  end if;
  select p.id, p.proyecto_id, p.version_actual_id into v_presupuesto, v_proyecto, v_actual
    from public.presupuesto_versiones v
    join public.presupuestos p on p.id = v.presupuesto_id
   where v.id = p_version_id
     for update of p;
  if not found or v_proyecto is null or not public.usuario_puede_ver_proyecto(v_uid, v_proyecto) then
    raise exception 'El presupuesto no existe o no tienes acceso.';
  end if;
  if v_actual is distinct from p_version_id then
    raise exception 'Solo se cambia el desperdicio de la versión vigente.';
  end if;
  if p_general is null or p_general < 0 or p_general > 100 then
    raise exception 'El desperdicio general debe estar entre 0 y 100 %%.';
  end if;
  if jsonb_typeof(coalesce(p_excepciones, '[]'::jsonb)) <> 'array' then
    raise exception 'Lista de excepciones inválida.';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_excepciones, '[]'::jsonb)) e
              where nullif(e->>'insumo_id', '') is null
                 or (e->>'porcentaje') is null
                 or (e->>'porcentaje')::numeric < 0 or (e->>'porcentaje')::numeric > 100) then
    raise exception 'Cada excepción debe tener insumo y un %% entre 0 y 100.';
  end if;

  select array_agg(distinct pi.apu_id) into v_apus
    from public.presupuesto_items pi
   where pi.version_id = p_version_id and pi.apu_id is not null;
  select coalesce(sum(valor_total), 0) into v_antes
    from public.presupuesto_items where version_id = p_version_id and apu_id is not null;

  update public.presupuesto_versiones set desperdicio_pct = round(p_general, 2) where id = p_version_id;
  delete from public.presupuesto_desperdicios where version_id = p_version_id;
  insert into public.presupuesto_desperdicios (version_id, insumo_id, porcentaje, actualizado_por, actualizado_at)
  select distinct on ((e->>'insumo_id')::uuid) p_version_id, (e->>'insumo_id')::uuid, round((e->>'porcentaje')::numeric, 2), v_uid, now()
    from jsonb_array_elements(coalesce(p_excepciones, '[]'::jsonb)) e;
  get diagnostics v_n = row_count;

  if v_apus is not null then
    v_lineas := public._aplicar_desperdicio_apus(v_apus);
    perform public.recalcular_valor_apus(v_apus);
  end if;

  select coalesce(sum(valor_total), 0) into v_despues
    from public.presupuesto_items where version_id = p_version_id and apu_id is not null;

  perform public._anotar_historial('presupuesto', v_presupuesto, 'desperdicio',
    jsonb_build_object('version_id', p_version_id, 'general', round(p_general, 2), 'excepciones', v_n,
                       'lineas', v_lineas, 'valor_antes', v_antes, 'valor_despues', v_despues));

  return jsonb_build_object('general', round(p_general, 2), 'excepciones', v_n, 'lineas', v_lineas,
                            'valor_antes', v_antes, 'valor_despues', v_despues);
end;
$$;
revoke all on function public.fijar_desperdicio_presupuesto(uuid, numeric, jsonb) from public, anon;
grant execute on function public.fijar_desperdicio_presupuesto(uuid, numeric, jsonb) to authenticated;

commit;
