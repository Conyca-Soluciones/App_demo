-- Desperdicio en el presupuesto (decisión del usuario, 2026-11-13).
--
-- Un % de desperdicio por INSUMO en cada versión del presupuesto (botón
-- "Desperdicio" en Elaboración de presupuestos). El desperdicio INFLA la
-- cantidad de las líneas de ese insumo en los APU de la versión:
--   item_apu.cantidad = cantidad_base × (1 + desperdicio_pct / 100)
-- Así sube el valor del presupuesto (recalcular_valor_apus) y el cupo de las
-- requisiciones (que salen de item_apu.cantidad), sin tocar esas funciones.
--
-- - presupuesto_desperdicios (versión, insumo, %): lo que se eligió.
-- - item_apu.cantidad_base: la cantidad del APU sin desperdicio (null = la
--   línea no tiene desperdicio y cantidad ya es la base).
--   item_apu.desperdicio_pct: el % aplicado a la línea (0 = ninguno).
-- - Disparador en item_apu: una línea de insumo nueva toma el % de su versión;
--   escribir la cantidad (editor de APU) cambia la BASE y se vuelve a inflar.
-- - Disparador en presupuesto_items: al enlazar un APU a un ítem (APU antes de
--   guardar, import, copia de recomendados) sus líneas toman el % de la versión.
-- - fijar_desperdicio_presupuesto: guarda los % de la versión vigente, los
--   aplica a todas sus líneas y recalcula los valores (historial del
--   presupuesto, evento "desperdicio").
-- - insumos_para_desperdicio: los insumos de la versión para el diálogo, con
--   el valor sin desperdicio y una marca si el APU dice que ya lo incluye.
-- - crear_nueva_version copia los % y las dos columnas (parche de texto).
--
-- Va ANTES del código. Se puede correr más de una vez. Todo en una
-- transacción: si algo falla, no queda nada a medias.

begin;

-- 0. crear_nueva_version copia los % y las columnas (primero: si su texto no
--    es el esperado, la migración se detiene antes de cambiar nada) ----------------------------
do $$
declare
  d text := pg_get_functiondef('public.crear_nueva_version'::regproc);
  a1 text := E'precio_unitario_congelado, unidad, factor_unidad, no_aplica)\n';
  b1 text := E'precio_unitario_congelado, unidad, factor_unidad, no_aplica, cantidad_base, desperdicio_pct)\n';
  a2 text := E'coalesce(ia.factor_unidad, 1), ia.no_aplica\n';
  b2 text := E'coalesce(ia.factor_unidad, 1), ia.no_aplica, ia.cantidad_base, ia.desperdicio_pct\n';
  a3 text := E'  -- id viejo -> id nuevo de cada ítem y de cada APU usado.\n';
  b3 text := E'  -- El desperdicio de la versión pasa igual a la nueva.\n'
          || E'  insert into presupuesto_desperdicios (version_id, insumo_id, porcentaje, actualizado_por, actualizado_at)\n'
          || E'  select v_nueva.id, d.insumo_id, d.porcentaje, d.actualizado_por, d.actualizado_at\n'
          || E'    from presupuesto_desperdicios d where d.version_id = v_actual;\n\n'
          || a3;
begin
  d := replace(d, E'\r\n', E'\n');
  if position('ia.desperdicio_pct' in d) > 0 then
    return;
  end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 or position(a3 in d) = 0 then
    raise exception 'crear_nueva_version no tiene el texto esperado.';
  end if;
  execute replace(replace(replace(d, a1, b1), a2, b2), a3, b3);
end $$;

-- 1. Tabla y columnas ---------------------------------------------------------
create table if not exists public.presupuesto_desperdicios (
  version_id uuid not null references public.presupuesto_versiones(id) on delete cascade,
  insumo_id uuid not null references public.maestro_insumos(id) on delete cascade,
  porcentaje numeric(6,2) not null check (porcentaje > 0 and porcentaje <= 100),
  actualizado_por uuid references public.perfiles(id),
  actualizado_at timestamptz not null default now(),
  primary key (version_id, insumo_id)
);
create index if not exists idx_presupuesto_desperdicios_insumo on public.presupuesto_desperdicios (insumo_id);

alter table public.presupuesto_desperdicios enable row level security;

-- Leer: quien ve el presupuesto (la subconsulta aplica su política).
-- Escribir: editar_presupuestos y el presupuesto visible (crear_nueva_version
-- es SECURITY INVOKER y copia los % con el permiso de quien la llama).
drop policy if exists presupuesto_desperdicios_select on public.presupuesto_desperdicios;
create policy presupuesto_desperdicios_select on public.presupuesto_desperdicios
  for select to authenticated
  using (exists (select 1 from public.presupuesto_versiones v
                   join public.presupuestos p on p.id = v.presupuesto_id
                  where v.id = version_id));
