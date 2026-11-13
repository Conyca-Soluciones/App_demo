-- Desperdicio por línea del Excel, también las pendientes (decisión del
-- usuario, 2026-11-13; cambia 20270101003500).
--
-- El desperdicio es de la CANTIDAD, no del insumo del maestro: en el diálogo
-- salen TODAS las líneas de insumo del APU, agrupadas por su texto del Excel
-- ("Concreto 4000 Psi (Basico, 5% desperdicio)", "Mortero 1:4"...), estén
-- aprobadas o esperando aprobación. Se pone el % general y se desmarcan (o se
-- les da otro %) las que no lo llevan. Ya no hay exclusión automática: quien
-- arma el presupuesto decide (el diálogo propone desmarcadas las que dicen
-- "desperdicio" la primera vez).
--
-- - item_apu.desperdicio_clave: el texto de la línea (normalizado con
--   _clave_actividad): el del Excel si la línea vino del import, si no el
--   nombre del insumo del maestro. Lo pone el disparador de item_apu y, cuando
--   una línea pendiente se aprueba y se enlaza con su revisión, el de
--   apu_import_revision (con el texto del Excel). crear_nueva_version lo copia.
-- - presupuesto_desperdicios pasa a (versión, clave, %): excepciones por texto.
-- - % de una línea = excepción de su clave o, si no hay, el general.
-- - Las líneas pendientes toman su % solas al aprobarse.
--
-- No había desperdicios guardados al escribir esto: la tabla se rehace.
-- Todo en una transacción. Se puede correr más de una vez.

begin;

-- 0. crear_nueva_version: copia la clave de cada línea y las excepciones por
--    clave (primero: si su texto no es el esperado, no cambia nada)
do $$
declare
  d text := pg_get_functiondef('public.crear_nueva_version'::regproc);
  a1 text := E'factor_unidad, no_aplica, cantidad_base, desperdicio_pct)\n';
  b1 text := E'factor_unidad, no_aplica, cantidad_base, desperdicio_pct, desperdicio_clave)\n';
  a2 text := E'ia.no_aplica, ia.cantidad_base, ia.desperdicio_pct\n';
  b2 text := E'ia.no_aplica, ia.cantidad_base, ia.desperdicio_pct, ia.desperdicio_clave\n';
  a3 text := E'  insert into presupuesto_desperdicios (version_id, insumo_id, porcentaje, actualizado_por, actualizado_at)\n'
          || E'  select v_nueva.id, d.insumo_id, d.porcentaje, d.actualizado_por, d.actualizado_at\n';
  b3 text := E'  insert into presupuesto_desperdicios (version_id, clave, porcentaje, actualizado_por, actualizado_at)\n'
          || E'  select v_nueva.id, d.clave, d.porcentaje, d.actualizado_por, d.actualizado_at\n';
begin
  d := replace(d, E'\r\n', E'\n');
  if position('ia.desperdicio_clave' in d) > 0 then
    return;
  end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 or position(a3 in d) = 0 then
    raise exception 'crear_nueva_version no tiene el texto esperado.';
  end if;
  execute replace(replace(replace(d, a1, b1), a2, b2), a3, b3);
end $$;

-- 1. Excepciones por clave ------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'presupuesto_desperdicios' and column_name = 'insumo_id') then
    drop table public.presupuesto_desperdicios;
  end if;
end $$;

create table if not exists public.presupuesto_desperdicios (
  version_id uuid not null references public.presupuesto_versiones(id) on delete cascade,
  clave text not null,
  porcentaje numeric(6,2) not null check (porcentaje >= 0 and porcentaje <= 100),
  actualizado_por uuid references public.perfiles(id),
  actualizado_at timestamptz not null default now(),
  primary key (version_id, clave)
);
alter table public.presupuesto_desperdicios enable row level security;

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

-- 2. Clave de cada línea ----------------------------------------------------------
alter table public.item_apu add column if not exists desperdicio_clave text;

