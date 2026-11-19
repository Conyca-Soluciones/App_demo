-- Dividir la mano de obra de un ítem en varios trabajos y contratarlos por
-- separado (decisión del usuario, 2026-11-19).
--
-- Caso: la Loseta (15 und) necesita un contrato de FABRICACIÓN y otro de
-- INSTALACIÓN; el Excel solo trae "Cuadrilla AA" (o el nombre del ítem).
--
-- 1. Dividir (quien edita presupuestos, versión vigente): la mano de obra del
--    ítem se reemplaza por los trabajos que se escriban (nombre libre). Cada
--    trabajo es una línea de revisión del import nueva (tipo MO) que sigue el
--    camino de siempre: si el nombre ya está en el catálogo (misma unidad) se
--    enlaza; si no, va a Aprobación de mano de obra (se reutiliza la solicitud
--    pendiente igual del mismo ámbito). Las líneas del Excel quedan en estado
--    'dividido' (no se revisan, guardan el texto original) y cada trabajo
--    guarda ese texto en dividida_de. Las líneas de mano de obra del APU se
--    borran. Solo ítems con insumos cuya mano de obra sale del catálogo
--    (subcontrato de mano de obra con insumos, o sin modalidad todavía); no en
--    administración, todo costo ni subcontrato sin insumos (50 % fijo). No con
--    contratos sobre el ítem. "Juntar otra vez" lo deshace (vuelven las líneas
--    del Excel, pendientes).
-- 2. Contratos: un ítem cuyo APU tiene 2 o más categorías de mano de obra
--    tiene TRABAJOS (_trabajos_item). Cada actividad del contrato de mano de
--    obra puede ser un trabajo (contrato_anexo_items.mano_obra_categoria_id) o
--    la mano de obra completa (null, como hoy). Cupo por cantidad:
--    - trabajo X: cantidad del ítem − (completa + lo contratado de X);
--    - completa: cantidad − (completa + el trabajo más contratado).
--    Tope por und de un trabajo: su valor del catálogo + su parte de la
--    herramienta menor (sin pasar del valor del ítem). Sobre el tope: misma
--    autorización de Gerencia (20270101004200). La actividad dice
--    "<ítem> — <trabajo>" (minuta, PDF, actas).
-- 3. Otrosí: la adición a una actividad de un trabajo usa el cupo de ese
--    trabajo; las actividades nuevas son siempre la mano de obra completa.
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

-- 1. Columnas ----------------------------------------------------------------------

alter table public.apu_import_revision add column if not exists dividida_de text;
alter table public.apu_import_revision drop constraint if exists apu_import_revision_estado_check;
alter table public.apu_import_revision add constraint apu_import_revision_estado_check
  check (estado in ('auto_match', 'pendiente', 'solicitud_pendiente', 'resuelto', 'rechazado', 'no_requerido', 'dividido'));

alter table public.contrato_anexo_items
  add column if not exists mano_obra_categoria_id uuid references public.mano_obra_categorias(id);
create index if not exists contrato_anexo_items_presupuesto_item_idx
  on public.contrato_anexo_items (presupuesto_item_id);

-- 2. Trabajos de un ítem, cupo y tope ------------------------------------------------

-- Trabajos del ítem: las categorías de mano de obra de su APU, solo si son 2 o
-- más y la mano de obra no es fija (modalidad). valor = valor del catálogo +
-- su parte de la herramienta menor del APU.
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

-- Cantidad que ya no está disponible para una actividad del contrato: la del
-- trabajo (p_trabajo) o la de la mano de obra completa (null).
create or replace function public._contratado_linea(p_presupuesto_id uuid, p_codigo text, p_trabajo uuid)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $function$
  with c as (
    select ai.mano_obra_categoria_id as cat, sum(ai.cantidad - ai.cantidad_reducida) as total
      from contrato_anexo_items ai
      join contratos co on co.id = ai.contrato_id
      join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
     where p2.presupuesto_id = p_presupuesto_id and p2.codigo = p_codigo
       and co.estado <> 'rechazada'
     group by ai.mano_obra_categoria_id
  )
  select coalesce((select sum(total) from c where cat is null), 0)
       + case when p_trabajo is null then coalesce((select max(total) from c where cat is not null), 0)
              else coalesce((select sum(total) from c where cat = p_trabajo), 0) end
