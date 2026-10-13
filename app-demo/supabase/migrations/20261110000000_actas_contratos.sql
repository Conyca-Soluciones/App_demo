-- Elaboración de actas (Contratos › Elaboración de actas, pestaña
-- contratos.cortes, 2026-10-14).
--
-- 1. Número de contrato: "CJ-<número de la solicitud>-<año>", el mismo que
--    imprimen las minutas. Se asigna al aprobar (trigger) y a los ya aprobados.
-- 2. Actas: cada contrato aprobado tiene sus actas numeradas desde 1. Un acta
--    tiene de 1 a 20 líneas (ítem del presupuesto vigente + insumo de su APU +
--    cantidad). Precio e IVA los pone la base desde el APU y la maestra de
--    insumos (no confía en el navegador). Nace "pendiente": la aprueba otra
--    pantalla (Aprobación de actas, por hacer).
-- 3. Permisos: ver = pestaña contratos.cortes y acceso al proyecto; crear =
--    acción elaborar_actas. Por defecto: Director de obra (pestaña + acción).
-- Se puede correr más de una vez.

-- ---------------------------------------------------------------- número de contrato
alter table public.contratos add column if not exists numero_contrato text;
create unique index if not exists contratos_numero_contrato_key on public.contratos (numero_contrato);

create or replace function public._asignar_numero_contrato()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.estado = 'aprobada' and new.numero_contrato is null then
    new.numero_contrato := 'CJ-' || new.numero || '-'
      || extract(year from (coalesce(new.resuelto_at, now()) at time zone 'America/Bogota'))::int;
  end if;
  return new;
end;
$function$;

drop trigger if exists contratos_numero_contrato on public.contratos;
create trigger contratos_numero_contrato
  before insert or update of estado on public.contratos
  for each row execute function public._asignar_numero_contrato();

update public.contratos
   set numero_contrato = 'CJ-' || numero || '-'
       || extract(year from (coalesce(resuelto_at, now()) at time zone 'America/Bogota'))::int
 where estado = 'aprobada' and numero_contrato is null;

-- ---------------------------------------------------------------- tablas
create table if not exists public.actas (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id),
  numero integer not null check (numero > 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  total numeric(18, 2) not null,
  creado_por uuid references public.perfiles(id),
  created_at timestamptz not null default now(),
  resuelto_por uuid references public.perfiles(id),
  resuelto_at timestamptz,
  motivo_resolucion text,
  unique (contrato_id, numero)
);

-- Se copian código, descripción, unidad y precios: el acta no cambia si
-- después se edita el presupuesto o el APU.
create table if not exists public.acta_lineas (
  id uuid primary key default gen_random_uuid(),
  acta_id uuid not null references public.actas(id) on delete cascade,
  orden smallint not null,
  presupuesto_item_id uuid references public.presupuesto_items(id) on delete set null,
  item_apu_id uuid references public.item_apu(id) on delete set null,
  item_codigo text,
  item_descripcion text,
  insumo_codigo integer,
  insumo_descripcion text not null,
  unidad text,
  cantidad numeric not null check (cantidad > 0),
  precio numeric(18, 2) not null,
  iva_porcentaje numeric(5, 2) not null default 0,
  base_iva numeric(18, 2) not null,
  iva numeric(18, 2) not null,
  total numeric(18, 2) not null
);

create index if not exists idx_actas_contrato on public.actas (contrato_id);
create index if not exists idx_actas_creado_por on public.actas (creado_por);
create index if not exists idx_actas_resuelto_por on public.actas (resuelto_por);
create index if not exists idx_acta_lineas_acta on public.acta_lineas (acta_id);
create index if not exists idx_acta_lineas_item on public.acta_lineas (presupuesto_item_id);
create index if not exists idx_acta_lineas_item_apu on public.acta_lineas (item_apu_id);

-- ---------------------------------------------------------------- RLS (solo lectura; se escribe con crear_acta)
create or replace function public.puede_ver_actas(p_proyecto_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.tiene_pestana(auth.uid(), 'contratos.cortes')
     and public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id)
$function$;
revoke all on function public.puede_ver_actas(uuid) from public, anon;
grant execute on function public.puede_ver_actas(uuid) to authenticated, service_role;

alter table public.actas enable row level security;
alter table public.acta_lineas enable row level security;