-- % de una línea: la excepción de su clave en su versión, o el general.
drop function if exists public._desperdicio_de_linea(uuid, uuid, uuid);
create or replace function public._desperdicio_de_linea(p_apu_id uuid, p_clave text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select coalesce(d.porcentaje, v.desperdicio_pct)
      from public.presupuesto_items pi
      join public.presupuesto_versiones v on v.id = pi.version_id
      left join public.presupuesto_desperdicios d on d.version_id = pi.version_id and d.clave = p_clave
     where pi.apu_id = p_apu_id
     limit 1), 0)
$$;
revoke all on function public._desperdicio_de_linea(uuid, text) from public, anon, authenticated;

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
  if new.insumo_id is not null and new.desperdicio_clave is null then
    select public._clave_actividad(mi.descripcion) into new.desperdicio_clave
      from public.maestro_insumos mi where mi.id = new.insumo_id;
  end if;

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
    if new.apu_id is distinct from old.apu_id
       or (new.desperdicio_clave is distinct from old.desperdicio_clave
           and new.desperdicio_pct is not distinct from old.desperdicio_pct) then
      v_pct := public._desperdicio_de_linea(new.apu_id, new.desperdicio_clave);
    end if;
  else
    v_base := coalesce(new.cantidad_base, new.cantidad);
    if new.cantidad_base is not null then
      v_pct := new.desperdicio_pct; -- copia de otra línea (versión nueva)
    else
      v_pct := public._desperdicio_de_linea(new.apu_id, new.desperdicio_clave);
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
    select ia.id, public._desperdicio_de_linea(ia.apu_id, ia.desperdicio_clave) as pct
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

-- Al enlazarse una revisión del import con su línea: la clave pasa a ser el
-- texto del Excel y la línea toma el % de esa clave.
create or replace function public._revision_desperdicio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clave text := public._clave_actividad(new.descripcion_original);
begin
  update public.item_apu ia
     set desperdicio_clave = v_clave,
         desperdicio_pct = public._desperdicio_de_linea(ia.apu_id, v_clave)
   where ia.id = new.item_apu_id and ia.insumo_id is not null
     and (ia.desperdicio_clave is distinct from v_clave
          or ia.desperdicio_pct is distinct from public._desperdicio_de_linea(ia.apu_id, v_clave));
  return null;
end;
$$;
revoke all on function public._revision_desperdicio() from public, anon, authenticated;

drop trigger if exists trg_revision_desperdicio on public.apu_import_revision;
create trigger trg_revision_desperdicio
  after insert or update of item_apu_id on public.apu_import_revision
  for each row
  when (new.item_apu_id is not null)
  execute function public._revision_desperdicio();

-- Clave de las líneas que ya existen: texto del Excel o nombre del insumo.
update public.item_apu ia
   set desperdicio_clave = public._clave_actividad(coalesce(
         (select r.descripcion_original from public.apu_import_revision r where r.item_apu_id = ia.id order by r.created_at limit 1),
         (select mi.descripcion from public.maestro_insumos mi where mi.id = ia.insumo_id)))
 where ia.insumo_id is not null and ia.desperdicio_clave is null;