$function$;

-- Lo contratado del ítem, visto desde la mano de obra completa (con trabajos,
-- cuenta el trabajo más contratado). Sin trabajos es lo de siempre.
create or replace function public._contratado_item(p_presupuesto_id uuid, p_codigo text)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $function$
  select public._contratado_linea(p_presupuesto_id, p_codigo, null)
$function$;

create or replace function public._tope_linea_contrato(p_item uuid, p_tipo text, p_trabajo uuid)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when p_trabajo is null then public._tope_valor_unitario_item(p_item, p_tipo)
    else (select least(t.valor, pi.valor_unitario)
            from presupuesto_items pi, public._trabajos_item(p_item) t
           where pi.id = p_item and t.categoria_id = p_trabajo)
  end
$function$;

create or replace function public._validar_trabajo_contrato(p_item uuid, p_tipo text, p_trabajo uuid)
returns void
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if p_trabajo is null then
    return;
  end if;
  if p_tipo is distinct from 'mano_obra' then
    raise exception 'Solo un contrato de mano de obra se hace por trabajos.';
  end if;
  if not exists (select 1 from public._trabajos_item(p_item) t where t.categoria_id = p_trabajo) then
    raise exception 'El trabajo elegido ya no está en la mano de obra del ítem %: vuelve a elegirlo.',
      (select codigo from presupuesto_items where id = p_item);
  end if;
end;
$function$;

-- Para el formulario de contratos: los trabajos de los ítems del presupuesto
-- vigente con su tope y lo disponible.
create or replace function public.trabajos_items_contrato(p_proyecto_id uuid)
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
    -- Ítems con 2 o más categorías de mano de obra en su APU (una pasada).
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

-- 3. Dividir y juntar -----------------------------------------------------------------