drop policy if exists presupuesto_desperdicios_insert on public.presupuesto_desperdicios;
create policy presupuesto_desperdicios_insert on public.presupuesto_desperdicios
  for insert to authenticated
  with check ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
              and exists (select 1 from public.presupuesto_versiones v
                            join public.presupuestos p on p.id = v.presupuesto_id
                           where v.id = version_id));

alter table public.item_apu
  add column if not exists cantidad_base numeric(12,4),
  add column if not exists desperdicio_pct numeric(6,2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'item_apu_desperdicio_pct_check') then
    alter table public.item_apu add constraint item_apu_desperdicio_pct_check
      check (desperdicio_pct >= 0 and desperdicio_pct <= 100);
  end if;
end $$;

-- 2. % de una línea según su versión -----------------------------------------
create or replace function public._desperdicio_de_linea(p_apu_id uuid, p_insumo_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select d.porcentaje
      from public.presupuesto_items pi
      join public.presupuesto_desperdicios d on d.version_id = pi.version_id and d.insumo_id = p_insumo_id
     where pi.apu_id = p_apu_id and p_insumo_id is not null
     limit 1), 0)
$$;
revoke all on function public._desperdicio_de_linea(uuid, uuid) from public, anon, authenticated;

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
      v_pct := public._desperdicio_de_linea(new.apu_id, new.insumo_id);
    end if;
  else
    v_base := coalesce(new.cantidad_base, new.cantidad);
    if new.cantidad_base is not null then
      v_pct := new.desperdicio_pct; -- copia de otra línea (versión nueva)
    else
      v_pct := public._desperdicio_de_linea(new.apu_id, new.insumo_id);
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

drop trigger if exists trg_item_apu_desperdicio on public.item_apu;
create trigger trg_item_apu_desperdicio
  before insert or update on public.item_apu
  for each row execute function public._item_apu_desperdicio();

-- 3. Al enlazar un APU a un ítem, sus líneas toman el % de la versión ---------
create or replace function public._aplicar_desperdicio_apus(p_apu_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  with lineas as (
    select distinct on (ia.id) ia.id, coalesce(d.porcentaje, 0) as pct
      from public.item_apu ia
      join public.presupuesto_items pi on pi.apu_id = ia.apu_id
      left join public.presupuesto_desperdicios d on d.version_id = pi.version_id and d.insumo_id = ia.insumo_id
     where ia.apu_id = any(p_apu_ids) and ia.insumo_id is not null
     order by ia.id
  )
  update public.item_apu ia
     set desperdicio_pct = l.pct
    from lineas l
   where ia.id = l.id and ia.desperdicio_pct is distinct from l.pct
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
   where n.apu_id is not null and n.version_id is not null
     and exists (select 1 from public.presupuesto_desperdicios d where d.version_id = n.version_id);
  if v_apus is not null then
    perform public._aplicar_desperdicio_apus(v_apus);
  end if;
  return null;
end;
$$;
revoke all on function public._presupuesto_items_desperdicio_ins() from public, anon, authenticated;

create or replace function public._presupuesto_items_desperdicio_upd()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.apu_id is not null then
    perform public._aplicar_desperdicio_apus(array[new.apu_id]);
  end if;
  return null;
end;
$$;
revoke all on function public._presupuesto_items_desperdicio_upd() from public, anon, authenticated;

drop trigger if exists trg_presupuesto_items_desperdicio_ins on public.presupuesto_items;
create trigger trg_presupuesto_items_desperdicio_ins
  after insert on public.presupuesto_items
  referencing new table as nuevos
  for each statement execute function public._presupuesto_items_desperdicio_ins();

drop trigger if exists trg_presupuesto_items_desperdicio_upd on public.presupuesto_items;
create trigger trg_presupuesto_items_desperdicio_upd
  after update of apu_id, version_id on public.presupuesto_items
  for each row
  when (old.apu_id is distinct from new.apu_id or old.version_id is distinct from new.version_id)
  execute function public._presupuesto_items_desperdicio_upd();

-- 4. Insumos de la versión para el diálogo ------------------------------------
-- SECURITY INVOKER: lee con las políticas de quien consulta.
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
           pi.id as item_id
      from public.presupuesto_items pi
      join public.item_apu ia on ia.apu_id = pi.apu_id
      join public.maestro_insumos mi on mi.id = ia.insumo_id
     where pi.version_id = p_version_id
  ),
  dice as (
    select distinct r.insumo_id_asignado as insumo_id
      from public.apu_import_revision r
      join lineas l on l.id = r.item_apu_id
     where r.descripcion_original ilike '%desperdicio%'
  ),
  por_insumo as (
    select l.insumo_id,
           count(distinct l.item_id) as n_items,
           sum(l.base * l.cant_item) as cantidad_base,
           sum(l.base * l.rend * l.precio * l.cant_item) as valor_base
      from lineas l
     group by l.insumo_id
  )
  select jsonb_build_object(
    'valor_presupuesto', (select coalesce(sum(pi.valor_total), 0) from public.presupuesto_items pi
                           where pi.version_id = p_version_id and pi.apu_id is not null),
    'insumos', coalesce(jsonb_agg(jsonb_build_object(
      'insumo_id', p.insumo_id, 'codigo', mi.codigo, 'descripcion', mi.descripcion,
      'unidad', mi.u_m, 'tipo', mi.tipo, 'n_items', p.n_items,
      'cantidad_base', round(p.cantidad_base, 4), 'valor_base', round(p.valor_base, 2),
      'porcentaje', d.porcentaje,
      'dice_desperdicio', mi.descripcion ilike '%desperdicio%' or exists (select 1 from dice x where x.insumo_id = p.insumo_id))
      order by p.valor_base desc nulls last), '[]'::jsonb))
    from por_insumo p
    join public.maestro_insumos mi on mi.id = p.insumo_id
    left join public.presupuesto_desperdicios d on d.version_id = p_version_id and d.insumo_id = p.insumo_id
