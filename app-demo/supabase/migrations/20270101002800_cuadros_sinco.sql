-- Cuadros de pagos de SINCO (decisiones del usuario, 2026-11-12). Temporal: mientras
-- los proyectos que siguen en SINCO terminen (6-8 meses).
--
-- Los pagos se aprueban en SINCO; Financiera descarga el cuadro (GF-F-018: el de
-- compras con varios proyectos o el de un proyecto) y lo sube a 360:
-- * Cada fila queda en el cuadro (sinco_cuadros / sinco_filas) y crea su pago YA
--   APROBADO en Preparación del Consolidado Bogotá (fuente 'sinco'), con la semana
--   de hoy.
-- * Todos los proyectos del cuadro deben existir en 360 (proyectos "solo pagos" con
--   el número de SINCO); si falta uno, no se carga nada. El código se reconoce con
--   o sin el número adelante y con "$" o "&" ("112-900-CS-CUND-C$C CUND" =
--   "900-CS-CUND-C&C CUND").
-- * Quien factura y el titular se buscan en Terceros por documento; si no existen
--   se crean, y la cuenta queda PENDIENTE de verificar.
-- * Una fila que ya se cargó (mismo proyecto, documento, factura y total, pago no
--   anulado) se salta.
-- * Financiera elige a quién le llega el aviso (siempre también por correo, aunque
--   la persona no tenga los avisos por correo): esas personas abren el cuadro y
--   adjuntan el soporte (factura o cuenta de cobro) de cada pago. Sin soporte el
--   pago no pasa a liquidar (como sin cuenta). Les sale en Mis pendientes.
-- * Se puede anular un cuadro mientras ninguno de sus pagos se haya enviado a liquidar.
--
-- Acción nueva cargar_cuadros_sinco (Financiera) y pestaña ayf.cuadros_sinco.
-- Parches por texto exacto sobre funciones vivas (fallan si no encuentran el texto;
-- no se aplican dos veces). Reversa en supabase/reversa/20270101002800_cuadros_sinco.sql.

begin;
set local lock_timeout = '10s';
lock table public.pagos, public.notificaciones in access exclusive mode;

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $$
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
$$;

-- 1. Tablas -------------------------------------------------------------------------
create table if not exists public.sinco_cuadros (
  id uuid primary key default gen_random_uuid(),
  numero integer generated always as identity unique,
  archivo text not null,
  cargado_por uuid not null references public.perfiles(id),
  cargado_en timestamptz not null default now(),
  filas integer not null default 0,
  total numeric not null default 0,
  anulado_en timestamptz,
  anulado_por uuid references public.perfiles(id),
  motivo_anulacion text
);

create table if not exists public.sinco_cuadro_usuarios (
  cuadro_id uuid not null references public.sinco_cuadros(id) on delete cascade,
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  agregado_en timestamptz not null default now(),
  primary key (cuadro_id, usuario_id)
);
create index if not exists sinco_cuadro_usuarios_usuario on public.sinco_cuadro_usuarios (usuario_id);

create table if not exists public.sinco_filas (
  id uuid primary key default gen_random_uuid(),
  cuadro_id uuid not null references public.sinco_cuadros(id) on delete cascade,
  orden integer not null,
  item integer,
  proyecto_id uuid not null references public.proyectos(id),
  proyecto_texto text,
  grupo_empresarial text,
  factura_nombre text not null,
  factura_documento text not null,
  titular_nombre text,
  titular_documento text,
  banco text,
  tipo_cuenta text,
  numero_cuenta text,
  numero_factura text,
  concepto text,
  valor_documento numeric,
  base numeric,
  iva numeric,
  anticipos numeric,
  total numeric not null check (total > 0),
  observaciones text,
  solicita text,
  soporte_ruta text,
  soporte_nombre text,
  soporte_mime text,
  soporte_subido_en timestamptz,
  soporte_subido_por uuid references public.perfiles(id)
);
create index if not exists sinco_filas_cuadro on public.sinco_filas (cuadro_id, orden);
create index if not exists sinco_filas_repetida on public.sinco_filas (proyecto_id, factura_documento, numero_factura);
create index if not exists sinco_filas_sin_soporte on public.sinco_filas (cuadro_id) where soporte_ruta is null;

alter table public.pagos add column if not exists sinco_fila_id uuid references public.sinco_filas(id);
create unique index if not exists pagos_sinco_fila on public.pagos (sinco_fila_id) where sinco_fila_id is not null;

alter table public.pagos drop constraint if exists pagos_fuente_check;
alter table public.pagos add constraint pagos_fuente_check
  check (fuente = any (array['orden_compra', 'acta', 'requisicion_admin', 'sinco']));
alter table public.pagos drop constraint if exists pagos_fuente_coherente;
alter table public.pagos add constraint pagos_fuente_coherente check (
  ((fuente = 'orden_compra') = (orden_compra_id is not null))
  and ((fuente = 'acta') = (acta_id is not null))
  and ((fuente = 'requisicion_admin') = (requisicion_admin_id is not null))
  and ((fuente = 'sinco') = (sinco_fila_id is not null)));

-- 2. Permisos: acción y pestaña de Financiera ---------------------------------------
insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
  from public.roles r
 cross join (values ('tab.ayf.cuadros_sinco'), ('accion.cargar_cuadros_sinco')) as p(permiso)
 where r.clave = 'financiera'
on conflict do nothing;

