-- =============================================================================
-- Control del proyecto: gasto administrativo (decisión del usuario, 2026-11-06).
--
-- Lo administrativo de un proyecto (escritorios, computadores, papelería,
-- arriendos, servicios) no va contra un ítem del presupuesto: se pide por
-- Requisiciones administrativas (las compra Compras, 20261231900000) o se paga
-- por Pagos administrativos (cuadros de pagos en A&F), y los dos piden el
-- proyecto. control_proyecto lo suma aparte:
--   administrativo_compras = líneas de OC aprobadas de requisiciones
--     administrativas del proyecto (antes salían en "compras" y en "sin ítem",
--     porque van al ítem oculto 000).
--   administrativo_pagos = pagos administrativos aprobados o dispersados cuyo
--     ítem es del proyecto (antes no salían en ningún lado).
-- "compras" queda solo con las de obra. El gastado del proyecto = compras +
-- actas + administrativo (lib/control-proyecto.ts).
--
-- Parches de texto exacto sobre la versión viva de control_proyecto.
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
    raise exception 'No se encontró el texto a reemplazar en %: %', p_nombre, left(p_viejo, 80);
  end if;
  execute replace(v_def, p_viejo, p_nuevo);
end;
$$;

-- 1. Marcar las líneas de OC que vienen de una requisición administrativa.
select pg_temp.parchar('control_proyecto',
  $p$pe.insumo_id, pi2.codigo as item_codigo, oci.cantidad,$p$,
  $p$pe.insumo_id, pi2.codigo as item_codigo, oci.cantidad, coalesce(rq.administrativa, false) as administrativa,$p$);
select pg_temp.parchar('control_proyecto',
  $p$left join presupuesto_items pi2 on pi2.id = pe.presupuesto_item_id$p$,
  $p$left join presupuesto_items pi2 on pi2.id = pe.presupuesto_item_id
    left join requisiciones rq on rq.id = pe.grupo_pedido_id$p$);

-- 2. No cuentan en el gasto por ítem (ni en "sin ítem").
select pg_temp.parchar('control_proyecto',
  $p$costo as compras, 0::numeric as actas from oc_lineas$p$,
  $p$costo as compras, 0::numeric as actas from oc_lineas where not administrativa$p$);

-- 3. Totales: compras de obra y gasto administrativo aparte.
select pg_temp.parchar('control_proyecto',
  $p$'compras', coalesce((select sum(costo) from oc_lineas), 0),$p$,
  $p$'compras', coalesce((select sum(costo) from oc_lineas where not administrativa), 0),
    'administrativo_compras', coalesce((select sum(costo) from oc_lineas where administrativa), 0),
    'administrativo_pagos', coalesce((select sum(pg.valor)
                                        from pagos pg
                                        join requisicion_admin_items ri on ri.id = pg.requisicion_admin_item_id
                                       where ri.proyecto_id = p_proyecto_id
                                         and pg.estado in ('aprobado', 'dispersado')), 0),$p$);
