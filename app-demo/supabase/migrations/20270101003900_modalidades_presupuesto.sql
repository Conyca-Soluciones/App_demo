-- Modalidad de ejecución de cada ítem del presupuesto (decisión del usuario,
-- 2026-11-16). Cada ítem hoja se hace de una de tres formas:
--
--   * todo_costo     Subcontrato a todo costo. Valor del ítem = % del proyecto
--                    (proyectos.tope_todo_costo_pct; Malecón 42 %) × precio
--                    oficial. Del APU no se resuelve nada. Tope del contrato de
--                    obra = ese valor.
--   * mano_obra      Subcontrato de mano de obra.
--                    - Sin insumos en el APU (el equipo NO cuenta como
--                      material): mano de obra = 50 % × (mano de obra oficial +
--                      herramienta menor del ítem, 5 % o 10 %). El equipo y el
--                      transporte siguen como hoy.
--                    - Con insumos: todo como hoy (insumos de la maestra, mano
--                      de obra del catálogo + herramienta menor).
--                    Tope del contrato de mano de obra = la mano de obra del
--                    ítem. Los insumos van por Compras, no por contrato.
--   * administracion Insumos de la maestra; mano de obra = 100 % × (mano de obra
--                    oficial + herramienta menor del ítem): ya se paga un
--                    sueldo. Equipo y transporte como hoy. Sin contrato de obra
--                    ni de mano de obra.
--   * null           Sin modalidad: como antes de esta migración.
--
-- Cómo se guarda:
--   - El valor que no sale del catálogo es una LÍNEA DE VALOR FIJO del APU
--     (item_apu.concepto_fijo + valor_fijo): así el valor del ítem, el tope del
--     contrato, el cupo de requisiciones y Control del proyecto lo suman sin
--     preguntar por la modalidad.
--   - Lo que la modalidad deja de usar NO se borra: sus líneas del APU y de la
--     revisión del import pasan a un APU guardado del ítem
--     (presupuesto_items.apu_guardado_id), que no cuenta en nada. Las líneas de
--     revisión que estaban pendientes quedan 'no_requerido' (salen de Revisar
--     pendientes). Si el ítem cambia otra vez de modalidad, todo vuelve.
--   - Las solicitudes pendientes (insumo, mano de obra, equipo) que SOLO
--     servían a líneas que quedaron 'no_requerido' se borran. Las que también
--     sirven a otros ítems siguen; aprobarlas o rechazarlas ya no toca las
--     líneas 'no_requerido'.
--   - Un ítem con requisiciones o contratos (por código, en cualquier versión)
--     no cambia de modalidad.
--
-- fijar_modalidades_presupuesto(versión, filas, confirmar) aplica una lista
-- [{codigo, modalidad, mano_obra_oficial, herramienta_menor_pct}] sobre la
-- versión vigente; con confirmar = false solo devuelve el resumen (cuántos
-- ítems cambian, líneas guardadas, solicitudes cerradas, valor antes/después)
-- o los errores, sin cambiar nada.
--
-- Solo agrega; las funciones vivas se parchan por texto exacto. Va ANTES del
-- código que lee concepto_fijo. Reversa en supabase/reversa/.

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

-- 1. Columnas ---------------------------------------------------------------

alter table public.proyectos add column if not exists tope_todo_costo_pct numeric(5,2);
alter table public.proyectos drop constraint if exists proyectos_tope_todo_costo_pct_check;
alter table public.proyectos add constraint proyectos_tope_todo_costo_pct_check
  check (tope_todo_costo_pct is null or (tope_todo_costo_pct > 0 and tope_todo_costo_pct <= 100));
comment on column public.proyectos.tope_todo_costo_pct is
  'Subcontrato a todo costo: % del precio oficial del ítem que vale el ítem y es el tope del contrato de obra.';

alter table public.presupuesto_items add column if not exists modalidad text;
alter table public.presupuesto_items add column if not exists mano_obra_oficial numeric(18,2);
alter table public.presupuesto_items add column if not exists herramienta_menor_pct numeric(6,3);
alter table public.presupuesto_items add column if not exists apu_guardado_id uuid references public.apu(id) on delete set null;
alter table public.presupuesto_items drop constraint if exists presupuesto_items_modalidad_check;
alter table public.presupuesto_items add constraint presupuesto_items_modalidad_check
  check (modalidad is null or modalidad in ('administracion', 'todo_costo', 'mano_obra'));