-- Cuadros que ve una persona: todos con la acción; si no, los que le asignaron.
create or replace function public._cuadros_sinco_visibles(p_uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id from public.sinco_cuadros c where public.tiene_accion(p_uid, 'cargar_cuadros_sinco')
  union
  select u.cuadro_id from public.sinco_cuadro_usuarios u
   where u.usuario_id = p_uid and not public.tiene_accion(p_uid, 'cargar_cuadros_sinco')
$$;
revoke all on function public._cuadros_sinco_visibles(uuid) from public, anon;
grant execute on function public._cuadros_sinco_visibles(uuid) to authenticated;  -- se usa en políticas

alter table public.sinco_cuadros enable row level security;
alter table public.sinco_cuadro_usuarios enable row level security;
alter table public.sinco_filas enable row level security;

drop policy if exists sinco_cuadros_select on public.sinco_cuadros;
create policy sinco_cuadros_select on public.sinco_cuadros for select to authenticated
  using (id in (select public._cuadros_sinco_visibles((select auth.uid())))
         or id in (select f.cuadro_id from public.sinco_filas f
                    where f.id in (select g.sinco_fila_id from public.pagos g where g.sinco_fila_id is not null)));
drop policy if exists sinco_cuadro_usuarios_select on public.sinco_cuadro_usuarios;
create policy sinco_cuadro_usuarios_select on public.sinco_cuadro_usuarios for select to authenticated
  using (cuadro_id in (select public._cuadros_sinco_visibles((select auth.uid()))));
-- Las filas: las del cuadro que ve, o la de un pago que ve (A&F: soporte del pago).
drop policy if exists sinco_filas_select on public.sinco_filas;
create policy sinco_filas_select on public.sinco_filas for select to authenticated
  using (cuadro_id in (select public._cuadros_sinco_visibles((select auth.uid())))
         or id in (select g.sinco_fila_id from public.pagos g where g.sinco_fila_id is not null));
grant select on public.sinco_cuadros, public.sinco_cuadro_usuarios, public.sinco_filas to authenticated;

-- 3. Soportes (bucket sinco, <cuadro>/<fila>/archivo) --------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sinco', 'sinco', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists sinco_soportes_insert on storage.objects;
create policy sinco_soportes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'sinco'
              and (storage.foldername(name))[1] in (select c::text from public._cuadros_sinco_visibles((select auth.uid())) c));
-- Borrar: solo lo que subió y no quedó como soporte (si guardar falla).
drop policy if exists sinco_soportes_delete on storage.objects;
create policy sinco_soportes_delete on storage.objects for delete to authenticated
  using (bucket_id = 'sinco' and owner_id = (select auth.uid())::text
         and name not in (select f.soporte_ruta from public.sinco_filas f where f.soporte_ruta is not null));
drop policy if exists sinco_soportes_select on storage.objects;
create policy sinco_soportes_select on storage.objects for select to authenticated
  using (bucket_id = 'sinco'
         and ((storage.foldername(name))[1] in (select c::text from public._cuadros_sinco_visibles((select auth.uid())) c)
              or name in (select f.soporte_ruta from public.sinco_filas f where f.soporte_ruta is not null)));

-- 4. Pagos: fuente 'sinco' ----------------------------------------------------------
-- No toman empresa ni consolidado del proyecto: van al Consolidado Bogotá.
select pg_temp._parche('public._pago_sincronizar_empresa(uuid)'::regprocedure,
  $a$and p.fuente <> 'requisicion_admin'$a$,
  $b$and p.fuente not in ('requisicion_admin', 'sinco')$b$);

-- Novedad: falta el soporte.
select pg_temp._parche('public._pago_novedad(uuid)'::regprocedure,
  $a$  left join public.contratos ct on ct.id = ac.contrato_id
$a$,
  $b$  left join public.contratos ct on ct.id = ac.contrato_id
  left join public.sinco_filas sf on sf.id = p.sinco_fila_id
$b$);
select pg_temp._parche('public._pago_novedad(uuid)'::regprocedure,
  $a$    case when p.cuenta_modificada is not null$a$,
  $b$    case when p.sinco_fila_id is not null and sf.soporte_ruta is null
      then 'Falta el soporte (factura o cuenta de cobro) del cuadro de SINCO.' end,
    case when p.cuenta_modificada is not null$b$);

-- Sin soporte no pasa a liquidar.
select pg_temp._parche('public.enviar_pagos_a_liquidar(uuid[])'::regprocedure,
  $a$         and (g.cuenta_tercero_id is not null or public.pago_es_pse(g))
$a$,
  $b$         and (g.cuenta_tercero_id is not null or public.pago_es_pse(g))
         and (g.sinco_fila_id is null
              or g.sinco_fila_id in (select f.id from public.sinco_filas f where f.soporte_ruta is not null))
$b$);

