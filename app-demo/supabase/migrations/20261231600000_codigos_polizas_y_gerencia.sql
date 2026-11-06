-- =============================================================================
-- Arreglos de las pruebas (2026-11-06).
--
-- 1. Subir póliza fallaba con 'record "c" has no field "codigo"': la migración de
--    códigos por proyecto (20261230000000) cambió el mensaje a
--    coalesce(c.numero_contrato, c.codigo) pero el SELECT ... INTO c no traía
--    codigo. Lo mismo en el aviso diario de contratos vencidos
--    (_avisar_contratos_vencidos): fallaba apenas hubiera un contrato vencido.
-- 2. Entradas mostraba la OC como "N° 2": listar_ordenes_entradas y
--    listar_ordenes_para_entrada no devolvían el código (OC-001-0002).
-- 3. Director de obra ve Terceros (A&F).
-- 4. Las minutas y los otrosí los aprueba GERENCIA después de Jurídica, no
--    Subgerencia (decisión del usuario): la acción aprobar_minutas y las
--    pestañas Aprobación de contratos y de otrosí salen de Subgerencia; Gerencia
--    ya tenía la acción y Aprobación de contratos y recibe Aprobación de otrosí.
--    Los textos de la base que decían "Subgerencia" dicen "Gerencia".
--
-- Los parches de funciones son reemplazos de texto exacto sobre la versión
-- viva (fallan si no encuentran el texto).
-- =============================================================================

create or replace function pg_temp.parchar(p_nombre text, p_viejo text, p_nuevo text)
returns void
language plpgsql
as $$
declare
  v_oid oid;
  v_def text;
begin
  select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_nombre;
  v_def := pg_get_functiondef(v_oid);
  if position(p_viejo in v_def) = 0 then
    raise exception 'No se encontró el texto a reemplazar en %', p_nombre;
  end if;
  execute replace(v_def, p_viejo, p_nuevo);
end;
$$;

-- 1. Código del contrato en las consultas que lo usan.
select pg_temp.parchar('subir_poliza',
  'select id, proyecto_id, numero, numero_contrato, poliza_estado into c',
  'select id, proyecto_id, numero, numero_contrato, codigo, poliza_estado into c');

select pg_temp.parchar('_avisar_contratos_vencidos',
  'select x.id, x.numero, x.numero_contrato, x.proyecto_id,',
  'select x.id, x.numero, x.numero_contrato, x.codigo, x.proyecto_id,');

-- 2. Entradas con el código de la OC (cambia el tipo de retorno: drop + create).
drop function if exists public.listar_ordenes_entradas(uuid, integer, text, uuid, text, timestamptz, timestamptz, integer, integer);