-- Estado de la mano de obra de un ítem para la ventana de "Dividir".
create or replace function public.info_division_mano_obra(p_item uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v record;
  v_info record;
  v_motivo text;
  v_dividida boolean;
begin
  select pi.id, pi.codigo, pi.descripcion, pi.unidad, pi.modalidad, pi.apu_id, pi.version_id, pi.presupuesto_id,
         p.proyecto_id, p.version_actual_id
    into v
    from presupuesto_items pi join presupuestos p on p.id = pi.presupuesto_id
   where pi.id = p_item;
  if not found or not public.usuario_puede_ver_proyecto(v_uid, v.proyecto_id) then
    raise exception 'El ítem no existe o no tienes acceso.';
  end if;
  select * into v_info from public._info_modalidad_item(p_item);
  v_dividida := exists (select 1 from apu_import_revision r where r.presupuesto_item_id = p_item and r.dividida_de is not null);

  v_motivo := case
    when not public.tiene_accion(v_uid, 'editar_presupuestos') then 'No tienes permiso para editar presupuestos.'
    when v.version_id is distinct from v.version_actual_id then 'Solo se divide en la versión vigente del presupuesto.'
    when v.apu_id is null then 'El ítem no tiene APU.'
    when v.modalidad = 'administracion' then 'El ítem va por administración: no lleva contrato de mano de obra.'
    when v.modalidad = 'todo_costo' then 'El ítem es subcontrato a todo costo: va en un solo contrato de obra.'
    when exists (select 1 from item_apu ia where ia.apu_id = v.apu_id and ia.concepto_fijo is not null)
      then 'La mano de obra del ítem es un valor fijo de su modalidad: no se divide.'
    when not coalesce(v_info.con_insumos, false) then 'El ítem no tiene insumos: su mano de obra no se divide.'
    when not coalesce(v_info.tiene_mano_obra, false) then 'El ítem no tiene mano de obra.'
    when exists (select 1 from contrato_anexo_items ai
                   join contratos c on c.id = ai.contrato_id
                   join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
                  where p2.presupuesto_id = v.presupuesto_id and p2.codigo = v.codigo and c.estado <> 'rechazada')
      then 'El ítem ya tiene contratos: su mano de obra no se puede cambiar.'
  end;

  return jsonb_build_object(
    'puede_dividir', v_motivo is null and not v_dividida,
    'puede_juntar', v_motivo is null and v_dividida,
    'motivo', v_motivo,
    'dividida', v_dividida,
    'unidad', v.unidad,
    'excel', coalesce(
      (select string_agg(distinct r.dividida_de, ' · ') from apu_import_revision r
        where r.presupuesto_item_id = p_item and r.dividida_de is not null),
      (select string_agg(distinct r.descripcion_original, ' · ') from apu_import_revision r
        where r.presupuesto_item_id = p_item and r.tipo = 'MO' and r.estado <> 'dividido')),
    'lineas', coalesce((
      select jsonb_agg(x order by x->>'nombre') from (
        -- Líneas del APU con categoría (resueltas).
        select jsonb_build_object('nombre', moc.categoria, 'valor', moc.valor_unitario, 'estado', 'resuelto') as x
          from item_apu ia join mano_obra_categorias moc on moc.id = ia.mano_obra_categoria_id
         where ia.apu_id = v.apu_id
        union all
        -- Líneas del import sin resolver todavía.
        select jsonb_build_object('nombre', r.descripcion_original, 'valor', null, 'estado', r.estado)
          from apu_import_revision r
         where r.presupuesto_item_id = p_item and r.tipo = 'MO'
           and r.estado in ('pendiente', 'solicitud_pendiente', 'rechazado')
      ) s), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.dividir_mano_obra_item(p_item uuid, p_trabajos text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v record;
  v_info jsonb;
  v_excel text;
  v_lote uuid;
  v_nombres text[] := '{}';
  v_claves text[] := '{}';
  v_nombre text;
  v_cat uuid;
  v_sol uuid;
  v_rev uuid;
  v_ia uuid;
  v_sols uuid[];
  v_en_catalogo integer := 0;
  v_por_aprobar integer := 0;
begin
  if v_uid is null or not public.tiene_accion(v_uid, 'editar_presupuestos') then
    raise exception 'No tienes permiso para editar presupuestos.';
  end if;

  select pi.id, pi.codigo, pi.unidad, pi.apu_id, pi.presupuesto_id into v
    from presupuesto_items pi where pi.id = p_item for update;
  if not found then
    raise exception 'El ítem no existe.';
  end if;

  v_info := public.info_division_mano_obra(p_item);
  if v_info->>'motivo' is not null then
    raise exception '%', v_info->>'motivo';
  end if;
  if (v_info->>'dividida')::boolean then
    raise exception 'La mano de obra del ítem % ya está dividida: júntala otra vez antes de dividirla de nuevo.', v.codigo;
  end if;

  foreach v_nombre in array coalesce(p_trabajos, '{}') loop
    v_nombre := regexp_replace(trim(coalesce(v_nombre, '')), '\s+', ' ', 'g');
    if v_nombre = '' then
      raise exception 'Escribe el nombre de cada trabajo.';
    end if;
    if length(v_nombre) > 200 then
      raise exception 'El nombre "%" es muy largo (máximo 200 caracteres).', left(v_nombre, 40);
    end if;
    if public._clave_actividad(v_nombre) = any (v_claves) then
      raise exception 'Hay dos trabajos con el nombre "%".', v_nombre;
    end if;
    v_claves := v_claves || public._clave_actividad(v_nombre);
    v_nombres := v_nombres || v_nombre;
  end loop;
  if coalesce(array_length(v_nombres, 1), 0) < 2 then
    raise exception 'Escribe al menos dos trabajos.';
  end if;
  if array_length(v_nombres, 1) > 15 then
    raise exception 'Máximo 15 trabajos por ítem.';
  end if;

  select string_agg(distinct r.descripcion_original, ' · '), (array_agg(r.lote_import_id))[1]
    into v_excel, v_lote
    from apu_import_revision r
   where r.presupuesto_item_id = p_item and r.tipo = 'MO' and r.estado <> 'dividido';
  v_excel := coalesce(v_excel, 'Mano de obra del APU');
  v_lote := coalesce(v_lote, (select r.lote_import_id from apu_import_revision r where r.presupuesto_item_id = p_item limit 1),
                     gen_random_uuid());

  -- Las líneas del Excel quedan divididas (sueltas de su solicitud y de su
  -- línea del APU); las solicitudes pendientes que solo servían a ellas se borran.
  select array_agg(distinct r.solicitud_mano_obra_id) filter (where r.solicitud_mano_obra_id is not null)
    into v_sols
    from apu_import_revision r
   where r.presupuesto_item_id = p_item and r.tipo = 'MO' and r.estado <> 'dividido';
  update apu_import_revision r
     set estado = 'dividido', solicitud_mano_obra_id = null, item_apu_id = null
   where r.presupuesto_item_id = p_item and r.tipo = 'MO' and r.estado <> 'dividido';
  delete from solicitudes_mano_obra s
   where s.id = any (coalesce(v_sols, '{}')) and s.estado = 'pendiente'
     and not exists (select 1 from apu_import_revision r2 where r2.solicitud_mano_obra_id = s.id);
  delete from item_apu where apu_id = v.apu_id and mano_obra_categoria_id is not null;

  foreach v_nombre in array v_nombres loop
    insert into apu_import_revision (lote_import_id, presupuesto_item_id, apu_id, descripcion_original, tipo, unidad,
                                     cantidad, candidatos, estado, dividida_de)
    values (v_lote, p_item, v.apu_id, v_nombre, 'MO', v.unidad, 1, '[]'::jsonb, 'pendiente', v_excel)
    returning id into v_rev;

    select moc.id into v_cat
      from mano_obra_categorias moc
     where public._clave_actividad(moc.categoria) = public._clave_actividad(v_nombre)
       and public._clave_unidad(moc.unidad) = public._clave_unidad(v.unidad)
       and moc.valor_unitario is not null
     order by moc.created_at, moc.id
     limit 1;

    if v_cat is not null then
      insert into item_apu (apu_id, mano_obra_categoria_id, cantidad, rendimiento, tipo)
      values (v.apu_id, v_cat, 1, 1, 'MO')
      returning id into v_ia;
      update apu_import_revision
         set estado = 'resuelto', mano_obra_categoria_id_asignado = v_cat, item_apu_id = v_ia
       where id = v_rev;
      v_en_catalogo := v_en_catalogo + 1;
    else
      select s.id into v_sol
        from solicitudes_mano_obra s
       where s.estado = 'pendiente'
         and public._clave_actividad(s.descripcion) = public._clave_actividad(v_nombre)
         and public._clave_unidad(s.unidad) = public._clave_unidad(v.unidad)
         and public._ambito_item(s.presupuesto_item_id) = public._ambito_item(p_item)
       order by s.created_at, s.id
       limit 1;
      if v_sol is null then
        insert into solicitudes_mano_obra (descripcion, solicitado_por, presupuesto_item_id, unidad, estado)
        values (v_nombre, v_uid, p_item, v.unidad, 'pendiente')
        returning id into v_sol;
      end if;
      update apu_import_revision
         set estado = 'solicitud_pendiente', solicitud_mano_obra_id = v_sol
       where id = v_rev;
      v_por_aprobar := v_por_aprobar + 1;
    end if;
    v_cat := null;
    v_sol := null;
  end loop;

  perform public.recalcular_valor_apus(array[v.apu_id]);
  perform public._anotar_historial('presupuesto', v.presupuesto_id, 'mano_obra_dividida',
    jsonb_build_object('codigo', v.codigo, 'excel', v_excel, 'trabajos', to_jsonb(v_nombres)));

  return jsonb_build_object('trabajos', array_length(v_nombres, 1), 'en_catalogo', v_en_catalogo,
                            'por_aprobar', v_por_aprobar);
end;
$function$;

create or replace function public.juntar_mano_obra_item(p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v record;
  v_info jsonb;
  v_sols uuid[];
  v_n integer;
  v_cat uuid;
  v_ia uuid;
begin
  if v_uid is null or not public.tiene_accion(v_uid, 'editar_presupuestos') then
    raise exception 'No tienes permiso para editar presupuestos.';
  end if;
  select pi.id, pi.codigo, pi.apu_id, pi.presupuesto_id into v
    from presupuesto_items pi where pi.id = p_item for update;
  if not found then
    raise exception 'El ítem no existe.';
  end if;
  v_info := public.info_division_mano_obra(p_item);
  if not (v_info->>'dividida')::boolean then
    raise exception 'La mano de obra del ítem % no está dividida.', v.codigo;
  end if;
  if v_info->>'motivo' is not null then
    raise exception '%', v_info->>'motivo';
  end if;

  select array_agg(distinct r.solicitud_mano_obra_id) filter (where r.solicitud_mano_obra_id is not null)
    into v_sols
    from apu_import_revision r where r.presupuesto_item_id = p_item and r.dividida_de is not null;
  delete from item_apu ia
   where ia.id in (select r.item_apu_id from apu_import_revision r
                    where r.presupuesto_item_id = p_item and r.dividida_de is not null and r.item_apu_id is not null);
  delete from apu_import_revision r where r.presupuesto_item_id = p_item and r.dividida_de is not null;
  get diagnostics v_n = row_count;
  delete from solicitudes_mano_obra s
   where s.id = any (coalesce(v_sols, '{}')) and s.estado = 'pendiente'
     and not exists (select 1 from apu_import_revision r2 where r2.solicitud_mano_obra_id = s.id);
  -- Vuelven las líneas del Excel: las que ya tenían categoría, con su línea
  -- del APU otra vez (una por categoría); las demás, pendientes.
  for v_cat in
    select distinct r.mano_obra_categoria_id_asignado from apu_import_revision r
     where r.presupuesto_item_id = p_item and r.estado = 'dividido' and r.mano_obra_categoria_id_asignado is not null
       and exists (select 1 from mano_obra_categorias moc where moc.id = r.mano_obra_categoria_id_asignado)
  loop
    insert into item_apu (apu_id, mano_obra_categoria_id, cantidad, rendimiento, tipo)
    values (v.apu_id, v_cat, 1, 1, 'MO')
    returning id into v_ia;
    update apu_import_revision r set estado = 'resuelto', item_apu_id = v_ia
     where r.presupuesto_item_id = p_item and r.estado = 'dividido' and r.mano_obra_categoria_id_asignado = v_cat;
  end loop;
  update apu_import_revision r set estado = 'pendiente', mano_obra_categoria_id_asignado = null
   where r.presupuesto_item_id = p_item and r.estado = 'dividido';

  perform public.recalcular_valor_apus(array[v.apu_id]);
  perform public._anotar_historial('presupuesto', v.presupuesto_id, 'mano_obra_juntada',
    jsonb_build_object('codigo', v.codigo, 'trabajos', v_n));
  return jsonb_build_object('trabajos', v_n);
end;
$function$;

-- 4. Contratos ------------------------------------------------------------------------

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '  v_disponible numeric;
  d jsonb;',
  '  v_disponible numeric;
  v_trabajo uuid;
  d jsonb;');

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '    if (select count(distinct e->>''presupuesto_item_id'') from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items) then
      raise exception ''Hay un ítem del presupuesto repetido en el anexo.'';
    end if;',
  '    -- Un ítem puede ir varias veces si cada vez es un trabajo distinto (20270101004400).
    if (select count(distinct (e->>''presupuesto_item_id'') || ''|'' || coalesce(nullif(e->>''mano_obra_categoria_id'', ''''), ''''))
          from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items) then
      raise exception ''Hay un ítem del presupuesto (o un trabajo) repetido en el anexo.'';
    end if;
    if exists (select 1 from jsonb_array_elements(p_items) e1
                 join jsonb_array_elements(p_items) e2 on e2->>''presupuesto_item_id'' = e1->>''presupuesto_item_id''
                where nullif(e1->>''mano_obra_categoria_id'', '''') is null
                  and nullif(e2->>''mano_obra_categoria_id'', '''') is not null) then
      raise exception ''Un ítem no puede ir completo y por trabajos en el mismo contrato.'';
    end if;');

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '      v_cantidad := (d->>''cantidad'')::numeric;',
  '      v_trabajo := nullif(d->>''mano_obra_categoria_id'', '''')::uuid;
      v_cantidad := (d->>''cantidad'')::numeric;');

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '      v_tope := public._tope_valor_unitario_item(v_pi.id, v_tipo);',
  '      perform public._validar_trabajo_contrato(v_pi.id, v_tipo, v_trabajo);
      v_tope := public._tope_linea_contrato(v_pi.id, v_tipo, v_trabajo);');

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '      v_disponible := v_pi.cantidad - public._contratado_item(v_presupuesto, v_pi.codigo);',
  '      v_disponible := v_pi.cantidad - public._contratado_linea(v_presupuesto, v_pi.codigo, v_trabajo);');

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '  insert into contrato_anexo_items (contrato_id, orden, presupuesto_item_id, actividad, unidad, cantidad, valor_unitario, sin_mano_obra, tope_valor_unitario)
  select p_id, t.ord, pi.id, pi.descripcion, coalesce(nullif(trim(pi.unidad), ''''), ''und''),
         (t.v->>''cantidad'')::numeric, (t.v->>''valor_unitario'')::numeric,
         v_tipo = ''mano_obra'' and public._valor_mano_obra_item(pi.id) = 0,
         public._tope_valor_unitario_item(pi.id, v_tipo)
  from jsonb_array_elements(coalesce(p_items, ''[]'')) with ordinality as t(v, ord)
  join presupuesto_items pi on pi.id = (t.v->>''presupuesto_item_id'')::uuid;',
  '  insert into contrato_anexo_items (contrato_id, orden, presupuesto_item_id, actividad, unidad, cantidad, valor_unitario, sin_mano_obra, tope_valor_unitario,
                                    mano_obra_categoria_id)
  select p_id, t.ord, pi.id, pi.descripcion || coalesce('' — '' || moc.categoria, ''''), coalesce(nullif(trim(pi.unidad), ''''), ''und''),
         (t.v->>''cantidad'')::numeric, (t.v->>''valor_unitario'')::numeric,
         v_tipo = ''mano_obra'' and public._valor_mano_obra_item(pi.id) = 0,
         public._tope_linea_contrato(pi.id, v_tipo, moc.id),
         moc.id
  from jsonb_array_elements(coalesce(p_items, ''[]'')) with ordinality as t(v, ord)
  join presupuesto_items pi on pi.id = (t.v->>''presupuesto_item_id'')::uuid
  left join mano_obra_categorias moc on moc.id = nullif(t.v->>''mano_obra_categoria_id'', '''')::uuid;');

select pg_temp._parche('public.items_presupuesto_para_contrato(uuid)'::regprocedure,
  '  with contratado as (
    select p2.codigo, sum(ai.cantidad - ai.cantidad_reducida) as total
    from contrato_anexo_items ai
    join contratos c on c.id = ai.contrato_id
    join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
    where p2.presupuesto_id = v_presupuesto and c.estado <> ''rechazada''
    group by p2.codigo
  ),',
  '  with contratado as (
    -- Visto desde la mano de obra completa: lo completo + el trabajo más
    -- contratado (20270101004400).
    select y.codigo,
           coalesce(sum(y.total) filter (where y.cat is null), 0)
             + coalesce(max(y.total) filter (where y.cat is not null), 0) as total
    from (
      select p2.codigo, ai.mano_obra_categoria_id as cat, sum(ai.cantidad - ai.cantidad_reducida) as total
      from contrato_anexo_items ai
      join contratos c on c.id = ai.contrato_id
      join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
      where p2.presupuesto_id = v_presupuesto and c.estado <> ''rechazada''
      group by p2.codigo, ai.mano_obra_categoria_id
    ) y
    group by y.codigo
  ),');

-- 5. Otrosí ---------------------------------------------------------------------------

select pg_temp._parche('public.actividades_para_otrosi(uuid)'::regprocedure,
  '    with contratado as (
      select p2.codigo, sum(ai.cantidad - ai.cantidad_reducida) as total
        from contrato_anexo_items ai
        join contratos c2 on c2.id = ai.contrato_id
        join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
       where p2.presupuesto_id = v_presupuesto and c2.estado <> ''rechazada''
       group by p2.codigo
    ),',
  '    with contratado_cat as (
      select p2.codigo, ai.mano_obra_categoria_id as cat, sum(ai.cantidad - ai.cantidad_reducida) as total
        from contrato_anexo_items ai
        join contratos c2 on c2.id = ai.contrato_id
        join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
       where p2.presupuesto_id = v_presupuesto and c2.estado <> ''rechazada''
       group by p2.codigo, ai.mano_obra_categoria_id
    ),
    contratado as (
      select codigo,
             coalesce(sum(total) filter (where cat is null), 0) + coalesce(max(total) filter (where cat is not null), 0) as total,
             coalesce(sum(total) filter (where cat is null), 0) as completa
        from contratado_cat
       group by codigo
    ),');

select pg_temp._parche('public.actividades_para_otrosi(uuid)'::regprocedure,
  '      select ai.id, ai.orden, ai.actividad, ai.unidad, ai.cantidad - ai.cantidad_reducida as cantidad, ai.valor_unitario, p2.codigo
        from contrato_anexo_items ai',
  '      select ai.id, ai.orden, ai.actividad, ai.unidad, ai.cantidad - ai.cantidad_reducida as cantidad, ai.valor_unitario, p2.codigo,
             ai.mano_obra_categoria_id as cat
        from contrato_anexo_items ai');

select pg_temp._parche('public.actividades_para_otrosi(uuid)'::regprocedure,
  '                 ''disponible'', case when vg.id is null then 0 else greatest(vg.cantidad - coalesce(k.total, 0), 0) end',
  '                 ''mano_obra_categoria_id'', pr.cat,
                 ''disponible'', case when vg.id is null then 0
                                     when pr.cat is null then greatest(vg.cantidad - coalesce(k.total, 0), 0)
                                     else greatest(vg.cantidad - coalesce(k.completa, 0)
                                                   - coalesce((select kc.total from contratado_cat kc
                                                                where kc.codigo = pr.codigo and kc.cat = pr.cat), 0), 0) end');

select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  '  v_cobrado numeric;
begin',
  '  v_cobrado numeric;
  v_cat uuid;
begin');

select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  '        select ai.id, ai.actividad, ai.unidad, ai.valor_unitario, ai.sin_mano_obra, ai.presupuesto_item_id,
               ai.cantidad - ai.cantidad_reducida as vigente, p2.codigo
          into v_ai',
  '        select ai.id, ai.actividad, ai.unidad, ai.valor_unitario, ai.sin_mano_obra, ai.presupuesto_item_id,
               ai.cantidad - ai.cantidad_reducida as vigente, p2.codigo, ai.mano_obra_categoria_id as cat
          into v_ai');

select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  '      if coalesce(v_ai.codigo, v_ai.id::text) = any (v_codigos) then
        raise exception ''La actividad "%" está repetida en las actividades del otrosí.'', v_ai.actividad;
      end if;
      v_codigos := v_codigos || coalesce(v_ai.codigo, v_ai.id::text);',
  '      if coalesce(v_ai.codigo, v_ai.id::text) || ''|'' || coalesce(v_ai.cat::text, '''') = any (v_codigos) then
        raise exception ''La actividad "%" está repetida en las actividades del otrosí.'', v_ai.actividad;
      end if;
      v_codigos := v_codigos || (coalesce(v_ai.codigo, v_ai.id::text) || ''|'' || coalesce(v_ai.cat::text, ''''));');

select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  '        select ai.id, ai.actividad, ai.unidad, ai.valor_unitario, ai.sin_mano_obra, p2.codigo into v_ai',
  '        select ai.id, ai.actividad, ai.unidad, ai.valor_unitario, ai.sin_mano_obra, p2.codigo,
               ai.mano_obra_categoria_id as cat into v_ai');

select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  '      v_sin_mo := v_ai.sin_mano_obra;',
  '      v_sin_mo := v_ai.sin_mano_obra;
      v_cat := v_ai.cat;');

select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  '      v_sin_mo := c.tipo = ''mano_obra'' and v_mo = 0;',
  '      v_sin_mo := c.tipo = ''mano_obra'' and v_mo = 0;
      v_cat := null;');

select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  '    if v_pi.codigo = any (v_codigos) then
      raise exception ''El ítem % está repetido en las actividades del otrosí.'', v_pi.codigo;
    end if;
    v_codigos := v_codigos || v_pi.codigo;
    v_disp := v_pi.cantidad - public._contratado_item(v_presupuesto, v_pi.codigo);',
  '    if v_pi.codigo || ''|'' || coalesce(v_cat::text, '''') = any (v_codigos) then
      raise exception ''El ítem % está repetido en las actividades del otrosí.'', v_pi.codigo;
    end if;
    v_codigos := v_codigos || (v_pi.codigo || ''|'' || coalesce(v_cat::text, ''''));
    -- Una adición a un trabajo usa el cupo de ese trabajo (20270101004400).
    v_disp := v_pi.cantidad - public._contratado_linea(v_presupuesto, v_pi.codigo, v_cat);');

select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  '      ''cantidad'', v_cant, ''valor_unitario'', v_vu, ''total'', round(v_cant * v_vu, 2), ''sin_mano_obra'', v_sin_mo));',
  '      ''cantidad'', v_cant, ''valor_unitario'', v_vu, ''total'', round(v_cant * v_vu, 2), ''sin_mano_obra'', v_sin_mo,
      ''mano_obra_categoria_id'', v_cat));');

select pg_temp._parche('public.resolver_otrosi(uuid,text,text,jsonb)'::regprocedure,
  '      insert into contrato_anexo_items (contrato_id, orden, presupuesto_item_id, actividad, unidad, cantidad, valor_unitario,
                                        otrosi_id, sin_mano_obra)',
  '      insert into contrato_anexo_items (contrato_id, orden, presupuesto_item_id, actividad, unidad, cantidad, valor_unitario,
                                        otrosi_id, sin_mano_obra, mano_obra_categoria_id)');

select pg_temp._parche('public.resolver_otrosi(uuid,text,text,jsonb)'::regprocedure,
  '             p_id, coalesce((t.e->>''sin_mano_obra'')::boolean, false)
        from jsonb_array_elements(v_acts) with ordinality as t(e, ord)',
  '             p_id, coalesce((t.e->>''sin_mano_obra'')::boolean, false),
             nullif(t.e->>''mano_obra_categoria_id'', '''')::uuid
        from jsonb_array_elements(v_acts) with ordinality as t(e, ord)');

-- 6. Permisos -------------------------------------------------------------------------

revoke execute on function public._trabajos_item(uuid) from public;
revoke execute on function public._contratado_linea(uuid, text, uuid) from public;
revoke execute on function public._tope_linea_contrato(uuid, text, uuid) from public;
revoke execute on function public._validar_trabajo_contrato(uuid, text, uuid) from public;
grant execute on function public.trabajos_items_contrato(uuid) to authenticated;
grant execute on function public.info_division_mano_obra(uuid) to authenticated;
grant execute on function public.dividir_mano_obra_item(uuid, text[]) to authenticated;
grant execute on function public.juntar_mano_obra_item(uuid) to authenticated;

commit;