create or replace function public.enviar_pagos_a_liquidar_detalle(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sin_cuenta integer;
  v_sin_soporte integer;
  v_n integer;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para gestionar pagos.';
  end if;
  select count(*) filter (where g.cuenta_tercero_id is null and not public.pago_es_pse(g)),
         count(*) filter (where (g.cuenta_tercero_id is not null or public.pago_es_pse(g))
                            and g.sinco_fila_id is not null
                            and not exists (select 1 from public.sinco_filas f
                                             where f.id = g.sinco_fila_id and f.soporte_ruta is not null))
    into v_sin_cuenta, v_sin_soporte
    from public.pagos g
   where g.id = any (coalesce(p_ids, '{}'))
     and g.estado = 'aprobado' and g.liquidacion_estado is null and g.semana is not null
     and (public.tiene_pestana(auth.uid(), 'ayf.aprobacion_pagos')
          or g.consolidado_id in (select public._consolidados_visibles(auth.uid())));
  v_n := public.enviar_pagos_a_liquidar(p_ids);
  return jsonb_build_object('enviados', v_n, 'sin_cuenta', v_sin_cuenta, 'sin_soporte', v_sin_soporte);
end;
$$;
revoke all on function public.enviar_pagos_a_liquidar_detalle(uuid[]) from public, anon;
grant execute on function public.enviar_pagos_a_liquidar_detalle(uuid[]) to authenticated;

-- 5. Avisos: tipo y entidad nuevos (se agregan a la lista viva) -----------------------
do $$
declare
  d text;
begin
  select pg_get_constraintdef(oid) into d from pg_constraint where conname = 'notificaciones_tipo_check';
  if d is not null and position('cuadro_sinco_soportes' in d) = 0 then
    execute 'alter table public.notificaciones drop constraint notificaciones_tipo_check';
    execute 'alter table public.notificaciones add constraint notificaciones_tipo_check '
            || replace(replace(d, ' NOT VALID', ''), 'ARRAY[', 'ARRAY[''cuadro_sinco_soportes''::text, ') || ' not valid';
  end if;
  select pg_get_constraintdef(oid) into d from pg_constraint where conname = 'notificaciones_entidad_tipo_check';
  if d is not null and position('cuadro_sinco' in d) = 0 then
    execute 'alter table public.notificaciones drop constraint notificaciones_entidad_tipo_check';
    execute 'alter table public.notificaciones add constraint notificaciones_entidad_tipo_check '
            || replace(replace(d, ' NOT VALID', ''), 'ARRAY[', 'ARRAY[''cuadro_sinco''::text, ') || ' not valid';
  end if;
end;
$$;

-- Este aviso va por correo siempre (aunque la persona no tenga los avisos por correo).
update public.ajustes_correo set tipos = array_append(tipos, 'cuadro_sinco_soportes')
 where id and not ('cuadro_sinco_soportes' = any (tipos));
select pg_temp._parche('public._encolar_correo_notificacion()'::regprocedure,
  $a$where p.id = new.usuario_id and p.correo_avisos = 'inmediato';$a$,
  $b$where p.id = new.usuario_id and (p.correo_avisos = 'inmediato' or new.tipo = 'cuadro_sinco_soportes');$b$);

create or replace function public._avisar_cuadro_sinco(p_cuadro uuid, p_usuarios uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c record;
  v_proys text;
  v_quien text;
begin
  select c.*, (select count(*) from public.sinco_filas f where f.cuadro_id = c.id) as n into v_c
    from public.sinco_cuadros c where c.id = p_cuadro;
  select string_agg(distinct public._numero_proyecto(f.proyecto_id) || ' ' || p.codigo, ', ') into v_proys
    from public.sinco_filas f join public.proyectos p on p.id = f.proyecto_id where f.cuadro_id = p_cuadro;
  select nombre into v_quien from public.perfiles where id = auth.uid();
  insert into public.notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  select u, 'cuadro_sinco_soportes', 'cuadro_sinco', p_cuadro,
         'Adjunta los soportes del cuadro de SINCO N° ' || v_c.numero,
         coalesce(v_quien, 'Financiera') || ' cargó el cuadro ' || v_c.archivo || ' (' || v_c.n
           || case when v_c.n = 1 then ' pago' else ' pagos' end || ' de ' || coalesce(v_proys, '—')
           || '). Entra y adjunta la factura o cuenta de cobro de cada pago: sin soporte no se puede pagar.'
    from unnest(p_usuarios) u
   where exists (select 1 from public.perfiles p where p.id = u);
end;
$$;
revoke all on function public._avisar_cuadro_sinco(uuid, uuid[]) from public, anon, authenticated;

-- 6. Cargar el cuadro ----------------------------------------------------------------
create or replace function public._norm_texto_sinco(p text)
returns text
language sql
immutable
as $$
  select nullif(btrim(regexp_replace(upper(translate(coalesce(p, ''), '$ÁÉÍÓÚÜÑáéíóúüñ', '&AEIOUUNaeiouun')), '\s+', ' ', 'g')), '')
$$;

create or replace function public._norm_banco_sinco(p text)
returns text
language sql
immutable
as $$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(
           public._norm_texto_sinco(p), '[ ,]+S\.?\s?A\.?S?\.?$', ''), '^(APP|BANCO) ', ''), '\.', '', 'g')), '')
$$;