create function public.listar_ordenes_entradas(
  p_proyecto_id uuid default null, p_numero integer default null, p_proveedor text default null,
  p_usuario uuid default null, p_estado text default null,
  p_desde timestamptz default null, p_hasta timestamptz default null,
  p_limite integer default 51, p_offset integer default 0
)
returns table(id uuid, numero integer, codigo text, estado_entrega text, proyecto_codigo text, proyecto_nombre text,
              proveedor_nombre text, entrada_at timestamptz, entrada_por text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_filtra_entrada boolean := p_usuario is not null or p_desde is not null or p_hasta is not null;
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para gestionar entradas de almacén.';
  end if;
  if p_proyecto_id is not null and not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes acceso a este proyecto.';
  end if;

  return query
  select
    o.id,
    o.numero::integer,
    o.codigo::text,
    o.estado_entrega::text,
    pr.codigo::text,
    pr.nombre::text,
    pv.nombre::text,
    ult.created_at,
    ult.nombre
  from ordenes_compra o
  join proyectos pr on pr.id = o.proyecto_id
  left join proveedores pv on pv.unique_id = o.proveedor_id
  left join lateral (
    select e.created_at, pf.nombre::text as nombre
    from entradas_almacen e
    left join perfiles pf on pf.id = e.recibido_por
    where e.orden_compra_id = o.id
      and e.anulada_at is null
      and (p_usuario is null or e.recibido_por = p_usuario)
      and (p_desde is null or e.created_at >= p_desde)
      and (p_hasta is null or e.created_at <= p_hasta)
    order by e.created_at desc, e.id desc
    limit 1
  ) ult on true
  where o.estado = 'aprobada'
    and (p_proyecto_id is null or o.proyecto_id = p_proyecto_id)
    and o.proyecto_id in (select public.proyectos_visibles(auth.uid()))
    and (p_numero is null or o.numero = p_numero)
    and (p_proveedor is null or p_proveedor = '' or pv.nombre ilike '%' || p_proveedor || '%')
    and (
      p_estado is null
      or (p_estado = 'por_recibir' and o.estado_entrega in ('sin_entregar', 'entrega_parcial'))
      or (p_estado <> 'por_recibir' and o.estado_entrega = p_estado)
    )
    and (not v_filtra_entrada or ult.created_at is not null)
  order by o.numero desc
  limit greatest(p_limite, 1) offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.listar_ordenes_entradas(uuid, integer, text, uuid, text, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.listar_ordenes_entradas(uuid, integer, text, uuid, text, timestamptz, timestamptz, integer, integer) to authenticated;

drop function if exists public.listar_ordenes_para_entrada(boolean, uuid);

create function public.listar_ordenes_para_entrada(p_incluir_entregadas boolean default false, p_proyecto_id uuid default null)
returns table(id uuid, numero integer, codigo text, estado_entrega text, proyecto_codigo text, proyecto_nombre text,
              proveedor_nombre text, fecha_entrega date, total_lineas bigint, cantidad_ordenada numeric,
              cantidad_recibida numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para gestionar entradas de almacén.';
  end if;
  if p_proyecto_id is not null and not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes acceso a este proyecto.';
  end if;

  return query
  select
    o.id,
    o.numero::integer,
    o.codigo::text,
    o.estado_entrega,
    pr.codigo::text,
    pr.nombre::text,
    pv.nombre::text,
    o.fecha_entrega::date,
    count(i.id),
    coalesce(sum(i.cantidad), 0),
    coalesce(sum(public._recibido_linea_oc(i.id)), 0)
  from ordenes_compra o
  join proyectos pr on pr.id = o.proyecto_id
  left join proveedores pv on pv.unique_id = o.proveedor_id
  left join ordenes_compra_items i on i.orden_compra_id = o.id
  where o.estado = 'aprobada'
    and (p_incluir_entregadas or o.estado_entrega in ('sin_entregar', 'entrega_parcial'))
    and (p_proyecto_id is null or o.proyecto_id = p_proyecto_id)
    and o.proyecto_id in (select public.proyectos_visibles(auth.uid()))
  group by o.id, pr.codigo, pr.nombre, pv.nombre
  order by o.numero desc;
end;
$$;

revoke all on function public.listar_ordenes_para_entrada(boolean, uuid) from public, anon;
grant execute on function public.listar_ordenes_para_entrada(boolean, uuid) to authenticated;

-- 3. Director de obra: Terceros.
insert into public.rol_permisos (rol_id, permiso)
select r.id, 'tab.ayf.terceros'
  from public.roles r
 where r.clave = 'director_obra'
   and not exists (select 1 from public.rol_permisos x where x.rol_id = r.id and x.permiso = 'tab.ayf.terceros');

-- 4. Gerencia aprueba minutas y otrosí; Subgerencia ya no.
delete from public.rol_permisos rp
 using public.roles r
 where r.id = rp.rol_id
   and r.clave = 'subgerencia'
   and rp.permiso in ('accion.aprobar_minutas', 'tab.contratos.aprobar_minutas', 'tab.contratos.aprobar_otrosi');

insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
  from public.roles r
 cross join (values ('accion.aprobar_minutas'), ('tab.contratos.aprobar_minutas'), ('tab.contratos.aprobar_otrosi')) as p(permiso)
 where r.clave = 'gerencia'
   and not exists (select 1 from public.rol_permisos x where x.rol_id = r.id and x.permiso = p.permiso);

do $$
declare
  v record;
begin
  for v in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosrc like '%Subgerencia%'
  loop
    execute replace(pg_get_functiondef(v.oid), 'Subgerencia', 'Gerencia');
  end loop;
end;
$$;
