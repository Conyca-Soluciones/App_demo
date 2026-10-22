-- Un consolidado por pestaña (decisión del usuario, 2026-10-22).
--
-- (Se aplicó con el número 20261206000000; se renumeró al mezclar con main para
-- que corra DESPUÉS de las de spr 20261204-20261209, que recrean las políticas
-- "desde un pago" y asignar_tercero_pago con la pestaña vieja.)
--
-- Hay dos equipos de Contabilidad: uno maneja solo el Consolidado Bogotá
-- (CONYCA) y no debe ver los otros consolidados, ni pistas de que existen; el
-- otro maneja los tres. La pestaña ayf.consolidado se parte en
-- ayf.consolidado_bogota / _vanur / _otros (las claves de consolidados.clave),
-- y la base aplica lo mismo:
--   * un pago se lee si quien pregunta tiene Aprobación de pagos o la pestaña
--     del consolidado del pago (los pagos sin consolidado, solo Aprobación);
--   * consolidados, fallos de pagos, OC / líneas / requisiciones / proveedores
--     leídos "desde un pago", terceros y cuentas, historial, Mis pendientes,
--     detalle del acta y cambiar el tercero de un pago siguen esa regla;
--   * una requisición administrativa se ve completa con Aprobación de pagos;
--     desde un consolidado, solo los ítems de los pagos que se ven.
-- Los roles que tenían la pestaña vieja reciben las tres.
--
-- Las funciones de la rama de spr (requisiciones administrativas, historial,
-- pendientes) se parchan sobre su versión VIVA: se reemplaza el texto exacto y
-- la migración falla si no está.

-- 1. Ayudas ----------------------------------------------------------------

create or replace function public._consolidados_visibles(p_uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id from public.consolidados c where public.tiene_pestana(p_uid, 'ayf.consolidado_' || c.clave)
$$;

create or replace function public._ve_algun_consolidado(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public._consolidados_visibles(p_uid))
$$;

-- ¿Puede ver este pago? Aprobación de pagos los ve todos; un consolidado, los suyos.
create or replace function public._ve_pago(p_uid uuid, p_pago_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.tiene_pestana(p_uid, 'ayf.aprobacion_pagos')
      or exists (select 1 from public.pagos g
                  where g.id = p_pago_id
                    and g.consolidado_id in (select public._consolidados_visibles(p_uid)))
$$;

-- Órdenes de compra de las empresas de los consolidados que se ven (para los
-- fallos al crear pagos, que todavía no tienen pago).
create or replace function public._ordenes_de_consolidados_visibles(p_uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select o.id
    from public.ordenes_compra o
    join public.proyectos p on p.id = o.proyecto_id
    join public.empresas e on e.id = p.empresa_id
   where e.consolidado_id in (select public._consolidados_visibles(p_uid))
$$;

revoke execute on function public._consolidados_visibles(uuid), public._ve_algun_consolidado(uuid),
  public._ve_pago(uuid, uuid), public._ordenes_de_consolidados_visibles(uuid) from public, anon;
grant execute on function public._consolidados_visibles(uuid), public._ve_algun_consolidado(uuid),
  public._ve_pago(uuid, uuid), public._ordenes_de_consolidados_visibles(uuid) to authenticated;

-- 2. Permisos de la matriz -------------------------------------------------

insert into public.rol_permisos (rol_id, permiso)
select rp.rol_id, 'tab.ayf.consolidado_' || c.clave
  from public.rol_permisos rp cross join public.consolidados c
 where rp.permiso = 'tab.ayf.consolidado'
on conflict do nothing;
delete from public.rol_permisos where permiso = 'tab.ayf.consolidado';

-- 3. Políticas -------------------------------------------------------------

drop policy if exists pagos_select on public.pagos;
create policy pagos_select on public.pagos
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos'))
    or consolidado_id in (select public._consolidados_visibles((select auth.uid())))
  );

drop policy if exists consolidados_select on public.consolidados;
create policy consolidados_select on public.consolidados
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos'))
    or id in (select public._consolidados_visibles((select auth.uid())))
  );

drop policy if exists pagos_fallos_select on public.pagos_fallos;
create policy pagos_fallos_select on public.pagos_fallos
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos'))
    or orden_compra_id in (select public._ordenes_de_consolidados_visibles((select auth.uid())))
  );

-- Las que solo preguntaban por la pestaña vieja: "algún consolidado". Las de
-- OC / líneas / pedidos / proveedores ya se limitan a lo que sale de un pago
-- (subconsulta sobre pagos, que aplica su política de arriba).
do $$
declare
  v_viejo constant text := 'tiene_pestana(( SELECT auth.uid() AS uid), ''ayf.consolidado''::text)';
  v_nuevo constant text := 'public._ve_algun_consolidado(( SELECT auth.uid() AS uid))';
  r record;