drop policy if exists actas_select on public.actas;
create policy actas_select on public.actas for select to authenticated
  using (exists (select 1 from public.contratos c where c.id = contrato_id and public.puede_ver_actas(c.proyecto_id)));

drop policy if exists acta_lineas_select on public.acta_lineas;
create policy acta_lineas_select on public.acta_lineas for select to authenticated
  using (exists (
    select 1 from public.actas a join public.contratos c on c.id = a.contrato_id
    where a.id = acta_id and public.puede_ver_actas(c.proyecto_id)
  ));

-- ---------------------------------------------------------------- búsqueda de contratos y contratistas
-- Solo contratos aprobados de los proyectos que el usuario ve. "_" lista todo.
create or replace function public.buscar_contratos_para_acta(p_texto text default null, p_contratista_id uuid default null)
 returns table(contrato_id uuid, numero_contrato text, numero bigint, tipo text, objeto text, valor numeric,
               proyecto_codigo text, proyecto_nombre text, contratista_id uuid, contratista_nombre text,
               contratista_documento text, actas integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
begin
  if not public.tiene_pestana(auth.uid(), 'contratos.cortes') then
    raise exception 'No tienes permiso para ver actas.';
  end if;
  if p_contratista_id is null and v_texto is null then
    return;
  end if;

  return query
  select c.id, c.numero_contrato, c.numero, c.tipo, c.objeto, c.valor,
         p.codigo, p.nombre, k.id, k.nombre,
         k.tipo_documento || ' ' || k.numero_documento || coalesce('-' || k.digito_verificacion, ''),
         (select count(*)::int from actas a where a.contrato_id = c.id)
  from contratos c
  join contratistas k on k.id = c.contratista_id
  join proyectos p on p.id = c.proyecto_id
  where c.estado = 'aprobada'
    and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
    and (p_contratista_id is null or c.contratista_id = p_contratista_id)
    and (
      v_texto is null or v_texto = '_'
      or c.numero_contrato ilike '%' || v_texto || '%'
      or c.objeto ilike '%' || v_texto || '%'
      or k.nombre ilike '%' || v_texto || '%'
      or k.numero_documento ilike '%' || v_texto || '%'
    )
  order by c.numero desc
  limit 50;
end;
$function$;
revoke all on function public.buscar_contratos_para_acta(text, uuid) from public, anon;
grant execute on function public.buscar_contratos_para_acta(text, uuid) to authenticated;

-- Contratistas que tienen al menos un contrato aprobado visible.
create or replace function public.buscar_contratistas_para_acta(p_texto text)
 returns table(contratista_id uuid, nombre text, documento text, contratos integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
begin
  if not public.tiene_pestana(auth.uid(), 'contratos.cortes') then
    raise exception 'No tienes permiso para ver actas.';
  end if;
  if v_texto is null then
    return;
  end if;

  return query
  select k.id, k.nombre,
         k.tipo_documento || ' ' || k.numero_documento || coalesce('-' || k.digito_verificacion, ''),
         count(*)::int
  from contratistas k
  join contratos c on c.contratista_id = k.id
  where c.estado = 'aprobada'
    and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
    and (v_texto = '_' or k.nombre ilike '%' || v_texto || '%' or k.numero_documento ilike '%' || v_texto || '%')
  group by k.id, k.nombre, k.tipo_documento, k.numero_documento, k.digito_verificacion
  order by k.nombre
  limit 50;
end;
$function$;
revoke all on function public.buscar_contratistas_para_acta(text) from public, anon;
grant execute on function public.buscar_contratistas_para_acta(text) to authenticated;

-- Actas de un contrato.
create or replace function public.actas_de_contrato(p_contrato_id uuid)
 returns table(acta_id uuid, numero integer, estado text, total numeric, created_at timestamptz,
               creado_por_nombre text, lineas integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_proyecto uuid;
begin
  select c.proyecto_id into v_proyecto from contratos c where c.id = p_contrato_id;
  if v_proyecto is null or not public.puede_ver_actas(v_proyecto) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;

  return query
  select a.id, a.numero, a.estado, a.total, a.created_at, pf.nombre,
         (select count(*)::int from acta_lineas l where l.acta_id = a.id)
  from actas a
  left join perfiles pf on pf.id = a.creado_por
  where a.contrato_id = p_contrato_id
  order by a.numero;
end;
$function$;
revoke all on function public.actas_de_contrato(uuid) from public, anon;
grant execute on function public.actas_de_contrato(uuid) to authenticated;

-- ---------------------------------------------------------------- ítems e insumos
-- Ítems del presupuesto vigente del proyecto del contrato que tienen APU.
create or replace function public.items_para_acta(p_contrato_id uuid, p_texto text)
 returns table(presupuesto_item_id uuid, codigo text, descripcion text, unidad text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_proyecto uuid;
  v_version uuid;
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
begin
  select c.proyecto_id into v_proyecto from contratos c where c.id = p_contrato_id;
  if v_proyecto is null or not public.puede_ver_actas(v_proyecto) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  select p.version_actual_id into v_version from presupuestos p where p.proyecto_id = v_proyecto;
  if v_version is null or v_texto is null then
    return;
  end if;

  return query
  select pi.id, pi.codigo, pi.descripcion, pi.unidad
  from presupuesto_items pi
  where pi.version_id = v_version
    and pi.apu_id is not null
    and (v_texto = '_' or pi.codigo ilike '%' || v_texto || '%' or pi.descripcion ilike '%' || v_texto || '%')
  order by pi.codigo, pi.id
  limit 50;
end;
$function$;
revoke all on function public.items_para_acta(uuid, text) from public, anon;
grant execute on function public.items_para_acta(uuid, text) to authenticated;

-- Líneas del APU de un ítem con su precio unitario (el mismo que usa el APU:
-- congelado o de la maestra, dividido por el factor de unidad; mano de obra,
-- equipo y transporte con el valor de su categoría) y su % de IVA (el de la
-- maestra de insumos; 0 para lo demás). Sin "herramienta menor %".
create or replace function public._lineas_apu_para_acta(p_item_id uuid)
 returns table(item_apu_id uuid, insumo_codigo integer, descripcion text, unidad text, precio numeric, iva_porcentaje numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select ia.id,
         mi.codigo,
         coalesce(mi.descripcion, mo.categoria, eq.categoria, tp.descripcion_original),
         coalesce(case when mi.id is not null then coalesce(ia.unidad, mi.u_m) end, mo.unidad, eq.unidad, tp.unidad),
         round(case
           when mi.id is not null then coalesce(ia.precio_unitario_congelado, mi.vr_unitario / coalesce(nullif(ia.factor_unidad, 0), 1))
           else coalesce(mo.valor_unitario, eq.valor_unitario, tp.valor_unitario)
         end, 2),
         case when mi.id is not null and not coalesce(mi.excluye_iva, false) then coalesce(mi.iva_porcentaje, 0) else 0 end::numeric
  from presupuesto_items pi
  join item_apu ia on ia.apu_id = pi.apu_id
  left join maestro_insumos mi on mi.id = ia.insumo_id
  left join mano_obra_categorias mo on mo.id = ia.mano_obra_categoria_id
  left join equipo_categorias eq on eq.id = ia.equipo_categoria_id
  left join transporte_precios tp on tp.id = ia.transporte_precio_id
  where pi.id = p_item_id
    and ia.porcentaje_mano_obra is null
    and coalesce(mi.descripcion, mo.categoria, eq.categoria, tp.descripcion_original) is not null
$function$;
revoke all on function public._lineas_apu_para_acta(uuid) from public, anon, authenticated;

create or replace function public.insumos_item_para_acta(p_contrato_id uuid, p_item_id uuid)
 returns table(item_apu_id uuid, insumo_codigo integer, descripcion text, unidad text, precio numeric, iva_porcentaje numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_proyecto uuid;
begin
  select c.proyecto_id into v_proyecto from contratos c where c.id = p_contrato_id;
  if v_proyecto is null or not public.puede_ver_actas(v_proyecto) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  if not exists (
    select 1 from presupuesto_items pi join presupuestos p on p.version_actual_id = pi.version_id
    where pi.id = p_item_id and p.proyecto_id = v_proyecto
  ) then
    raise exception 'El ítem no es del presupuesto vigente del proyecto.';
  end if;

  return query
  select l.* from public._lineas_apu_para_acta(p_item_id) l
  order by l.descripcion;
end;
$function$;
revoke all on function public.insumos_item_para_acta(uuid, uuid) from public, anon;
grant execute on function public.insumos_item_para_acta(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- crear acta
-- p_lineas: [{ "presupuesto_item_id", "item_apu_id", "cantidad" }], de 1 a 20.
-- Base IVA = cantidad × precio; IVA = base × %; total = base + IVA (cada uno
-- redondeado a centavos). Devuelve { id, numero }.
create or replace function public.crear_acta(p_contrato_id uuid, p_lineas jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_contrato record;
  v_version uuid;
  v_acta uuid;
  v_numero integer;
  v_orden integer := 0;
  v_total numeric := 0;
  v_item record;
  v_linea record;
  v_cantidad numeric;
  v_base numeric;
  v_iva numeric;
  d jsonb;
begin
  if not public.tiene_accion(auth.uid(), 'elaborar_actas') then
    raise exception 'No tienes permiso para elaborar actas.';
  end if;

  -- Bloquea el contrato: dos actas a la vez no sacan el mismo número.
  select c.id, c.estado, c.proyecto_id into v_contrato from contratos c where c.id = p_contrato_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v_contrato.proyecto_id) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  if v_contrato.estado <> 'aprobada' then
    raise exception 'Solo se hacen actas de contratos aprobados.';
  end if;

  if jsonb_typeof(coalesce(p_lineas, 'null')) is distinct from 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos una línea al acta.';
  end if;
  if jsonb_array_length(p_lineas) > 20 then
    raise exception 'Un acta tiene como máximo 20 líneas.';
  end if;
  if (select count(distinct (e->>'presupuesto_item_id') || '|' || (e->>'item_apu_id')) from jsonb_array_elements(p_lineas) e)
     <> jsonb_array_length(p_lineas) then
    raise exception 'Hay una línea repetida (mismo ítem e insumo).';
  end if;

  select p.version_actual_id into v_version from presupuestos p where p.proyecto_id = v_contrato.proyecto_id;

  select coalesce(max(a.numero), 0) + 1 into v_numero from actas a where a.contrato_id = p_contrato_id;
  insert into actas (contrato_id, numero, total, creado_por)
  values (p_contrato_id, v_numero, 0, auth.uid())
  returning id into v_acta;

  for d in select * from jsonb_array_elements(p_lineas) loop
    v_orden := v_orden + 1;
    begin
      v_cantidad := (d->>'cantidad')::numeric;
    exception when others then
      raise exception 'La cantidad de la línea % no es un número.', v_orden;
    end;
    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'La cantidad de la línea % debe ser mayor que cero.', v_orden;
    end if;

    select pi.id, pi.codigo, pi.descripcion into v_item
    from presupuesto_items pi
    where pi.id = (d->>'presupuesto_item_id')::uuid and pi.version_id = v_version;
    if not found then
      raise exception 'El ítem de la línea % no es del presupuesto vigente del proyecto.', v_orden;
    end if;

    select l.* into v_linea from public._lineas_apu_para_acta(v_item.id) l
    where l.item_apu_id = (d->>'item_apu_id')::uuid;
    if not found then
      raise exception 'El insumo de la línea % no es del APU del ítem %.', v_orden, v_item.codigo;
    end if;
    if v_linea.precio is null then
      raise exception 'El insumo de la línea % no tiene precio.', v_orden;
    end if;

    v_base := round(v_cantidad * v_linea.precio, 2);
    v_iva := round(v_base * v_linea.iva_porcentaje / 100, 2);
    v_total := v_total + v_base + v_iva;

    insert into acta_lineas (acta_id, orden, presupuesto_item_id, item_apu_id, item_codigo, item_descripcion,
                             insumo_codigo, insumo_descripcion, unidad, cantidad, precio, iva_porcentaje,
                             base_iva, iva, total)
    values (v_acta, v_orden, v_item.id, v_linea.item_apu_id, v_item.codigo, v_item.descripcion,
            v_linea.insumo_codigo, v_linea.descripcion, v_linea.unidad, v_cantidad, v_linea.precio,
            v_linea.iva_porcentaje, v_base, v_iva, v_base + v_iva);
  end loop;

  update actas set total = v_total where id = v_acta;
  return jsonb_build_object('id', v_acta, 'numero', v_numero);
end;
$function$;
revoke all on function public.crear_acta(uuid, jsonb) from public, anon;
grant execute on function public.crear_acta(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- roles
insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
from public.roles r
cross join (values ('tab.contratos.cortes'), ('accion.elaborar_actas')) as p(permiso)
where r.clave = 'director_obra'
on conflict do nothing;
