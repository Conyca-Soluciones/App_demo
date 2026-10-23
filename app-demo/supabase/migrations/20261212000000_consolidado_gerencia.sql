-- Consolidado Gerencia (decisión del usuario, 2026-10-22): un cuarto
-- consolidado para control de Gerencia que junta los pagos de los otros tres
-- (Bogotá, Vanur, Otros). Filtros: semana/año, grupo empresarial, tercero,
-- proyecto y solicitante. Columnas: ITEM, semana/año, grupo empresarial,
-- tercero, proyecto, solicitante, valor a pagar y el SOPORTE original (la
-- factura o cuenta de cobro de la OC, del acta o de la requisición
-- administrativa). Se le agregarán más columnas.
--
-- 1. Pestaña ayf.consolidado_gerencia: ve los pagos de todos los consolidados
--    (_consolidados_visibles los devuelve todos). La recibe Gerencia.
-- 2. Soporte de cada ítem de requisición administrativa (no tenía): factura o
--    cuenta de cobro, opcional, en el bucket privado requisiciones_admin
--    (<usuario>/<archivo>). Va en el ítem (soporte_*), así se conserva al
--    modificar la requisición (los ítems se borran y se vuelven a crear).
-- 3. Solicitante de los pagos de requisiciones administrativas (quien la hizo)
--    y valor del documento = valor: antes quedaban vacíos.
-- 4. opciones_consolidado_gerencia(): empresas, proyectos y solicitantes que
--    tienen pagos, para los filtros.
--
-- _guardar_requisicion_admin y detalle_requisicion_admin (rama de spr) y
-- _pago_desglose_origen se parchan sobre su versión viva (texto exacto; falla
-- si no lo encuentra).

-- 1. Pestaña --------------------------------------------------------------

create or replace function public._consolidados_visibles(p_uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id from public.consolidados c
   where public.tiene_pestana(p_uid, 'ayf.consolidado_' || c.clave)
      or public.tiene_pestana(p_uid, 'ayf.consolidado_gerencia')
$$;

insert into public.rol_permisos (rol_id, permiso)
select r.id, 'tab.ayf.consolidado_gerencia' from public.roles r where r.clave = 'gerencia'
on conflict do nothing;

-- 2. Soporte de los ítems de requisición administrativa ---------------------

alter table public.requisicion_admin_items
  add column if not exists soporte_ruta   text,
  add column if not exists soporte_nombre text,
  add column if not exists soporte_mime   text,
  add column if not exists soporte_tamano bigint,
  add column if not exists soporte_tipo   text;
alter table public.requisicion_admin_items drop constraint if exists requisicion_admin_items_soporte_check;
alter table public.requisicion_admin_items add constraint requisicion_admin_items_soporte_check check (
  (soporte_ruta is null and soporte_tipo is null)
  or (soporte_ruta is not null and soporte_tipo in ('factura', 'cuenta_cobro') and btrim(coalesce(soporte_nombre, '')) <> '')
);
create index if not exists idx_requisicion_admin_items_soporte on public.requisicion_admin_items(soporte_ruta)
  where soporte_ruta is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('requisiciones_admin', 'requisiciones_admin', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

-- Cada quien sube a su carpeta; se lee si se ve el ítem que lo usa (RLS de los
-- ítems) o si es suyo; se borra lo propio que ya no usa ningún ítem.
drop policy if exists requisiciones_admin_archivos_select on storage.objects;
create policy requisiciones_admin_archivos_select on storage.objects for select to authenticated
  using (bucket_id = 'requisiciones_admin' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.requisicion_admin_items i where i.soporte_ruta = objects.name)));
drop policy if exists requisiciones_admin_archivos_insert on storage.objects;
create policy requisiciones_admin_archivos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'requisiciones_admin' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists requisiciones_admin_archivos_delete on storage.objects;
create policy requisiciones_admin_archivos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'requisiciones_admin' and (storage.foldername(name))[1] = (select auth.uid())::text
         and not exists (select 1 from public.requisicion_admin_items i where i.soporte_ruta = objects.name));

create or replace function public._validar_soporte_req_admin(p_soporte jsonb, p_fila text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ruta text := nullif(btrim(coalesce(p_soporte ->> 'ruta', '')), '');
begin
  if v_ruta is null then
    return;
  end if;
  if coalesce(p_soporte ->> 'tipo', '') not in ('factura', 'cuenta_cobro') then
    raise exception '%el soporte debe ser una factura o una cuenta de cobro.', p_fila;
  end if;
  if btrim(coalesce(p_soporte ->> 'nombre', '')) = '' then
    raise exception '%falta el nombre del archivo del soporte.', p_fila;
  end if;
  if split_part(v_ruta, '/', 1) <> auth.uid()::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'requisiciones_admin' and o.name = v_ruta) then
    raise exception '%no se encontró el archivo del soporte: vuelve a adjuntarlo.', p_fila;
  end if;
end;
$$;
revoke all on function public._validar_soporte_req_admin(jsonb, text) from public, anon, authenticated;

-- 4. Opciones de los filtros ----------------------------------------------