alter table public.presupuesto_items drop constraint if exists presupuesto_items_mano_obra_oficial_check;
alter table public.presupuesto_items add constraint presupuesto_items_mano_obra_oficial_check
  check (mano_obra_oficial is null or mano_obra_oficial >= 0);
alter table public.presupuesto_items drop constraint if exists presupuesto_items_herramienta_menor_pct_check;
alter table public.presupuesto_items add constraint presupuesto_items_herramienta_menor_pct_check
  check (herramienta_menor_pct is null or (herramienta_menor_pct >= 0 and herramienta_menor_pct <= 100));
create index if not exists idx_presupuesto_items_apu_guardado
  on public.presupuesto_items (apu_guardado_id) where apu_guardado_id is not null;
comment on column public.presupuesto_items.modalidad is
  'administracion | todo_costo | mano_obra; null = como antes de las modalidades.';
comment on column public.presupuesto_items.mano_obra_oficial is
  'Valor unitario oficial de la mano de obra del ítem, SIN herramienta menor.';
comment on column public.presupuesto_items.herramienta_menor_pct is
  'Herramienta menor del ítem en el oficial (% de la mano de obra); null = la del APU.';
comment on column public.presupuesto_items.apu_guardado_id is
  'APU con las líneas que la modalidad dejó de usar; vuelven si cambia la modalidad.';

alter table public.item_apu add column if not exists concepto_fijo text;
alter table public.item_apu add column if not exists valor_fijo numeric(18,2);
alter table public.item_apu drop constraint if exists item_apu_concepto_fijo_check;
alter table public.item_apu add constraint item_apu_concepto_fijo_check
  check ((concepto_fijo is null and valor_fijo is null)
      or (concepto_fijo in ('todo_costo', 'mano_obra_subcontrato', 'mano_obra_administracion') and valor_fijo >= 0));
alter table public.item_apu drop constraint if exists item_apu_recurso_unico_check;
alter table public.item_apu add constraint item_apu_recurso_unico_check
  check (num_nonnulls(insumo_id, mano_obra_categoria_id, porcentaje_mano_obra, equipo_categoria_id, transporte_precio_id)
         = case when no_aplica is null and concepto_fijo is null then 1 else 0 end);
comment on column public.item_apu.concepto_fijo is
  'Línea de valor fijo por modalidad: todo_costo | mano_obra_subcontrato | mano_obra_administracion. Vale valor_fijo por unidad del ítem.';

alter table public.apu_import_revision drop constraint if exists apu_import_revision_estado_check;
alter table public.apu_import_revision add constraint apu_import_revision_estado_check
  check (estado in ('auto_match', 'pendiente', 'solicitud_pendiente', 'resuelto', 'rechazado', 'no_requerido'));

-- 2. Lo que suma el APU: la línea fija ----------------------------------------