-- p_filas: [{orden, item, proyecto, grupo, factura_nombre, factura_documento, tipo_documento,
--   titular_nombre, titular_documento, titular_tipo_documento, banco, tipo_cuenta, numero_cuenta,
--   numero_factura, concepto, valor_documento, base, iva, anticipos, total, observaciones, solicita}]
-- p_confirmar = false: solo revisa y devuelve el resumen (no escribe nada).
create or replace function public.cargar_cuadro_sinco(p_archivo text, p_filas jsonb, p_usuarios uuid[], p_confirmar boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bogota uuid;
  v_proys jsonb;
  v_bancos jsonb;
  v_f jsonb;
  v_errores jsonb := '[]';
  v_avisos jsonb := '[]';
  v_repetidas jsonb := '[]';
  v_vistas text[] := '{}';
  v_clave text;
  v_proy uuid;
  v_doc text;
  v_tit_doc text;
  v_total numeric;
  v_banco uuid;
  v_tipo_cuenta text;
  v_num_cuenta text;
  v_cuadro uuid;
  v_fila uuid;
  v_pago uuid;
  v_tercero uuid;
  v_titular uuid;
  v_cuenta uuid;
  v_empresa uuid;
  v_n integer := 0;
  v_suma numeric := 0;
  v_terceros_nuevos integer := 0;
  v_cuentas_nuevas integer := 0;
  v_docs_nuevos text[] := '{}';
  v_cuentas_vistas text[] := '{}';
  v_por_proyecto jsonb := '{}';
begin
  if not public.tiene_accion(v_uid, 'cargar_cuadros_sinco') then
    raise exception 'No autorizado -- no tienes permiso para cargar cuadros de SINCO.';
  end if;
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'El cuadro no tiene pagos.';
  end if;
  if jsonb_array_length(p_filas) > 1000 then
    raise exception 'Como mucho 1000 pagos por cuadro.';
  end if;
  if btrim(coalesce(p_archivo, '')) = '' then
    raise exception 'Falta el nombre del archivo.';
  end if;
  select id into v_bogota from public.consolidados where clave = 'bogota';
  if v_bogota is null then
    raise exception 'No existe el Consolidado Bogotá.';
  end if;

  -- Proyectos: por código y por número-código, con "$" = "&" y sin tildes.
  select coalesce(jsonb_object_agg(k, id), '{}') into v_proys
    from (select public._norm_texto_sinco(codigo) k, id from public.proyectos
          union all
          select public._norm_texto_sinco(public._con_ceros(numero, 3) || '-' || codigo), id from public.proyectos) x
   where k is not null;
  select coalesce(jsonb_object_agg(k, id), '{}') into v_bancos
    from (select distinct on (public._norm_banco_sinco(nombre)) public._norm_banco_sinco(nombre) k, id
            from public.bancos where activo order by public._norm_banco_sinco(nombre), nombre) x
   where k is not null;

  -- Revisión (nada se escribe).
  for v_f in select value from jsonb_array_elements(p_filas) loop
    v_clave := public._norm_texto_sinco(v_f->>'proyecto');
    v_proy := (v_proys->>v_clave)::uuid;
    v_doc := regexp_replace(coalesce(v_f->>'factura_documento', ''), '\D', '', 'g');
    v_total := nullif(v_f->>'total', '')::numeric;
    if v_proy is null then
      v_errores := v_errores || jsonb_build_object('orden', v_f->'orden',
        'mensaje', 'El proyecto "' || coalesce(v_f->>'proyecto', '') || '" no existe en 360.');
      continue;
    end if;
    if v_doc = '' then
      v_errores := v_errores || jsonb_build_object('orden', v_f->'orden', 'mensaje', 'Falta el NIT de quien factura.');
      continue;
    end if;
    if v_total is null or v_total <= 0 then
      v_errores := v_errores || jsonb_build_object('orden', v_f->'orden', 'mensaje', 'El total debe ser mayor que 0.');
      continue;
    end if;
    if btrim(coalesce(v_f->>'factura_nombre', '')) = '' then
      v_errores := v_errores || jsonb_build_object('orden', v_f->'orden', 'mensaje', 'Falta el nombre de quien factura.');
      continue;
    end if;
    -- Repetida: ya cargada (pago no anulado) o dos veces en el mismo archivo.
    v_clave := v_proy::text || '|' || v_doc || '|' || coalesce(public._norm_texto_sinco(v_f->>'numero_factura'), '') || '|' || v_total::text;
    if public._norm_texto_sinco(v_f->>'numero_factura') is not null
       and (v_clave = any (v_vistas)
            or exists (select 1 from public.sinco_filas f join public.pagos g on g.sinco_fila_id = f.id
                        where f.proyecto_id = v_proy and f.factura_documento = v_doc
                          and public._norm_texto_sinco(f.numero_factura) = public._norm_texto_sinco(v_f->>'numero_factura')
                          and f.total = v_total and g.estado <> 'anulado')) then
      v_repetidas := v_repetidas || jsonb_build_object('orden', v_f->'orden',
        'mensaje', 'Ya está cargado: ' || coalesce(v_f->>'factura_nombre', '') || ', factura ' || coalesce(v_f->>'numero_factura', ''));
      continue;
    end if;
    v_vistas := v_vistas || v_clave;
    v_n := v_n + 1;
    v_suma := v_suma + v_total;
    v_por_proyecto := jsonb_set(v_por_proyecto, array[v_proy::text],
      jsonb_build_object('pagos', coalesce((v_por_proyecto->v_proy::text->>'pagos')::int, 0) + 1,
                         'total', coalesce((v_por_proyecto->v_proy::text->>'total')::numeric, 0) + v_total));
    -- Terceros y cuentas que se crearían.
    v_tit_doc := coalesce(nullif(regexp_replace(coalesce(v_f->>'titular_documento', ''), '\D', '', 'g'), ''), v_doc);
    foreach v_clave in array array[v_doc, v_tit_doc] loop
      if not (v_clave = any (v_docs_nuevos)) and not exists (select 1 from public.terceros t where t.numero_documento = v_clave) then
        v_docs_nuevos := v_docs_nuevos || v_clave;
      end if;
    end loop;
    v_num_cuenta := nullif(regexp_replace(coalesce(v_f->>'numero_cuenta', ''), '\D', '', 'g'), '');
    v_banco := (v_bancos->>public._norm_banco_sinco(v_f->>'banco'))::uuid;
    v_tipo_cuenta := case when public._norm_texto_sinco(v_f->>'tipo_cuenta') like '%AHORRO%' then 'AHORROS'
                          when public._norm_texto_sinco(v_f->>'tipo_cuenta') like '%CORRIENTE%' then 'CORRIENTE' end;
    if v_num_cuenta is null then
      v_avisos := v_avisos || jsonb_build_object('orden', v_f->'orden',
        'mensaje', coalesce(v_f->>'factura_nombre', '') || ': sin cuenta bancaria en el cuadro (el pago queda sin cuenta).');
    elsif v_banco is null or v_tipo_cuenta is null then
      v_avisos := v_avisos || jsonb_build_object('orden', v_f->'orden',
        'mensaje', coalesce(v_f->>'factura_nombre', '') || ': no se reconoce el banco "' || coalesce(v_f->>'banco', '')
                   || '" o el tipo de cuenta (el pago queda sin cuenta).');
    elsif not ((v_tit_doc || '|' || v_banco::text || '|' || v_num_cuenta) = any (v_cuentas_vistas))
          and not exists (select 1 from public.terceros_cuentas c join public.terceros t on t.id = c.tercero_id
                           where t.numero_documento = v_tit_doc and c.banco_id = v_banco and c.numero_cuenta = v_num_cuenta) then
      v_cuentas_vistas := v_cuentas_vistas || (v_tit_doc || '|' || v_banco::text || '|' || v_num_cuenta);
    end if;
  end loop;
  v_terceros_nuevos := coalesce(array_length(v_docs_nuevos, 1), 0);
  v_cuentas_nuevas := coalesce(array_length(v_cuentas_vistas, 1), 0);

  if jsonb_array_length(v_errores) > 0 or v_n = 0 or not p_confirmar then
    return jsonb_build_object(
      'errores', v_errores, 'avisos', v_avisos, 'repetidas', v_repetidas,
      'pagos', v_n, 'total', v_suma, 'terceros_nuevos', v_terceros_nuevos, 'cuentas_nuevas', v_cuentas_nuevas,
      'por_proyecto', (select coalesce(jsonb_agg(jsonb_build_object(
                         'proyecto', public._numero_proyecto(p.id) || ' ' || p.codigo,
                         'pagos', (v_por_proyecto->p.id::text->>'pagos')::int,
                         'total', (v_por_proyecto->p.id::text->>'total')::numeric) order by p.numero), '[]')
                         from public.proyectos p where v_por_proyecto ? p.id::text),
      'cuadro_id', null);
  end if;

  if coalesce(array_length(p_usuarios, 1), 0) = 0 then
    raise exception 'Elige al menos una persona para que adjunte los soportes.';
  end if;

  -- Carga.
  insert into public.sinco_cuadros (archivo, cargado_por, filas, total)
  values (btrim(p_archivo), v_uid, v_n, v_suma) returning id into v_cuadro;
  insert into public.sinco_cuadro_usuarios (cuadro_id, usuario_id)
  select distinct v_cuadro, u from unnest(p_usuarios) u where exists (select 1 from public.perfiles p where p.id = u);

  v_vistas := '{}';
  for v_f in select value from jsonb_array_elements(p_filas) loop
    v_proy := (v_proys->>public._norm_texto_sinco(v_f->>'proyecto'))::uuid;
    v_doc := regexp_replace(coalesce(v_f->>'factura_documento', ''), '\D', '', 'g');
    v_total := (v_f->>'total')::numeric;
    v_clave := v_proy::text || '|' || v_doc || '|' || coalesce(public._norm_texto_sinco(v_f->>'numero_factura'), '') || '|' || v_total::text;
    if public._norm_texto_sinco(v_f->>'numero_factura') is not null
       and (v_clave = any (v_vistas)
            or exists (select 1 from public.sinco_filas f join public.pagos g on g.sinco_fila_id = f.id
                        where f.proyecto_id = v_proy and f.factura_documento = v_doc
                          and public._norm_texto_sinco(f.numero_factura) = public._norm_texto_sinco(v_f->>'numero_factura')
                          and f.total = v_total and g.estado <> 'anulado')) then
      continue;
    end if;
    v_vistas := v_vistas || v_clave;

    -- Quien factura.
    select id into v_tercero from public.terceros where numero_documento = v_doc;
    if v_tercero is null then
      insert into public.terceros (tipo_documento, numero_documento, razon_social, observaciones)
      values (case upper(btrim(coalesce(v_f->>'tipo_documento', '')))
                when 'CC' then 'CC' when 'CE' then 'CE' when 'PT' then 'PPT' when 'PPT' then 'PPT' when 'PA' then 'PA'
                else 'NIT' end,
              v_doc, upper(btrim(v_f->>'factura_nombre')), 'Creado desde un cuadro de SINCO.')
      returning id into v_tercero;
    end if;
    -- Titular de la cuenta (si es otro documento).
    v_tit_doc := coalesce(nullif(regexp_replace(coalesce(v_f->>'titular_documento', ''), '\D', '', 'g'), ''), v_doc);
    v_titular := null;
    if v_tit_doc <> v_doc then
      select id into v_titular from public.terceros where numero_documento = v_tit_doc;
      if v_titular is null then
        insert into public.terceros (tipo_documento, numero_documento, razon_social, observaciones)
        values (case upper(btrim(coalesce(v_f->>'titular_tipo_documento', '')))
                  when 'CC' then 'CC' when 'CE' then 'CE' when 'PT' then 'PPT' when 'PPT' then 'PPT' when 'PA' then 'PA'
                  else 'NIT' end,
                v_tit_doc, upper(btrim(coalesce(nullif(v_f->>'titular_nombre', ''), v_f->>'factura_nombre'))),
                'Creado desde un cuadro de SINCO.')
        returning id into v_titular;
      end if;
    end if;
    -- Cuenta (del titular), PENDIENTE si es nueva.
    v_cuenta := null;
    v_num_cuenta := nullif(regexp_replace(coalesce(v_f->>'numero_cuenta', ''), '\D', '', 'g'), '');
    v_banco := (v_bancos->>public._norm_banco_sinco(v_f->>'banco'))::uuid;
    v_tipo_cuenta := case when public._norm_texto_sinco(v_f->>'tipo_cuenta') like '%AHORRO%' then 'AHORROS'
                          when public._norm_texto_sinco(v_f->>'tipo_cuenta') like '%CORRIENTE%' then 'CORRIENTE' end;
    if v_num_cuenta is not null and v_banco is not null and v_tipo_cuenta is not null then
      select id into v_cuenta from public.terceros_cuentas
       where tercero_id = coalesce(v_titular, v_tercero) and banco_id = v_banco and numero_cuenta = v_num_cuenta;
      if v_cuenta is null then
        insert into public.terceros_cuentas (tercero_id, banco_id, tipo_cuenta, numero_cuenta, estado, observaciones)
        values (coalesce(v_titular, v_tercero), v_banco, v_tipo_cuenta, v_num_cuenta, 'PENDIENTE', 'Desde un cuadro de SINCO.')
        returning id into v_cuenta;
      end if;
    end if;

    insert into public.sinco_filas (cuadro_id, orden, item, proyecto_id, proyecto_texto, grupo_empresarial,
                                    factura_nombre, factura_documento, titular_nombre, titular_documento,
                                    banco, tipo_cuenta, numero_cuenta, numero_factura, concepto,
                                    valor_documento, base, iva, anticipos, total, observaciones, solicita)
    values (v_cuadro, (v_f->>'orden')::int, nullif(v_f->>'item', '')::numeric::int, v_proy, v_f->>'proyecto',
            nullif(btrim(v_f->>'grupo'), ''), btrim(v_f->>'factura_nombre'), v_doc,
            nullif(btrim(v_f->>'titular_nombre'), ''), v_tit_doc,
            nullif(btrim(v_f->>'banco'), ''), nullif(btrim(v_f->>'tipo_cuenta'), ''), v_num_cuenta,
            nullif(btrim(v_f->>'numero_factura'), ''), nullif(btrim(v_f->>'concepto'), ''),
            nullif(v_f->>'valor_documento', '')::numeric, nullif(v_f->>'base', '')::numeric,
            nullif(v_f->>'iva', '')::numeric, nullif(v_f->>'anticipos', '')::numeric, v_total,
            nullif(btrim(v_f->>'observaciones'), ''), nullif(btrim(v_f->>'solicita'), ''))
    returning id into v_fila;

    select empresa_id into v_empresa from public.proyectos where id = v_proy;
    insert into public.pagos (fuente, sinco_fila_id, tipo, proyecto_id, empresa_id, consolidado_id,
                              tercero_id, cuenta_tercero_id, titular_tercero_id, concepto, numero_factura,
                              valor, valor_documento, base_gravable, iva, descuento_anticipos,
                              retencion_garantia, otros_descuentos,
                              estado, solicitado_en, aprobado_por, aprobado_en)
    values ('sinco', v_fila, 'unico', v_proy, v_empresa, v_bogota,
            v_tercero, v_cuenta, v_titular,
            upper(left('SINCO N° ' || (select numero from public.sinco_cuadros where id = v_cuadro)
                       || coalesce(' - ' || nullif(btrim(v_f->>'concepto'), ''), '')
                       || coalesce(' - ' || nullif(btrim(v_f->>'observaciones'), ''), ''), 500)),
            nullif(btrim(v_f->>'numero_factura'), ''),
            v_total, coalesce(nullif(v_f->>'valor_documento', '')::numeric, v_total),
            nullif(v_f->>'base', '')::numeric, nullif(v_f->>'iva', '')::numeric,
            coalesce(nullif(v_f->>'anticipos', '')::numeric, 0), 0, 0,
            'aprobado', now(), v_uid, now())
    returning id into v_pago;
    perform public._pago_asignar_item(v_pago);
  end loop;

  perform public._avisar_cuadro_sinco(v_cuadro, p_usuarios);

  return jsonb_build_object(
    'errores', '[]'::jsonb, 'avisos', v_avisos, 'repetidas', v_repetidas,
    'pagos', v_n, 'total', v_suma, 'terceros_nuevos', v_terceros_nuevos, 'cuentas_nuevas', v_cuentas_nuevas,
    'por_proyecto', '[]'::jsonb, 'cuadro_id', v_cuadro);
end;
$$;
revoke all on function public.cargar_cuadro_sinco(text, jsonb, uuid[], boolean) from public, anon;
grant execute on function public.cargar_cuadro_sinco(text, jsonb, uuid[], boolean) to authenticated;

-- 7. Consultas: lista de cuadros y estado de los pagos de un cuadro ---------------------
-- (quien adjunta soportes no lee pagos ni los proyectos "solo pagos": se lo da esto).
create or replace function public.listar_cuadros_sinco()
returns table (id uuid, numero integer, archivo text, cargado_en timestamptz, cargado_por text,
               filas integer, total numeric, sin_soporte integer, anulado_en timestamptz,
               motivo_anulacion text, personas text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.numero, c.archivo, c.cargado_en, p.nombre, c.filas, c.total,
         coalesce(s.n, 0)::int, c.anulado_en, c.motivo_anulacion, u.nombres
    from public.sinco_cuadros c
    left join public.perfiles p on p.id = c.cargado_por
    left join lateral (select count(*) n from public.sinco_filas f
                        join public.pagos g on g.sinco_fila_id = f.id and g.estado = 'aprobado'
                       where f.cuadro_id = c.id and f.soporte_ruta is null) s on true
    left join lateral (select string_agg(pp.nombre, ', ' order by pp.nombre) nombres
                         from public.sinco_cuadro_usuarios x join public.perfiles pp on pp.id = x.usuario_id
                        where x.cuadro_id = c.id) u on true
   where c.id in (select public._cuadros_sinco_visibles(auth.uid()))
   order by c.cargado_en desc
$$;
revoke all on function public.listar_cuadros_sinco() from public, anon;
grant execute on function public.listar_cuadros_sinco() to authenticated;

create or replace function public.pagos_cuadro_sinco(p_cuadro uuid)
returns table (fila_id uuid, estado text, liquidacion_estado text, referencia text, novedad text)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, g.estado, g.liquidacion_estado, g.referencia, g.novedad
    from public.sinco_filas f
    join public.pagos g on g.sinco_fila_id = f.id
   where f.cuadro_id = p_cuadro
     and p_cuadro in (select public._cuadros_sinco_visibles(auth.uid()))
$$;
revoke all on function public.pagos_cuadro_sinco(uuid) from public, anon;
grant execute on function public.pagos_cuadro_sinco(uuid) to authenticated;

-- 8. Personas del cuadro, soportes y anular ------------------------------------------
-- Personas a quienes se les puede pedir los soportes (activas, con nombre).
create or replace function public.usuarios_para_cuadro_sinco()
returns table (id uuid, nombre text, rol text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.nombre, r.nombre
    from public.perfiles p
    join auth.users u on u.id = p.id
    left join public.roles r on r.id = p.rol_id
   where public.tiene_accion(auth.uid(), 'cargar_cuadros_sinco')
     and (u.banned_until is null or u.banned_until < now())
     and btrim(coalesce(p.nombre, '')) <> ''
   order by p.nombre
$$;
revoke all on function public.usuarios_para_cuadro_sinco() from public, anon;
grant execute on function public.usuarios_para_cuadro_sinco() to authenticated;

-- Cambia las personas del cuadro; a las nuevas les llega el aviso.
create or replace function public.fijar_usuarios_cuadro_sinco(p_cuadro uuid, p_usuarios uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nuevos uuid[];
begin
  if not public.tiene_accion(auth.uid(), 'cargar_cuadros_sinco') then
    raise exception 'No autorizado -- no tienes permiso para cargar cuadros de SINCO.';
  end if;
  if coalesce(array_length(p_usuarios, 1), 0) = 0 then
    raise exception 'Elige al menos una persona.';
  end if;
  perform 1 from public.sinco_cuadros where id = p_cuadro and anulado_en is null for update;
  if not found then
    raise exception 'El cuadro no existe o está anulado.';
  end if;
  select array_agg(distinct u) into v_nuevos
    from unnest(p_usuarios) u
   where exists (select 1 from public.perfiles p where p.id = u)
     and not exists (select 1 from public.sinco_cuadro_usuarios x where x.cuadro_id = p_cuadro and x.usuario_id = u);
  delete from public.sinco_cuadro_usuarios where cuadro_id = p_cuadro and not (usuario_id = any (p_usuarios));
  insert into public.sinco_cuadro_usuarios (cuadro_id, usuario_id)
  select p_cuadro, u from unnest(coalesce(v_nuevos, '{}')) u;
  if coalesce(array_length(v_nuevos, 1), 0) > 0 then
    perform public._avisar_cuadro_sinco(p_cuadro, v_nuevos);
  end if;
end;
$$;
revoke all on function public.fijar_usuarios_cuadro_sinco(uuid, uuid[]) from public, anon;
grant execute on function public.fijar_usuarios_cuadro_sinco(uuid, uuid[]) to authenticated;

-- El navegador sube el archivo a sinco/<cuadro>/<fila>/... y llama esta función.
-- Se puede cambiar mientras el pago no esté liquidado.
create or replace function public.guardar_soporte_sinco(p_fila uuid, p_ruta text, p_nombre text, p_mime text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f record;
begin
  select f.id, f.cuadro_id, f.soporte_nombre, c.anulado_en, g.id as pago_id, g.estado, g.liquidacion_estado
    into v_f
    from public.sinco_filas f
    join public.sinco_cuadros c on c.id = f.cuadro_id
    left join public.pagos g on g.sinco_fila_id = f.id
   where f.id = p_fila
     for update of f;
  if not found or not (v_f.cuadro_id in (select public._cuadros_sinco_visibles(auth.uid()))) then
    raise exception 'No autorizado -- no tienes acceso a este cuadro de SINCO.';
  end if;
  if v_f.anulado_en is not null then
    raise exception 'El cuadro está anulado.';
  end if;
  if v_f.estado is distinct from 'aprobado' or v_f.liquidacion_estado = 'liquidado' then
    raise exception 'El pago ya se liquidó o no está vigente: el soporte ya no se cambia.';
  end if;
  if p_ruta is null or position(v_f.cuadro_id::text || '/' || v_f.id::text || '/' in p_ruta) <> 1 then
    raise exception 'El archivo no es de este pago.';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'Falta el nombre del archivo.';
  end if;
  update public.sinco_filas
     set soporte_ruta = p_ruta, soporte_nombre = btrim(p_nombre), soporte_mime = p_mime,
         soporte_subido_en = now(), soporte_subido_por = auth.uid()
   where id = p_fila;
  perform public._pago_actualizar_novedad(v_f.pago_id);
  perform public._anotar_historial('pago', v_f.pago_id,
    case when v_f.soporte_nombre is null then 'soporte_sinco' else 'soporte_sinco_cambiado' end,
    jsonb_build_object('archivo', btrim(p_nombre)), null);
end;
$$;
revoke all on function public.guardar_soporte_sinco(uuid, text, text, text) from public, anon;
grant execute on function public.guardar_soporte_sinco(uuid, text, text, text) to authenticated;

-- Anular un cuadro mal cargado: solo si ningún pago se envió a liquidar.
create or replace function public.anular_cuadro_sinco(p_cuadro uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.tiene_accion(auth.uid(), 'cargar_cuadros_sinco') then
    raise exception 'No autorizado -- no tienes permiso para cargar cuadros de SINCO.';
  end if;
  if btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'Escribe el motivo.';
  end if;
  perform 1 from public.sinco_cuadros where id = p_cuadro and anulado_en is null for update;
  if not found then
    raise exception 'El cuadro no existe o ya está anulado.';
  end if;
  perform 1 from public.pagos g join public.sinco_filas f on f.id = g.sinco_fila_id
   where f.cuadro_id = p_cuadro for update of g;
  if exists (select 1 from public.pagos g join public.sinco_filas f on f.id = g.sinco_fila_id
              where f.cuadro_id = p_cuadro and g.estado <> 'anulado'
                and (g.liquidacion_estado is not null or g.referencia is not null or g.estado <> 'aprobado')) then
    raise exception 'Algún pago del cuadro ya se envió a liquidar: devuélvelo a preparación antes de anular el cuadro.';
  end if;
  for v_id in
    update public.pagos g set estado = 'anulado', anulado_en = now(), motivo_anulacion = 'Cuadro de SINCO anulado: ' || btrim(p_motivo)
      from public.sinco_filas f
     where f.id = g.sinco_fila_id and f.cuadro_id = p_cuadro and g.estado <> 'anulado'
    returning g.id
  loop
    perform public._pago_actualizar_novedad(v_id);
  end loop;
  update public.sinco_cuadros set anulado_en = now(), anulado_por = auth.uid(), motivo_anulacion = btrim(p_motivo)
   where id = p_cuadro;
end;
$$;
revoke all on function public.anular_cuadro_sinco(uuid, text) from public, anon;
grant execute on function public.anular_cuadro_sinco(uuid, text) to authenticated;

-- 9. Mis pendientes: soportes por adjuntar ---------------------------------------------
select pg_temp._parche('public._pendientes_de(uuid)'::regprocedure,
  $a$   group by pr.id, pr.proyecto_id, m.id, m.descripcion, m.u_m, m.created_at;
end;$a$,
  $b$   group by pr.id, pr.proyecto_id, m.id, m.descripcion, m.u_m, m.created_at

  -- ------------------------------------------------ Soportes de cuadros de SINCO (20270101002800)
  union all
  select 'soporte_sinco', 'hacer', c.id, null::uuid,
         'Cuadro de SINCO N° ' || c.numero || ' · ' || c.archivo,
         count(*) || case when count(*) = 1 then ' soporte por adjuntar' else ' soportes por adjuntar' end,
         sum(f.total), c.cargado_en, c.cargado_por, null::date, '/cuadros-sinco/' || c.id
    from sinco_cuadro_usuarios u
    join sinco_cuadros c on c.id = u.cuadro_id and c.anulado_en is null
    join sinco_filas f on f.cuadro_id = c.id and f.soporte_ruta is null
    join pagos g on g.sinco_fila_id = f.id and g.estado = 'aprobado' and coalesce(g.liquidacion_estado, '') <> 'liquidado'
   where u.usuario_id = p_uid
   group by c.id, c.numero, c.archivo, c.cargado_en, c.cargado_por;
end;$b$);

select pg_temp._parche('public._titulo_pendiente(text)'::regprocedure,
  $a$'mi_req_atrasada', 'Mis requisiciones atrasadas'$a$,
  $b$'mi_req_atrasada', 'Mis requisiciones atrasadas',
    'soporte_sinco', 'Soportes de cuadros de SINCO por adjuntar'$b$);

commit;