create or replace function public.opciones_consolidado_gerencia()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.tiene_pestana(v_uid, 'ayf.consolidado_gerencia') then
    raise exception 'No autorizado -- no tienes el Consolidado Gerencia.';
  end if;
  return jsonb_build_object(
    'empresas', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.razon_social) order by e.razon_social)
                            from public.empresas e
                           where exists (select 1 from public.pagos g where g.empresa_id = e.id and g.consolidado_id is not null)), '[]'),
    'proyectos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'codigo', p.codigo, 'nombre', p.nombre) order by p.codigo)
                             from public.proyectos p
                            where exists (select 1 from public.pagos g where g.proyecto_id = p.id and g.consolidado_id is not null)), '[]'),
    'solicitantes', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'nombre', f.nombre) order by f.nombre)
                                from public.perfiles f
                               where exists (select 1 from public.pagos g where g.solicitado_por = f.id and g.consolidado_id is not null)), '[]')
  );
end;
$$;
revoke all on function public.opciones_consolidado_gerencia() from public, anon;
grant execute on function public.opciones_consolidado_gerencia() to authenticated;

create index if not exists idx_pagos_solicitado_consolidado on public.pagos(solicitado_por) where consolidado_id is not null;

-- Funciones vivas, parchadas (2, 3) ----------------------------------------

do $$
declare
  v_cambios constant text[][] := array[
    ['_guardar_requisicion_admin',
     '    insert into public.requisicion_admin_items (',
     E'    perform public._validar_soporte_req_admin(v_it -> ''soporte'', v_fila);\n    insert into public.requisicion_admin_items ('],
    ['_guardar_requisicion_admin',
     'concepto, proyecto_id, valor, observaciones)',
     'concepto, proyecto_id, valor, observaciones, soporte_ruta, soporte_nombre, soporte_mime, soporte_tamano, soporte_tipo)'],
    ['_guardar_requisicion_admin',
     'nullif(btrim(coalesce(v_it ->> ''observaciones'', '''')), ''''));',
     E'nullif(btrim(coalesce(v_it ->> ''observaciones'', '''')), ''''),\n'
       || E'      nullif(btrim(coalesce(v_it -> ''soporte'' ->> ''ruta'', '''')), ''''),\n'
       || E'      case when nullif(btrim(coalesce(v_it -> ''soporte'' ->> ''ruta'', '''')), '''') is not null then btrim(v_it -> ''soporte'' ->> ''nombre'') end,\n'
       || E'      case when nullif(btrim(coalesce(v_it -> ''soporte'' ->> ''ruta'', '''')), '''') is not null then v_it -> ''soporte'' ->> ''mime'' end,\n'
       || E'      case when nullif(btrim(coalesce(v_it -> ''soporte'' ->> ''ruta'', '''')), '''') is not null then nullif(v_it -> ''soporte'' ->> ''tamano'', '''')::bigint end,\n'
       || E'      case when nullif(btrim(coalesce(v_it -> ''soporte'' ->> ''ruta'', '''')), '''') is not null then v_it -> ''soporte'' ->> ''tipo'' end);'],
    ['detalle_requisicion_admin',
     '''valor'', i.valor, ''observaciones'', i.observaciones,',
     '''valor'', i.valor, ''observaciones'', i.observaciones, '
       || '''soporte'', case when i.soporte_ruta is null then null else jsonb_build_object(''ruta'', i.soporte_ruta, '
       || '''nombre'', i.soporte_nombre, ''mime'', i.soporte_mime, ''tamano'', i.soporte_tamano, ''tipo'', i.soporte_tipo) end,'],
    ['_pago_desglose_origen',
     'elsif new.fuente = ''acta'' and new.acta_id is not null then',
     E'elsif new.fuente = ''requisicion_admin'' and new.requisicion_admin_id is not null then\n'
       || E'    -- Requisición administrativa: la pidió quien la hizo; el documento es su valor.\n'
       || E'    if new.solicitado_por is null then\n'
       || E'      select r.creado_por into new.solicitado_por from public.requisiciones_admin r where r.id = new.requisicion_admin_id;\n'
       || E'    end if;\n'
       || E'    new.valor_documento := coalesce(new.valor_documento, new.valor);\n'
       || E'  elsif new.fuente = ''acta'' and new.acta_id is not null then']
  ];
  v_def text;
  v_n int;
  i int;
begin
  for i in 1 .. array_length(v_cambios, 1) loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_cambios[i][1];
    if v_def is null then
      raise exception 'No existe la función %.', v_cambios[i][1];
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_cambios[i][2], ''))) / length(v_cambios[i][2]);
    if v_n <> 1 then
      raise exception 'En % se esperaba encontrar una vez el texto % (veces: %): ¿cambió la función?', v_cambios[i][1], v_cambios[i][2], v_n;
    end if;
    execute replace(v_def, v_cambios[i][2], v_cambios[i][3]);
  end loop;
end $$;

-- Pagos de requisiciones administrativas que ya existían: el disparador corre
-- con un UPDATE que no cambia el valor.
update public.pagos set valor = valor
 where fuente = 'requisicion_admin' and (solicitado_por is null or valor_documento is null);