$$;
revoke all on function public.insumos_para_desperdicio(uuid) from public, anon;
grant execute on function public.insumos_para_desperdicio(uuid) to authenticated;

-- 5. Guardar los % de la versión vigente ---------------------------------------
-- p_items = [{insumo_id, porcentaje}] con TODOS los insumos con desperdicio;
-- los que no vienen (o vienen en 0) quedan sin desperdicio.
create or replace function public.fijar_desperdicio_presupuesto(p_version_id uuid, p_items jsonb)
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
  v_lineas integer;
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
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Lista de desperdicios inválida.';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
              where nullif(e->>'insumo_id', '') is null
                 or (e->>'porcentaje')::numeric < 0 or (e->>'porcentaje')::numeric > 100) then
    raise exception 'Cada desperdicio debe tener insumo y un %% entre 0 y 100.';
  end if;

  select array_agg(distinct pi.apu_id) into v_apus
    from public.presupuesto_items pi
   where pi.version_id = p_version_id and pi.apu_id is not null;
  select coalesce(sum(valor_total), 0) into v_antes
    from public.presupuesto_items where version_id = p_version_id and apu_id is not null;

  delete from public.presupuesto_desperdicios d
   where d.version_id = p_version_id
     and not exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
                      where (e->>'insumo_id')::uuid = d.insumo_id and (e->>'porcentaje')::numeric > 0);
  insert into public.presupuesto_desperdicios (version_id, insumo_id, porcentaje, actualizado_por, actualizado_at)
  select p_version_id, x.insumo_id, x.porcentaje, v_uid, now()
    from (select distinct on ((e->>'insumo_id')::uuid) (e->>'insumo_id')::uuid as insumo_id, round((e->>'porcentaje')::numeric, 2) as porcentaje
            from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
           where (e->>'porcentaje')::numeric > 0) x
  on conflict (version_id, insumo_id) do update
     set porcentaje = excluded.porcentaje, actualizado_por = excluded.actualizado_por, actualizado_at = excluded.actualizado_at
   where presupuesto_desperdicios.porcentaje is distinct from excluded.porcentaje;
  select count(*) into v_n from public.presupuesto_desperdicios where version_id = p_version_id;

  if v_apus is not null then
    with lineas as (
      select ia.id, coalesce(d.porcentaje, 0) as pct
        from public.item_apu ia
        left join public.presupuesto_desperdicios d on d.version_id = p_version_id and d.insumo_id = ia.insumo_id
       where ia.apu_id = any(v_apus) and ia.insumo_id is not null
    )
    update public.item_apu ia set desperdicio_pct = l.pct
      from lineas l
     where ia.id = l.id and ia.desperdicio_pct is distinct from l.pct;
    get diagnostics v_lineas = row_count;
    perform public.recalcular_valor_apus(v_apus);
  else
    v_lineas := 0;
  end if;

  select coalesce(sum(valor_total), 0) into v_despues
    from public.presupuesto_items where version_id = p_version_id and apu_id is not null;
  perform public._anotar_historial('presupuesto', v_presupuesto, 'desperdicio',
    jsonb_build_object('version_id', p_version_id, 'insumos', v_n, 'lineas', v_lineas,
                       'valor_antes', v_antes, 'valor_despues', v_despues));

  return jsonb_build_object('insumos', v_n, 'lineas', v_lineas, 'valor_antes', v_antes, 'valor_despues', v_despues);
end;
$$;
revoke all on function public.fijar_desperdicio_presupuesto(uuid, jsonb) from public, anon;
grant execute on function public.fijar_desperdicio_presupuesto(uuid, jsonb) to authenticated;

commit;