-- Valor del ítem
select pg_temp._parche('public.recalcular_valor_apus(uuid[])',
  'coalesce(sum(moc.valor_unitario), 0), 0),',
  'coalesce(sum(moc.valor_unitario), 0), 0)
        + coalesce(sum(ia.valor_fijo), 0),');

-- Mano de obra del ítem (tope del contrato de mano de obra)
select pg_temp._parche('public._valor_mano_obra_item(uuid)',
  '(1 + coalesce(sum(ia.porcentaje_mano_obra / 100.0), 0)), 2)',
  '(1 + coalesce(sum(ia.porcentaje_mano_obra / 100.0), 0))
             + coalesce(sum(ia.valor_fijo) filter (where ia.concepto_fijo in (''mano_obra_subcontrato'', ''mano_obra_administracion'')), 0), 2)');
select pg_temp._parche('public.items_presupuesto_para_contrato(uuid)',
  '(1 + coalesce(sum(ia.porcentaje_mano_obra / 100.0), 0)), 2)',
  '(1 + coalesce(sum(ia.porcentaje_mano_obra / 100.0), 0))
             + coalesce(sum(ia.valor_fijo) filter (where ia.concepto_fijo in (''mano_obra_subcontrato'', ''mano_obra_administracion'')), 0), 2)');

-- Control del proyecto: presupuesto de mano de obra
select pg_temp._parche('public.control_proyecto(uuid)',
  'moc.valor_unitario as valor_mo',
  'coalesce(moc.valor_unitario, case when ia.concepto_fijo in (''mano_obra_subcontrato'', ''mano_obra_administracion'') then ia.valor_fijo end) as valor_mo');

-- 3. Aprobar o rechazar una solicitud no toca las líneas 'no_requerido' --------

select pg_temp._parche('public.sincronizar_apu_import_revision()',
  'r.item_apu_id is null', 'r.item_apu_id is null and r.estado <> ''no_requerido''');
select pg_temp._parche('public.sincronizar_apu_import_revision()',
  'where solicitud_id = new.id;', 'where solicitud_id = new.id and estado <> ''no_requerido'';');
select pg_temp._parche('public.sincronizar_apu_import_revision_mano_obra()',
  'r.item_apu_id is null', 'r.item_apu_id is null and r.estado <> ''no_requerido''');
select pg_temp._parche('public.sincronizar_apu_import_revision_mano_obra()',
  'where solicitud_mano_obra_id = new.id;', 'where solicitud_mano_obra_id = new.id and estado <> ''no_requerido'';');
select pg_temp._parche('public.sincronizar_apu_import_revision_equipo()',
  'r.item_apu_id is null', 'r.item_apu_id is null and r.estado <> ''no_requerido''');
select pg_temp._parche('public.sincronizar_apu_import_revision_equipo()',
  'where solicitud_equipo_id = new.id;', 'where solicitud_equipo_id = new.id and estado <> ''no_requerido'';');

-- 4. Borrar un ítem borra también su APU guardado ------------------------------

select pg_temp._parche('public.eliminar_apu_huerfano()',
  '  return old;',
  '  if old.apu_guardado_id is not null and not exists (
      select 1 from public.presupuesto_items
       where (apu_id = old.apu_guardado_id or apu_guardado_id = old.apu_guardado_id) and id <> old.id
    ) then
    delete from public.apu where id = old.apu_guardado_id;
  end if;
  return old;');

-- 5. Versión nueva: copia la modalidad, los valores oficiales, la línea fija y
--    el APU guardado ------------------------------------------------------------

select pg_temp._parche('public.crear_nueva_version(uuid,text)',
  'where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual and pi.apu_id is not null) x;',
  'where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual and pi.apu_id is not null
          union
          select pi.apu_guardado_id from presupuesto_items pi
           where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual and pi.apu_guardado_id is not null) x;');
select pg_temp._parche('public.crear_nueva_version(uuid,text)',
  'no_aplica, cantidad_base, desperdicio_pct, desperdicio_clave)',
  'no_aplica, cantidad_base, desperdicio_pct, desperdicio_clave, concepto_fijo, valor_fijo)');
select pg_temp._parche('public.crear_nueva_version(uuid,text)',
  'ia.desperdicio_pct, ia.desperdicio_clave
    from item_apu ia',
  'ia.desperdicio_pct, ia.desperdicio_clave, ia.concepto_fijo, ia.valor_fijo
    from item_apu ia');
select pg_temp._parche('public.crear_nueva_version(uuid,text)',
  'apu_id, precio_original, lineas_apu_oficial)',
  'apu_id, precio_original, lineas_apu_oficial,
                                 modalidad, mano_obra_oficial, herramienta_menor_pct, apu_guardado_id)');
select pg_temp._parche('public.crear_nueva_version(uuid,text)',
  '(v_apus->>pi.apu_id::text)::uuid, pi.precio_original, pi.lineas_apu_oficial',
  '(v_apus->>pi.apu_id::text)::uuid, pi.precio_original, pi.lineas_apu_oficial,
         pi.modalidad, pi.mano_obra_oficial, pi.herramienta_menor_pct, (v_apus->>pi.apu_guardado_id::text)::uuid');

-- 6. Contratos: qué tipo de contrato acepta cada modalidad ----------------------

create or replace function public._motivo_item_no_listo(p_presupuesto_item_id uuid, p_tipo text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when m.modalidad = 'todo_costo' and p_tipo = 'mano_obra'
      then 'es subcontrato a todo costo: va en un contrato de obra'
    when m.modalidad = 'mano_obra' and p_tipo = 'obra'
      then 'es subcontrato de mano de obra: va en un contrato de mano de obra'
    when m.modalidad = 'administracion' and p_tipo in ('obra', 'mano_obra')
      then 'se ejecuta por administración: no lleva contrato de obra ni de mano de obra'
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
  from (select (select pi.modalidad from public.presupuesto_items pi where pi.id = p_presupuesto_item_id) as modalidad) m
$$;
revoke all on function public._motivo_item_no_listo(uuid, text) from public, anon, authenticated;

-- 7. Aplicar la modalidad a un ítem --------------------------------------------

-- Lo que hace falta saber de un ítem para validar su modalidad (mira el APU
-- vivo, el guardado y la revisión del import).
create or replace function public._info_modalidad_item(p_item uuid)
returns table(tiene_mano_obra boolean, con_insumos boolean, con_movimientos boolean, es_hoja boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from apu_import_revision r where r.presupuesto_item_id = pi.id and r.tipo = 'MO')
      or exists (select 1 from item_apu ia
                  where ia.apu_id in (pi.apu_id, pi.apu_guardado_id)
                    and (ia.mano_obra_categoria_id is not null
                         or ia.concepto_fijo in ('mano_obra_subcontrato', 'mano_obra_administracion'))),
    exists (select 1 from apu_import_revision r where r.presupuesto_item_id = pi.id and r.tipo = 'INSUMO')
      or exists (select 1 from item_apu ia
                  where ia.apu_id in (pi.apu_id, pi.apu_guardado_id)
                    and (ia.insumo_id is not null or ia.no_aplica is not null)),
    exists (select 1 from pedidos_insumos pe
              join presupuesto_items p2 on p2.id = pe.presupuesto_item_id
             where p2.presupuesto_id = pi.presupuesto_id and p2.codigo = pi.codigo
               and pe.estado in ('pendiente', 'aprobado'))
      or exists (select 1 from contrato_anexo_items ai
                   join contratos c on c.id = ai.contrato_id
                   join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
                  where p2.presupuesto_id = pi.presupuesto_id and p2.codigo = pi.codigo
                    and c.estado <> 'rechazada'),
    not exists (select 1 from presupuesto_items h where h.padre_id = pi.id)
  from presupuesto_items pi
  where pi.id = p_item
$$;
revoke all on function public._info_modalidad_item(uuid) from public, anon, authenticated;

-- Deja el ítem en la modalidad pedida: primero devuelve al APU vivo todo lo
-- guardado (y quita la línea fija), después guarda lo que la modalidad nueva
-- no usa y pone su línea fija. Devuelve cuántas líneas se guardaron, cuántas
-- líneas de revisión quedaron 'no_requerido' y cuántas solicitudes se borraron.
-- No revisa permisos ni movimientos: lo hace quien la llama.
create or replace function public._aplicar_modalidad_item(p_item uuid, p_modalidad text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_apu uuid;
  v_guardado uuid;
  v_hm numeric;
  v_tiene_mo boolean;
  v_con_insumos boolean;
  v_concepto text;
  v_valor numeric;
  v_todo boolean := false;   -- guardar todas las líneas (todo costo)
  v_mo boolean := false;     -- guardar mano de obra y herramienta menor
  v_lineas integer := 0;
  v_revisiones integer := 0;
  v_solicitudes integer := 0;
  v_n integer;
begin
  if p_modalidad is not null and p_modalidad not in ('administracion', 'todo_costo', 'mano_obra') then
    raise exception 'Modalidad desconocida: %.', p_modalidad;
  end if;

  select pi.id, pi.codigo, pi.descripcion, pi.unidad, pi.cantidad, pi.apu_id, pi.apu_guardado_id,
         pi.precio_original, pi.mano_obra_oficial, pi.herramienta_menor_pct, pi.presupuesto_id,
         pr.tope_todo_costo_pct
    into v
    from presupuesto_items pi
    join presupuestos p on p.id = pi.presupuesto_id
    left join proyectos pr on pr.id = p.proyecto_id
   where pi.id = p_item
     for update of pi;
  if not found then
    raise exception 'El ítem no existe.';
  end if;
  v_apu := v.apu_id;
  v_guardado := v.apu_guardado_id;

  -- Herramienta menor del ítem: la del oficial o, si no se dio, la del APU.
  v_hm := coalesce(v.herramienta_menor_pct,
                   (select sum(ia.porcentaje_mano_obra) from item_apu ia
                     where ia.apu_id in (v_apu, v_guardado) and ia.porcentaje_mano_obra is not null),
                   0);

  -- 1. Volver al estado sin modalidad
  if v_apu is not null then
    if v_guardado is not null then
      update item_apu set apu_id = v_apu where apu_id = v_guardado;
      update apu_import_revision set apu_id = v_apu where apu_id = v_guardado;
    end if;
    delete from item_apu where apu_id = v_apu and concepto_fijo is not null;
    update apu_import_revision r
       set estado = case
             when exists (select 1 from solicitudes_insumos s where s.id = r.solicitud_id and s.estado = 'pendiente')
               or exists (select 1 from solicitudes_mano_obra s where s.id = r.solicitud_mano_obra_id and s.estado = 'pendiente')
               or exists (select 1 from solicitudes_equipo s where s.id = r.solicitud_equipo_id and s.estado = 'pendiente')
             then 'solicitud_pendiente' else 'pendiente' end
     where r.presupuesto_item_id = p_item and r.estado = 'no_requerido';
  end if;

  select i.tiene_mano_obra, i.con_insumos into v_tiene_mo, v_con_insumos
    from public._info_modalidad_item(p_item) i;

  -- 2. Qué se guarda y cuánto vale la línea fija
  if p_modalidad = 'todo_costo' then
    if v.tope_todo_costo_pct is null then
      raise exception 'El proyecto no tiene el %% de subcontrato a todo costo.';
    end if;
    if coalesce(v.precio_original, 0) <= 0 then
      raise exception 'El ítem % no tiene precio oficial.', v.codigo;
    end if;
    v_todo := true;
    v_concepto := 'todo_costo';
    v_valor := round(v.precio_original * v.tope_todo_costo_pct / 100, 2);
  elsif p_modalidad = 'mano_obra' then
    if not v_tiene_mo then
      raise exception 'El ítem % no tiene mano de obra: no puede ser subcontrato de mano de obra.', v.codigo;
    end if;
    if not v_con_insumos then
      if coalesce(v.mano_obra_oficial, 0) <= 0 then
        raise exception 'Falta la mano de obra oficial del ítem %.', v.codigo;
      end if;
      v_mo := true;
      v_concepto := 'mano_obra_subcontrato';
      v_valor := round(0.5 * v.mano_obra_oficial * (1 + v_hm / 100), 2);
    end if;
  elsif p_modalidad = 'administracion' then
    if v_tiene_mo then
      if coalesce(v.mano_obra_oficial, 0) <= 0 then
        raise exception 'Falta la mano de obra oficial del ítem %.', v.codigo;
      end if;
      v_mo := true;
      v_concepto := 'mano_obra_administracion';
      v_valor := round(v.mano_obra_oficial * (1 + v_hm / 100), 2);
    end if;
  end if;

  if v_concepto is not null and v_apu is null then
    insert into apu (codigo, descripcion, presupuesto_id)
    values (v.codigo, v.descripcion, v.presupuesto_id)
    returning id into v_apu;
    update presupuesto_items set apu_id = v_apu where id = p_item;
  end if;

  -- 3. Guardar lo que la modalidad no usa
  if v_todo or v_mo then
    if v_guardado is null then
      insert into apu (codigo, descripcion, presupuesto_id)
      values (v.codigo, 'Guardado por modalidad: ' || coalesce(v.descripcion, ''), v.presupuesto_id)
      returning id into v_guardado;
      update presupuesto_items set apu_guardado_id = v_guardado where id = p_item;
    end if;

    update item_apu ia
       set apu_id = v_guardado
     where ia.apu_id = v_apu
       and (v_todo or ia.mano_obra_categoria_id is not null or ia.porcentaje_mano_obra is not null);
    get diagnostics v_lineas = row_count;

    update apu_import_revision r
       set apu_id = v_guardado,
           estado = case when r.estado in ('pendiente', 'solicitud_pendiente', 'rechazado')
                         then 'no_requerido' else r.estado end
     where r.presupuesto_item_id = p_item
       and (v_todo
            or r.tipo = 'MO'
            or (r.tipo = 'EQUIPO' and r.descripcion_original ilike 'herramienta menor%')
            or r.item_apu_id in (select ia.id from item_apu ia
                                  where ia.apu_id = v_guardado
                                    and (ia.mano_obra_categoria_id is not null or ia.porcentaje_mano_obra is not null)));
    select count(*) into v_revisiones
      from apu_import_revision r where r.presupuesto_item_id = p_item and r.estado = 'no_requerido';

    -- Solicitudes pendientes que ya no sirven a ninguna línea
    with s as (
      select distinct r.solicitud_id as id from apu_import_revision r
       where r.presupuesto_item_id = p_item and r.estado = 'no_requerido' and r.solicitud_id is not null
    )
    delete from solicitudes_insumos x using s
     where x.id = s.id and x.estado = 'pendiente'
       and not exists (select 1 from apu_import_revision r2 where r2.solicitud_id = x.id and r2.estado <> 'no_requerido');
    get diagnostics v_n = row_count;
    v_solicitudes := v_solicitudes + v_n;

    with s as (
      select distinct r.solicitud_mano_obra_id as id from apu_import_revision r
       where r.presupuesto_item_id = p_item and r.estado = 'no_requerido' and r.solicitud_mano_obra_id is not null
    )
    delete from solicitudes_mano_obra x using s
     where x.id = s.id and x.estado = 'pendiente'
       and not exists (select 1 from apu_import_revision r2 where r2.solicitud_mano_obra_id = x.id and r2.estado <> 'no_requerido');
    get diagnostics v_n = row_count;
    v_solicitudes := v_solicitudes + v_n;

    with s as (
      select distinct r.solicitud_equipo_id as id from apu_import_revision r
       where r.presupuesto_item_id = p_item and r.estado = 'no_requerido' and r.solicitud_equipo_id is not null
    )
    delete from solicitudes_equipo x using s
     where x.id = s.id and x.estado = 'pendiente'
       and not exists (select 1 from apu_import_revision r2 where r2.solicitud_equipo_id = x.id and r2.estado <> 'no_requerido');
    get diagnostics v_n = row_count;
    v_solicitudes := v_solicitudes + v_n;
  end if;

  -- 4. Línea fija
  if v_concepto is not null then
    insert into item_apu (apu_id, concepto_fijo, valor_fijo, cantidad, rendimiento, factor_unidad, tipo)
    values (v_apu, v_concepto, v_valor, 1, 1, 1, case when v_concepto = 'todo_costo' then null else 'MO' end);
  end if;

  update presupuesto_items set modalidad = p_modalidad where id = p_item;

  -- 5. Valor del ítem. Un ítem global (GL, sin APU propio) que vuelve a no
  --    tener nada en su APU recupera su valor oficial, como al importarlo.
  if v_apu is not null then
    if upper(trim(coalesce(v.unidad, ''))) in ('GL', 'GLB', 'GLOBAL')
       and not exists (select 1 from item_apu where apu_id = v_apu)
       and not exists (select 1 from apu_import_revision where apu_id = v_apu)
       and not exists (select 1 from item_apu where apu_id = v_guardado)
       and v.precio_original is not null then
      update presupuesto_items
         set apu_id = null, apu_guardado_id = null, valor_unitario = v.precio_original,
             valor_total = case when cantidad is not null then round(v.precio_original * cantidad, 2) end
       where id = p_item;
      delete from apu where id in (v_apu, v_guardado);
    else
      perform public.recalcular_valor_apus(array[v_apu]);
    end if;
  end if;

  return jsonb_build_object('lineas', v_lineas, 'revisiones', v_revisiones, 'solicitudes', v_solicitudes);
end;
$$;
revoke all on function public._aplicar_modalidad_item(uuid, text) from public, anon, authenticated;

-- 8. Aplicar una lista de modalidades a la versión vigente ---------------------
--
-- p_filas: [{codigo, modalidad, mano_obra_oficial?, herramienta_menor_pct?}]
--   modalidad: 'administracion' | 'todo_costo' | 'mano_obra' | null (quitar).
--   mano_obra_oficial / herramienta_menor_pct: si vienen, se guardan en el ítem.
-- Los ítems que no vienen en la lista no cambian. Si alguna fila tiene error no
-- se aplica nada y se devuelven los errores. Con p_confirmar = false solo
-- devuelve el resumen.
create or replace function public.fijar_modalidades_presupuesto(p_version_id uuid, p_filas jsonb, p_confirmar boolean default false)
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
  v_tope numeric;
  v_errores jsonb := '[]'::jsonb;
  v_f record;
  v_info record;
  v_cambios jsonb := '[]'::jsonb;
  v_res jsonb;
  v_lineas integer := 0;
  v_revisiones integer := 0;
  v_solicitudes integer := 0;
  v_antes numeric;
  v_despues numeric;
  v_por_modalidad jsonb;
  v_n integer := 0;
begin
  if v_uid is null or not public.tiene_accion(v_uid, 'editar_presupuestos') then
    raise exception 'No tienes permiso para editar presupuestos.';
  end if;
  select p.id, p.proyecto_id, p.version_actual_id, pr.tope_todo_costo_pct
    into v_presupuesto, v_proyecto, v_actual, v_tope
    from public.presupuesto_versiones v
    join public.presupuestos p on p.id = v.presupuesto_id
    left join public.proyectos pr on pr.id = p.proyecto_id
   where v.id = p_version_id
     for update of p;
  if not found or v_proyecto is null or not public.usuario_puede_ver_proyecto(v_uid, v_proyecto) then
    raise exception 'El presupuesto no existe o no tienes acceso.';
  end if;
  if v_actual is distinct from p_version_id then
    raise exception 'Solo se cambia la modalidad en la versión vigente.';
  end if;
  if jsonb_typeof(coalesce(p_filas, '[]'::jsonb)) <> 'array' then
    raise exception 'Lista de modalidades inválida.';
  end if;
  if jsonb_array_length(p_filas) > 5000 then
    raise exception 'Máximo 5.000 ítems por vez.';
  end if;

  -- 1. Validar todo antes de cambiar nada
  for v_f in
    with filas as (
      select e.ord,
             nullif(trim(e.val->>'codigo'), '') as codigo,
             nullif(trim(e.val->>'modalidad'), '') as modalidad,
             e.val ? 'mano_obra_oficial' as trae_mo,
             (e.val->>'mano_obra_oficial') as mo_txt,
             e.val ? 'herramienta_menor_pct' as trae_hm,
             (e.val->>'herramienta_menor_pct') as hm_txt
        from jsonb_array_elements(p_filas) with ordinality as e(val, ord)
    )
    select f.*, pi.id as item_id, pi.modalidad as modalidad_actual, pi.mano_obra_oficial, pi.herramienta_menor_pct,
           pi.precio_original,
           count(*) over (partition by f.codigo) as repetidas,
           (select count(*) from presupuesto_items x where x.version_id = p_version_id and x.codigo = f.codigo) as en_version
      from filas f
      left join lateral (
        select x.* from presupuesto_items x
         where x.version_id = p_version_id and x.codigo = f.codigo
         order by x.id limit 1
      ) pi on true
     order by f.ord
  loop
    declare
      v_error text;
      v_mo numeric;
      v_hm numeric;
    begin
      if v_f.codigo is null then
        v_error := 'falta el código';
      elsif v_f.item_id is null then
        v_error := 'no está en el presupuesto';
      elsif v_f.en_version > 1 then
        v_error := 'el código está repetido en el presupuesto';
      elsif v_f.repetidas > 1 then
        v_error := 'el código viene más de una vez';
      elsif v_f.modalidad is not null and v_f.modalidad not in ('administracion', 'todo_costo', 'mano_obra') then
        v_error := 'modalidad desconocida';
      end if;
      if v_error is null and v_f.trae_mo and nullif(trim(v_f.mo_txt), '') is not null then
        begin
          v_mo := v_f.mo_txt::numeric;
          if v_mo < 0 then v_error := 'la mano de obra oficial no puede ser negativa'; end if;
        exception when others then
          v_error := 'la mano de obra oficial no es un número';
        end;
      end if;
      if v_error is null and v_f.trae_hm and nullif(trim(v_f.hm_txt), '') is not null then
        begin
          v_hm := v_f.hm_txt::numeric;
          if v_hm < 0 or v_hm > 100 then v_error := 'la herramienta menor debe estar entre 0 y 100 %'; end if;
        exception when others then
          v_error := 'la herramienta menor no es un número';
        end;
      end if;
      if v_error is null then
        if not v_f.trae_mo then v_mo := v_f.mano_obra_oficial; end if;
        if not v_f.trae_hm then v_hm := v_f.herramienta_menor_pct; end if;
        -- Sin cambios: no se toca
        if v_f.modalidad is not distinct from v_f.modalidad_actual
           and v_mo is not distinct from v_f.mano_obra_oficial
           and v_hm is not distinct from v_f.herramienta_menor_pct then
          continue;
        end if;
        select * into v_info from public._info_modalidad_item(v_f.item_id);
        if not v_info.es_hoja then
          v_error := 'es un capítulo: la modalidad va en sus ítems';
        elsif v_info.con_movimientos then
          v_error := 'ya tiene requisiciones o contratos: no cambia de modalidad';
        elsif v_f.modalidad = 'todo_costo' and v_tope is null then
          v_error := 'el proyecto no tiene el % de subcontrato a todo costo';
        elsif v_f.modalidad = 'todo_costo' and coalesce(v_f.precio_original, 0) <= 0 then
          v_error := 'no tiene precio oficial';
        elsif v_f.modalidad = 'mano_obra' and not v_info.tiene_mano_obra then
          v_error := 'no tiene mano de obra: no puede ser subcontrato de mano de obra';
        elsif ((v_f.modalidad = 'mano_obra' and not v_info.con_insumos)
               or (v_f.modalidad = 'administracion' and v_info.tiene_mano_obra))
              and coalesce(v_mo, 0) <= 0 then
          v_error := 'falta la mano de obra oficial';
        end if;
      end if;
      if v_error is not null then
        v_errores := v_errores || jsonb_build_object('fila', v_f.ord, 'codigo', v_f.codigo, 'error', v_error);
      else
        v_cambios := v_cambios || jsonb_build_object('item_id', v_f.item_id, 'modalidad', v_f.modalidad,
                                                     'mano_obra_oficial', v_mo, 'herramienta_menor_pct', v_hm);
      end if;
    end;
  end loop;

  select coalesce(sum(valor_total), 0) into v_antes
    from presupuesto_items pi
   where pi.version_id = p_version_id
     and not exists (select 1 from presupuesto_items h where h.padre_id = pi.id);

  if jsonb_array_length(v_errores) > 0 then
    return jsonb_build_object('aplicado', false, 'errores', v_errores, 'cambian', jsonb_array_length(v_cambios),
                              'valor_antes', v_antes);
  end if;

  -- 2. Aplicar (en la vista previa se deshace al final del bloque)
  begin
    for v_f in
      select (c->>'item_id')::uuid as item_id, c->>'modalidad' as modalidad,
             (c->>'mano_obra_oficial')::numeric as mo, (c->>'herramienta_menor_pct')::numeric as hm
        from jsonb_array_elements(v_cambios) c
    loop
      update presupuesto_items
         set mano_obra_oficial = v_f.mo, herramienta_menor_pct = v_f.hm
       where id = v_f.item_id;
      v_res := public._aplicar_modalidad_item(v_f.item_id, v_f.modalidad);
      v_lineas := v_lineas + (v_res->>'lineas')::integer;
      v_revisiones := v_revisiones + (v_res->>'revisiones')::integer;
      v_solicitudes := v_solicitudes + (v_res->>'solicitudes')::integer;
      v_n := v_n + 1;
    end loop;

    select coalesce(sum(valor_total), 0) into v_despues
      from presupuesto_items pi
     where pi.version_id = p_version_id
       and not exists (select 1 from presupuesto_items h where h.padre_id = pi.id);
    select coalesce(jsonb_object_agg(coalesce(m.modalidad, 'sin_modalidad'), m.n), '{}'::jsonb) into v_por_modalidad
      from (select pi.modalidad, count(*) as n
              from presupuesto_items pi
             where pi.version_id = p_version_id
               and not exists (select 1 from presupuesto_items h where h.padre_id = pi.id)
             group by pi.modalidad) m;

    if not p_confirmar then
      raise exception using errcode = 'P0001', message = '__vista_previa_modalidades__';
    end if;
  exception when sqlstate 'P0001' then
    if sqlerrm <> '__vista_previa_modalidades__' then
      raise;
    end if;
  end;

  if p_confirmar and v_n > 0 then
    perform public._anotar_historial('presupuesto', v_presupuesto, 'modalidades',
      jsonb_build_object('version_id', p_version_id, 'items', v_n, 'lineas_guardadas', v_lineas,
                         'lineas_no_requeridas', v_revisiones, 'solicitudes_cerradas', v_solicitudes,
                         'valor_antes', v_antes, 'valor_despues', v_despues));
  end if;

  return jsonb_build_object('aplicado', p_confirmar, 'errores', '[]'::jsonb, 'cambian', v_n,
                            'por_modalidad', v_por_modalidad, 'lineas_guardadas', v_lineas,
                            'lineas_no_requeridas', v_revisiones, 'solicitudes_cerradas', v_solicitudes,
                            'valor_antes', v_antes, 'valor_despues', coalesce(v_despues, v_antes));
end;
$$;
revoke all on function public.fijar_modalidades_presupuesto(uuid, jsonb, boolean) from public, anon;
grant execute on function public.fijar_modalidades_presupuesto(uuid, jsonb, boolean) to authenticated;

commit;
