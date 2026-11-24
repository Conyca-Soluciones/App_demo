-- El tercero manda; si Financiera lo cambia, su proveedor y su contratista se revisan
-- (2026-11-24, decisiones del usuario).
--
-- 1. Solo Financiera (acción editar_terceros) y el Administrador cambian datos del tercero.
--    actualizar_contacto_tercero ya no lo pueden usar quienes editan proveedores o
--    contratistas: en esos formularios el contacto se ve pero no se edita.
-- 2. Cuando cambia el nombre, el tipo o número de documento, el DV o el contacto (correo,
--    teléfono, dirección, ciudad) de un tercero, su proveedor y su contratista quedan EN
--    REVISIÓN (tabla revisiones_tercero, una abierta por proveedor o contratista, con lo
--    que cambió: antes -> después). Las cuentas y el RUT no piden revisión.
--    - Proveedor: el pendiente le llega a quien tiene la acción nueva "Revisar proveedores"
--      (Compras y Líder Compras); ellos lo marcan como revisado.
--    - Contratista: le llega a quien lo creó (sin creador, a quien tiene "Gestionar
--      contratistas"); lo marca quien lo creó o quien tiene esa acción.
--    Historial del proveedor / contratista: en_revision y revisado.
-- 3. Mientras esté en revisión NO se usa para nada nuevo: no se crean órdenes de compra con
--    ese proveedor (ni se cambia una orden a ese proveedor) ni solicitudes de contrato con
--    ese contratista. Lo que ya existe sigue normal.
-- 4. Si el tercero deja de ser NIT (estaba mal creado), el proveedor sigue su tipo nuevo
--    (antes se quedaba en NIT con el número de la cédula).
--
-- Solo agrega; los ajustes a funciones vivas son parches por texto exacto. Reversa en
-- supabase/reversa/.

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

-- ------------------------------------------------------------ 1. Contacto del tercero: solo Financiera
select pg_temp._parche('public.actualizar_contacto_tercero(uuid, jsonb)'::regprocedure,
$a$  if not (public.tiene_accion(auth.uid(), 'editar_terceros')
          or public.tiene_accion(auth.uid(), 'editar_proveedores')
          or public.tiene_accion(auth.uid(), 'gestionar_contratistas')) then$a$,
$b$  -- Solo Financiera y el Administrador (20270101006100).
  if not public.tiene_accion(auth.uid(), 'editar_terceros') then$b$);

-- ------------------------------------------------------------ 2. Revisiones
create table if not exists public.revisiones_tercero (
  id uuid primary key default gen_random_uuid(),
  entidad text not null check (entidad in ('proveedor', 'contratista')),
  entidad_id uuid not null,
  tercero_id uuid not null references public.terceros(id) on delete cascade,
  -- { campo: { de, a } } de todo lo que cambió mientras estuvo abierta
  cambios jsonb not null,
  pedida_por uuid references public.perfiles(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  revisado_en timestamptz,
  revisado_por uuid references public.perfiles(id)
);
create unique index if not exists revisiones_tercero_abierta
  on public.revisiones_tercero (entidad, entidad_id) where revisado_en is null;
create index if not exists idx_revisiones_tercero_tercero on public.revisiones_tercero (tercero_id);
create index if not exists idx_revisiones_tercero_pedida_por on public.revisiones_tercero (pedida_por);
create index if not exists idx_revisiones_tercero_revisado_por on public.revisiones_tercero (revisado_por);
alter table public.revisiones_tercero enable row level security;
-- Sin políticas: se lee y escribe solo con las funciones.
revoke all on public.revisiones_tercero from anon, authenticated;

-- ¿Está en revisión? (para bloquear lo nuevo)
create or replace function public._en_revision_tercero(p_entidad text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from revisiones_tercero
                  where entidad = p_entidad and entidad_id = p_id and revisado_en is null)
$$;

-- Etiqueta legible de un campo del tercero.
create or replace function public._etiqueta_campo_tercero(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p
    when 'tipo_documento' then 'tipo de documento'
    when 'numero_documento' then 'número de documento'
    when 'dv' then 'DV'
    when 'razon_social' then 'nombre'
    when 'correo' then 'correo'
    when 'telefono' then 'teléfono'
    when 'direccion' then 'dirección'
    when 'ciudad' then 'ciudad'
    else p
  end
$$;

-- Al cambiar el tercero: abre (o suma a) la revisión de su proveedor y su contratista.
create or replace function public._tercero_pide_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cambios jsonb;
  r record;
begin
  select jsonb_object_agg(k, jsonb_build_object('de', x.o -> k, 'a', x.n -> k))
    into v_cambios
    from (select to_jsonb(old) as o, to_jsonb(new) as n) x
    cross join unnest(array['tipo_documento', 'numero_documento', 'dv', 'razon_social',
                            'correo', 'telefono', 'direccion', 'ciudad']) as k
   where (x.o -> k) is distinct from (x.n -> k);
  if v_cambios is null then
    return null;
  end if;

  for r in
    select 'proveedor'::text as entidad, p.unique_id as id from proveedores p where p.tercero_id = new.id
    union all
    select 'contratista', c.id from contratistas c where c.tercero_id = new.id
  loop
    insert into revisiones_tercero (entidad, entidad_id, tercero_id, cambios, pedida_por)
    values (r.entidad, r.id, new.id, v_cambios, auth.uid())
    on conflict (entidad, entidad_id) where revisado_en is null do update
      set cambios = revisiones_tercero.cambios || (
            select jsonb_object_agg(k, jsonb_build_object(
                     'de', coalesce(revisiones_tercero.cambios -> k -> 'de', excluded.cambios -> k -> 'de'),
                     'a', excluded.cambios -> k -> 'a'))
              from jsonb_object_keys(excluded.cambios) as k),
          actualizado_en = now(),
          pedida_por = excluded.pedida_por;
    perform public._anotar_historial(r.entidad, r.id, 'en_revision',
      jsonb_build_object('cambios', v_cambios, 'tercero', new.razon_social));
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_tercero_pide_revision on public.terceros;
create trigger trg_tercero_pide_revision
  after update on public.terceros
  for each row execute function public._tercero_pide_revision();

-- Revisión abierta de un proveedor o contratista (para su ventana). null = no hay.
create or replace function public.revision_tercero(p_entidad text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if auth.uid() is null then
    raise exception 'No autenticado.';
  end if;
  if p_entidad = 'proveedor' and not (public.tiene_pestana(auth.uid(), 'almacen.proveedores')
       or public.tiene_accion(auth.uid(), 'comprar') or public.tiene_accion(auth.uid(), 'revisar_proveedores')) then
    return null;
  end if;
  if p_entidad = 'contratista' and not (public.tiene_pestana(auth.uid(), 'contratos.contratistas')
       or public.tiene_accion(auth.uid(), 'solicitar_contratos') or public.tiene_accion(auth.uid(), 'gestionar_contratistas')) then
    return null;
  end if;
  select jsonb_build_object('cambios', rv.cambios, 'desde', rv.creado_en, 'pedida_por', pf.nombre)
    into v
    from revisiones_tercero rv
    left join perfiles pf on pf.id = rv.pedida_por
   where rv.entidad = p_entidad and rv.entidad_id = p_id and rv.revisado_en is null;
  return v;
end;
$$;

-- Ids en revisión (para marcar la lista y el selector de la OC).
create or replace function public.en_revision_tercero(p_entidad text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select entidad_id from revisiones_tercero
   where entidad = p_entidad and revisado_en is null and auth.uid() is not null
$$;

create or replace function public.marcar_revisado_tercero(p_entidad text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creador uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado.';
  end if;
  if p_entidad = 'proveedor' then
    if not public.tiene_accion(auth.uid(), 'revisar_proveedores') then
      raise exception 'No tienes permiso para revisar proveedores (acción Revisar proveedores).';
    end if;
  elsif p_entidad = 'contratista' then
    select created_by into v_creador from contratistas where id = p_id;
    if v_creador is distinct from auth.uid() and not public.tiene_accion(auth.uid(), 'gestionar_contratistas') then
      raise exception 'Solo quien creó el contratista (o quien gestiona contratistas) lo marca como revisado.';
    end if;
  else
    raise exception 'Tipo no válido.';
  end if;
  update revisiones_tercero
     set revisado_en = now(), revisado_por = auth.uid()
   where entidad = p_entidad and entidad_id = p_id and revisado_en is null;
  if not found then
    raise exception 'No hay nada por revisar (ya lo revisaron).';
  end if;
  perform public._anotar_historial(p_entidad, p_id, 'revisado', null);
end;
$$;

revoke all on function public._en_revision_tercero(text, uuid) from public;
revoke all on function public._etiqueta_campo_tercero(text) from public;
revoke all on function public._tercero_pide_revision() from public;
revoke all on function public.revision_tercero(text, uuid) from public;
revoke all on function public.en_revision_tercero(text) from public;
revoke all on function public.marcar_revisado_tercero(text, uuid) from public;
grant execute on function public.revision_tercero(text, uuid) to authenticated;
grant execute on function public.en_revision_tercero(text) to authenticated;
grant execute on function public.marcar_revisado_tercero(text, uuid) to authenticated;

-- Acción nueva para Compras y Líder Compras.
insert into public.rol_permisos (rol_id, permiso)
select r.id, 'accion.revisar_proveedores' from public.roles r
 where r.clave in ('compras', 'lider_compras')
   and not exists (select 1 from public.rol_permisos rp where rp.rol_id = r.id and rp.permiso = 'accion.revisar_proveedores');

-- ------------------------------------------------------------ 3. Bloqueo de lo nuevo
select pg_temp._parche(
  'public.crear_orden_compra_con_soporte(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, numeric, text, date, jsonb, jsonb, text, date)'::regprocedure,
$a$    raise exception 'Ese archivo ya es soporte de otra orden. Vuelve a adjuntarlo.';
  end if;

  v_id := public.crear_orden_compra($a$,
$b$    raise exception 'Ese archivo ya es soporte de otra orden. Vuelve a adjuntarlo.';
  end if;
  if public._en_revision_tercero('proveedor', p_proveedor_id) then
    raise exception 'El proveedor está en revisión: Financiera cambió su tercero. Compras tiene que revisarlo (Proveedores) antes de hacerle órdenes nuevas.';
  end if;

  v_id := public.crear_orden_compra($b$);

select pg_temp._parche(
  'public.modificar_orden_compra(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, text, date, numeric, text, date, jsonb, jsonb)'::regprocedure,
$a$    raise exception 'Elige el proveedor de la orden.';
  end if;$a$,
$b$    raise exception 'Elige el proveedor de la orden.';
  end if;
  if p_proveedor_id is distinct from v_o.proveedor_id and public._en_revision_tercero('proveedor', p_proveedor_id) then
    raise exception 'Ese proveedor está en revisión: Financiera cambió su tercero. Compras tiene que revisarlo antes de usarlo.';
  end if;$b$);

select pg_temp._parche('public._guardar_contrato_general(uuid, jsonb, jsonb, boolean)'::regprocedure,
$a$  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para elaborar contratos.';
  end if;$a$,
$b$  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para elaborar contratos.';
  end if;
  if not p_existente and public._en_revision_tercero('contratista', nullif(p_datos->>'contratista_id', '')::uuid) then
    raise exception 'El contratista está en revisión: Financiera cambió su tercero. Quien lo creó tiene que revisarlo antes de hacerle contratos nuevos.';
  end if;$b$);

select pg_temp._parche(
  'public._guardar_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, boolean)'::regprocedure,
$a$  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para solicitar contratos.';
  end if;$a$,
$b$  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para solicitar contratos.';
  end if;
  if not p_existente and public._en_revision_tercero('contratista', nullif(p_datos->>'contratista_id', '')::uuid) then
    raise exception 'El contratista está en revisión: Financiera cambió su tercero. Quien lo creó tiene que revisarlo antes de hacerle contratos nuevos.';
  end if;$b$);

-- ------------------------------------------------------------ Mis pendientes
select pg_temp._parche('public._pendientes_de(uuid)'::regprocedure,
$a$  -- ------------------------------------------------ Soportes de cuadros de SINCO (20270101002800)$a$,
$b$  -- ------------------------------------------------ Proveedores y contratistas en revisión (20270101006100)
  union all
  select 'proveedor_en_revision', 'hacer', rv.id, null::uuid,
         pv.nombre,
         'Su tercero cambió (' || (select string_agg(public._etiqueta_campo_tercero(k), ', ') from jsonb_object_keys(rv.cambios) k)
           || '): verifica los datos del proveedor',
         null::numeric, rv.actualizado_en, rv.pedida_por, null::date, '/almacen/proveedores?revisar=' || pv.unique_id
    from revisiones_tercero rv
    join proveedores pv on pv.unique_id = rv.entidad_id
   where rv.entidad = 'proveedor' and rv.revisado_en is null
     and (select public.tiene_accion(p_uid, 'revisar_proveedores'))
  union all
  select 'contratista_en_revision', 'hacer', rv.id, null::uuid,
         ct.nombre,
         'Su tercero cambió (' || (select string_agg(public._etiqueta_campo_tercero(k), ', ') from jsonb_object_keys(rv.cambios) k)
           || '): verifica los datos del contratista',
         null::numeric, rv.actualizado_en, rv.pedida_por, null::date, '/contratos/contratistas?revisar=' || ct.id
    from revisiones_tercero rv
    join contratistas ct on ct.id = rv.entidad_id
   where rv.entidad = 'contratista' and rv.revisado_en is null
     and (ct.created_by = p_uid
          or (ct.created_by is null and (select public.tiene_accion(p_uid, 'gestionar_contratistas'))))

  -- ------------------------------------------------ Soportes de cuadros de SINCO (20270101002800)$b$);

-- ------------------------------------------------------------ 4. NIT -> otro tipo: el proveedor lo sigue
create or replace function public._tercero_a_proveedor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (new.tipo_documento, new.numero_documento, new.razon_social, new.correo, new.telefono, new.direccion, new.ciudad)
     is distinct from (old.tipo_documento, old.numero_documento, old.razon_social, old.correo, old.telefono, old.direccion, old.ciudad) then
    if old.tipo_documento = 'NIT' and new.tipo_documento is distinct from 'NIT' then
      -- El tercero dejó de ser NIT (estaba mal creado): el proveedor sigue su tipo nuevo.
      update public.proveedores set tipo_documento = new.tipo_documento where tercero_id = new.id;
    else
      update public.proveedores set tercero_id = tercero_id where tercero_id = new.id;
    end if;
  end if;
  return null;
end;
$function$;

commit;
