-- =============================================================================
-- Las OC no se desaprueban, y Compras ve presupuestos (decisiones del usuario,
-- 2026-11-05).
--
-- - Desaprobar OC se quita del todo, como aprobar (20261204000000): una OC
--   queda aprobada cuando A&F aprueba su pago. Para cambiar una orden, Compras
--   usa "Modificar" (20261231400000), que la devuelve a aprobación con un pago
--   nuevo. desaprobar_orden_compra solo devuelve un error y la acción
--   desaprobar_oc sale de todos los roles (la matriz ya no la ofrece).
-- - Compras y Líder Compras ven Elaboración de presupuestos para seguir de qué
--   ítem sale una requisición (la RLS de presupuestos pide esta pestaña o una de
--   requisiciones; sin ella el detalle de la requisición salía sin ítem). Solo
--   ver: escribir exige la acción editar_presupuestos, que no tienen, y la
--   página queda en solo lectura (puedeEditarPresupuestos).
-- =============================================================================

create or replace function public.desaprobar_orden_compra(p_orden_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Las órdenes de compra no se desaprueban: para cambiar una, usa "Modificar" (vuelve a Aprobación de pagos).';
end;
$$;

delete from public.rol_permisos where permiso = 'accion.desaprobar_oc';

insert into public.rol_permisos (rol_id, permiso)
select r.id, 'tab.presupuestos.elaboracion'
  from public.roles r
 where r.clave in ('compras', 'lider_compras')
   and not exists (select 1 from public.rol_permisos x
                    where x.rol_id = r.id and x.permiso = 'tab.presupuestos.elaboracion');
