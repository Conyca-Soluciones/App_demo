-- ---------------------------------------------------------------------------
-- Seguridad de APU, opción B: escribir solo en los proyectos de cada quien
-- (revisión por roles 2026-10-22, E5; decisión del usuario). Antes
-- `editar_presupuestos` / `aprobar_insumos` dejaban modificar el APU de
-- cualquier proyecto: un Director sin proyectos duplicó una cantidad del APU de
-- Malecón y con eso el cupo de requisición del ítem (156 -> 312), sin historial.
--
-- Se mantiene la acción que ya se pedía y se agrega: el APU (o el ítem, o el
-- proyecto) no puede ser de un proyecto que el usuario no ve. Leer sigue igual
-- (APU recomendados e import leen APU de otros proyectos). Un APU recién
-- creado y todavía sin ítem (crearApuStandalone, copiar un APU) no es de ningún
-- proyecto y se puede llenar; queda del proyecto al enlazarlo a un ítem, y eso
-- ya exige poder editar ese presupuesto. Las funciones SECURITY DEFINER no
-- pasan por estas políticas.
-- Para usuarios con rol, "editable" = ver el proyecto + la acción
-- (proyectos_editables). Se puede correr dos veces.
-- ---------------------------------------------------------------------------

-- Conjuntos (la política los evalúa una vez por consulta, no por fila).
create or replace function public._apus_de_proyectos_ajenos(p_uid uuid)
 returns setof uuid
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select distinct pi.apu_id
    from public.presupuesto_items pi
    join public.presupuestos p on p.id = pi.presupuesto_id
   where pi.apu_id is not null
     and p.proyecto_id is not null
     and p.proyecto_id not in (select public.proyectos_visibles(p_uid));
$function$;

create or replace function public._items_de_proyectos_ajenos(p_uid uuid)
 returns setof uuid
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select pi.id
    from public.presupuesto_items pi
    join public.presupuestos p on p.id = pi.presupuesto_id
   where p.proyecto_id is not null
     and p.proyecto_id not in (select public.proyectos_visibles(p_uid));
$function$;

revoke all on function public._apus_de_proyectos_ajenos(uuid) from public, anon;
revoke all on function public._items_de_proyectos_ajenos(uuid) from public, anon;
grant execute on function public._apus_de_proyectos_ajenos(uuid) to authenticated;
grant execute on function public._items_de_proyectos_ajenos(uuid) to authenticated;

-- apu (crear sigue igual: un APU nuevo no es de ningún proyecto todavía)
drop policy if exists apu_update on public.apu;
create policy apu_update on public.apu for update to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
         and id not in (select public._apus_de_proyectos_ajenos((select auth.uid()))))
  with check ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
         and id not in (select public._apus_de_proyectos_ajenos((select auth.uid()))));

drop policy if exists apu_delete on public.apu;
create policy apu_delete on public.apu for delete to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
         and id not in (select public._apus_de_proyectos_ajenos((select auth.uid()))));

-- item_apu
drop policy if exists item_apu_insert on public.item_apu;
create policy item_apu_insert on public.item_apu for insert to authenticated
  with check (((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
               or (select public.tiene_accion((select auth.uid()), 'aprobar_insumos')))
              and apu_id not in (select public._apus_de_proyectos_ajenos((select auth.uid()))));

drop policy if exists item_apu_update on public.item_apu;
create policy item_apu_update on public.item_apu for update to authenticated
  using (((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
          or (select public.tiene_accion((select auth.uid()), 'aprobar_insumos')))
         and apu_id not in (select public._apus_de_proyectos_ajenos((select auth.uid()))))
  with check (((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
               or (select public.tiene_accion((select auth.uid()), 'aprobar_insumos')))
              and apu_id not in (select public._apus_de_proyectos_ajenos((select auth.uid()))));

drop policy if exists item_apu_delete on public.item_apu;
create policy item_apu_delete on public.item_apu for delete to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
         and apu_id not in (select public._apus_de_proyectos_ajenos((select auth.uid()))));

-- apu_import_revision (por el ítem del presupuesto)
drop policy if exists apu_import_revision_insert on public.apu_import_revision;
create policy apu_import_revision_insert on public.apu_import_revision for insert to authenticated
  with check ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
              and (presupuesto_item_id is null
                   or presupuesto_item_id not in (select public._items_de_proyectos_ajenos((select auth.uid())))));

drop policy if exists apu_import_revision_update on public.apu_import_revision;
create policy apu_import_revision_update on public.apu_import_revision for update to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
         and (presupuesto_item_id is null
              or presupuesto_item_id not in (select public._items_de_proyectos_ajenos((select auth.uid())))))
  with check ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
              and (presupuesto_item_id is null
                   or presupuesto_item_id not in (select public._items_de_proyectos_ajenos((select auth.uid())))));

drop policy if exists apu_import_revision_delete on public.apu_import_revision;
create policy apu_import_revision_delete on public.apu_import_revision for delete to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
         and (presupuesto_item_id is null
              or presupuesto_item_id not in (select public._items_de_proyectos_ajenos((select auth.uid())))));

-- transporte_precios (tiene su proyecto)
drop policy if exists transporte_precios_insert on public.transporte_precios;
create policy transporte_precios_insert on public.transporte_precios for insert to authenticated
  with check ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
              and (proyecto_id is null or proyecto_id in (select public.proyectos_visibles((select auth.uid())))));

drop policy if exists transporte_precios_update on public.transporte_precios;
create policy transporte_precios_update on public.transporte_precios for update to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
         and (proyecto_id is null or proyecto_id in (select public.proyectos_visibles((select auth.uid())))))
  with check ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
              and (proyecto_id is null or proyecto_id in (select public.proyectos_visibles((select auth.uid())))));

drop policy if exists transporte_precios_delete on public.transporte_precios;
create policy transporte_precios_delete on public.transporte_precios for delete to authenticated
  using ((select public.tiene_accion((select auth.uid()), 'editar_presupuestos'))
         and (proyecto_id is null or proyecto_id in (select public.proyectos_visibles((select auth.uid())))));