begin
  for r in
    select schemaname, tablename, policyname, qual
      from pg_policies
     where schemaname = 'public'
       and (tablename, policyname) in (
         ('terceros', 'terceros_select'),
         ('terceros_cuentas', 'terceros_cuentas_select'),
         ('ordenes_compra', 'ordenes_compra_select_de_pagos'),
         ('ordenes_compra_items', 'ordenes_compra_items_select_de_pagos'),
         ('pedidos_insumos', 'pedidos_insumos_select_de_pagos'),
         ('proveedores', 'proveedores_select_de_pagos'))
  loop
    if position(v_viejo in r.qual) = 0 then
      raise exception 'La política %.% no tiene la pestaña ayf.consolidado como se esperaba.', r.tablename, r.policyname;
    end if;
    execute format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename,
                   replace(r.qual, v_viejo, v_nuevo));
  end loop;
end $$;

-- Requisiciones administrativas: completas con Aprobación de pagos (o quien la
-- hizo); desde un consolidado, la cabecera y solo los ítems de sus pagos.
drop policy if exists requisiciones_admin_select on public.requisiciones_admin;
create policy requisiciones_admin_select on public.requisiciones_admin
  for select to authenticated
  using (
    creado_por = (select auth.uid())
    or (select public._ve_requisiciones_admin((select auth.uid())))
    or id in (select g.requisicion_admin_id from public.pagos g)
  );

drop policy if exists requisicion_admin_items_select on public.requisicion_admin_items;
create policy requisicion_admin_items_select on public.requisicion_admin_items
  for select to authenticated
  using (
    exists (select 1 from public.requisiciones_admin r
             where r.id = requisicion_id
               and (r.creado_por = (select auth.uid()) or (select public._ve_requisiciones_admin((select auth.uid())))))
    or id in (select g.requisicion_admin_item_id from public.pagos g)
  );

-- Actas que salen de un pago (para ver el acta y sus soportes desde el
-- Consolidado o Aprobación de pagos sin tener las pestañas de Contratos). La
-- subconsulta sobre pagos aplica su política; los soportes (tabla y archivos)
-- ya se leen "si se ve el acta".
drop policy if exists actas_select_de_pagos on public.actas;
create policy actas_select_de_pagos on public.actas
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos') or public._ve_algun_consolidado((select auth.uid())))
    and id in (select g.acta_id from public.pagos g)
  );

-- 4. Funciones (versión viva, parchada) -----------------------------------

do $$
declare
  -- función, texto que se busca, texto nuevo, veces que debe aparecer (0 = todas, al menos una)
  v_cambios constant text[][] := array[
    ['_ve_requisiciones_admin',
     'or public.tiene_pestana(p_uid, ''ayf.consolidado'')',
     '', '1'],
    ['historial_entidad',
     '(public.tiene_pestana(v_uid, ''ayf.aprobacion_pagos'') or public.tiene_pestana(v_uid, ''ayf.consolidado''))',
     'public._ve_pago(v_uid, p_id)', '1'],
    ['historial_entidad',
     'public.tiene_pestana(v_uid, ''ayf.consolidado'')',
     'public._ve_algun_consolidado(v_uid)', '0'],
    ['_pendientes_de',
     'where v_gestionar_pagos and g.estado = ''aprobado'' and (g.tercero_id is null or g.cuenta_tercero_id is null)',
     'where v_gestionar_pagos and g.estado = ''aprobado'' and (g.tercero_id is null or g.cuenta_tercero_id is null)'
       || ' and (public.tiene_pestana(p_uid, ''ayf.aprobacion_pagos'') or g.consolidado_id in (select public._consolidados_visibles(p_uid)))',
     '1'],
    ['_pendientes_de',
     'g.aprobado_por, null::date, ''/ayf/consolidado''',
     'g.aprobado_por, null::date, coalesce(''/ayf/consolidado/'' || (select c.clave from public.consolidados c where c.id = g.consolidado_id), ''/ayf/aprobacion-pagos'')',
     '1'],
    ['asignar_tercero_pago',
     'raise exception ''El pago no existe.'';',
     'raise exception ''El pago no existe.''; end if; if not public._ve_pago(auth.uid(), p_pago_id) then raise exception ''No autorizado -- no ves el consolidado de este pago.'';',
     '1'],
    ['detalle_acta',
     'not public.puede_ver_actas(v.proyecto_id)',
     'not (public.puede_ver_actas(v.proyecto_id) or exists (select 1 from public.pagos g where g.acta_id = p_acta_id and public._ve_pago(auth.uid(), g.id)))',
     '1']
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
    if (v_cambios[i][4] = '1' and v_n <> 1) or (v_cambios[i][4] = '0' and v_n < 1) then
      raise exception 'En % se esperaba encontrar el texto % (veces: %): ¿cambió la función?', v_cambios[i][1], v_cambios[i][2], v_n;
    end if;
    execute replace(v_def, v_cambios[i][2], v_cambios[i][3]);
  end loop;
end $$;
