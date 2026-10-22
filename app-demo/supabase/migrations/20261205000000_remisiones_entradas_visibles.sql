-- ---------------------------------------------------------------------------
-- Remisiones de las entradas: nadie las podía abrir (revisión por roles
-- 2026-10-22, E1). `entrada_soportes` y el bucket `entradas` dejan leer si se
-- puede leer la entrada, pero `entradas_almacen` tenía RLS sin ninguna
-- política: la lista de remisiones salía vacía y el enlace fallaba, sin error.
--
-- Leen las entradas (y con eso sus remisiones y archivos):
--  - quien tiene la pestaña Entradas, en sus proyectos;
--  - quien ya puede ver la orden de compra (Compras, Registro de OC, Control
--    del proyecto, A&F cuando la OC tiene pago: la RLS de ordenes_compra).
-- Solo lectura: entradas y remisiones se siguen escribiendo por funciones.
-- Se puede correr dos veces.
-- ---------------------------------------------------------------------------

-- Órdenes de los proyectos que el usuario ve, si tiene la pestaña Entradas.
-- Conjunto: la política la evalúa una vez por consulta, no por fila.
create or replace function public._ordenes_entradas_visibles(p_uid uuid)
 returns setof uuid
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select o.id
    from public.ordenes_compra o
   where public.tiene_pestana(p_uid, 'almacen.entradas')
     and o.proyecto_id in (select public.proyectos_visibles(p_uid));
$function$;
revoke all on function public._ordenes_entradas_visibles(uuid) from public, anon;
grant execute on function public._ordenes_entradas_visibles(uuid) to authenticated;

drop policy if exists entradas_almacen_select on public.entradas_almacen;
create policy entradas_almacen_select on public.entradas_almacen
  for select to authenticated
  using (
    orden_compra_id in (select public._ordenes_entradas_visibles((select auth.uid())))
    or orden_compra_id in (select o.id from public.ordenes_compra o)
  );