-- 3. Para el diálogo: líneas de insumo por texto, aprobadas y pendientes ------------
create or replace function public.insumos_para_desperdicio(p_version_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with items as (
    select pi.id, pi.apu_id, coalesce(pi.cantidad, 0) as cant
      from public.presupuesto_items pi
     where pi.version_id = p_version_id
  ),
  -- líneas ya en el APU
  aprobadas as (
    select ia.desperdicio_clave as clave,
           coalesce((select r.descripcion_original from public.apu_import_revision r where r.item_apu_id = ia.id limit 1),
                    mi.descripcion) as descripcion,
           coalesce(ia.unidad, mi.u_m) as unidad, it.id as item_id,
           coalesce(ia.cantidad_base, ia.cantidad) * it.cant as cantidad,
           coalesce(ia.cantidad_base, ia.cantidad) * coalesce(ia.rendimiento, 1) * it.cant
             * coalesce(ia.precio_unitario_congelado, coalesce(mi.vr_neto, mi.vr_unitario, 0) / nullif(coalesce(ia.factor_unidad, 1), 0), 0) as valor,
           false as pendiente
      from items it
      join public.item_apu ia on ia.apu_id = it.apu_id
      join public.maestro_insumos mi on mi.id = ia.insumo_id
  ),
  -- líneas de insumo del Excel que todavía esperan (sin línea en el APU)
  pendientes as (
    select public._clave_actividad(r.descripcion_original) as clave, r.descripcion_original as descripcion,
           r.unidad, it.id as item_id, r.cantidad * it.cant as cantidad, null::numeric as valor, true as pendiente
      from items it
      join public.apu_import_revision r on r.presupuesto_item_id = it.id
     where r.tipo = 'INSUMO' and r.item_apu_id is null
       and r.estado in ('pendiente', 'solicitud_pendiente', 'rechazado')
  ),
  todas as (select * from aprobadas union all select * from pendientes),
  por_clave as (
    select t.clave, min(t.descripcion) as descripcion, min(t.unidad) as unidad,
           count(distinct t.item_id) as n_items, count(*) as lineas,
           count(*) filter (where t.pendiente) as lineas_pendientes,
           sum(t.cantidad) as cantidad_base,
           coalesce(sum(t.valor), 0) as valor_base
      from todas t
     where t.clave is not null and t.clave <> ''
     group by t.clave
  )
  select jsonb_build_object(
    'general', (select v.desperdicio_pct from public.presupuesto_versiones v where v.id = p_version_id),
    'configurado', (select v.desperdicio_pct > 0 from public.presupuesto_versiones v where v.id = p_version_id)
                   or exists (select 1 from public.presupuesto_desperdicios d where d.version_id = p_version_id),
    'insumos', coalesce(jsonb_agg(jsonb_build_object(
      'clave', p.clave, 'descripcion', p.descripcion, 'unidad', p.unidad,
      'n_items', p.n_items, 'lineas', p.lineas, 'lineas_pendientes', p.lineas_pendientes,
      'cantidad_base', round(p.cantidad_base, 4), 'valor_base', round(p.valor_base, 2),
      'dice_desperdicio', p.descripcion ilike '%desperdicio%',
      'excepcion', d.porcentaje)
      order by p.valor_base desc, p.descripcion), '[]'::jsonb))
    from por_clave p
    left join public.presupuesto_desperdicios d on d.version_id = p_version_id and d.clave = p.clave
$$;
revoke all on function public.insumos_para_desperdicio(uuid) from public, anon;
grant execute on function public.insumos_para_desperdicio(uuid) to authenticated;

-- 4. Guardar: % general + excepciones por clave ------------------------------------
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
              where nullif(trim(e->>'clave'), '') is null
                 or (e->>'porcentaje') is null
                 or (e->>'porcentaje')::numeric < 0 or (e->>'porcentaje')::numeric > 100) then
    raise exception 'Cada excepción debe tener la línea y un %% entre 0 y 100.';
  end if;

  select array_agg(distinct pi.apu_id) into v_apus
    from public.presupuesto_items pi
   where pi.version_id = p_version_id and pi.apu_id is not null;
  select coalesce(sum(valor_total), 0) into v_antes
    from public.presupuesto_items where version_id = p_version_id and apu_id is not null;

  update public.presupuesto_versiones set desperdicio_pct = round(p_general, 2) where id = p_version_id;
  delete from public.presupuesto_desperdicios where version_id = p_version_id;
  insert into public.presupuesto_desperdicios (version_id, clave, porcentaje, actualizado_por, actualizado_at)
  select distinct on (public._clave_actividad(e->>'clave'))
         p_version_id, public._clave_actividad(e->>'clave'), round((e->>'porcentaje')::numeric, 2), v_uid, now()
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
