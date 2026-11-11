-- Órdenes de compra, paquete B (decisiones del usuario, 2026-11-11). Se puede
-- correr más de una vez.
--
-- 1. Encabezado de la OC según la empresa del proyecto: además de razón
--    social, NIT y logo (que ya existían), el correo y la ciudad de la empresa
--    (se llenan en Admin › Empresas). El logo de CONYCA fijo se quitó del PDF.
-- 2. Pago inmediato: casilla de la OC (aparte del tipo de pago). Viaja en
--    p_pago.inmediato, que leen crear_orden_compra_con_soporte,
--    crear_orden_compra_con_saldo y modificar_orden_compra por _fijar_pago_orden.
--    A&F lo ve en rojo en Aprobación de pagos y en el Consolidado.
-- 3. Modificar una OC: se pueden agregar insumos pendientes de CUALQUIER
--    requisición del mismo proyecto (antes solo de las mismas requisiciones de
--    la orden). Al crear ya se podía: crear_orden_compra solo exige el proyecto.

alter table public.empresas add column if not exists correo text;
alter table public.empresas add column if not exists ciudad text;

alter table public.ordenes_compra add column if not exists pago_inmediato boolean not null default false;
comment on column public.ordenes_compra.pago_inmediato is
  'Pago inmediato (urgente): A&F lo ve resaltado (20270101000000).';

-- ---------------------------------------------------------------- pago inmediato
do $$
declare
  d text := replace(pg_get_functiondef('public._fijar_pago_orden'::regproc), E'\r\n', E'\n');
  a text := E'begin\n  if p_pago is null then\n    return;\n  end if;\n';
  b text := E'  -- Pago inmediato (20270101000000).\n'
         || E'  update public.ordenes_compra set pago_inmediato = coalesce((p_pago ->> ''inmediato'')::boolean, false)\n'
         || E'   where id = p_orden_id;\n';
begin
  if position('pago_inmediato' in d) > 0 then return; end if;
  if position(a in d) = 0 then
    raise exception '_fijar_pago_orden no tiene el texto esperado.';
  end if;
  execute replace(d, a, a || b);
end $$;

-- ---------------------------------------------------------------- modificar: insumos del mismo proyecto
do $$
declare
  d text := replace(pg_get_functiondef('public.modificar_orden_compra'::regproc), E'\r\n', E'\n');
  a text := E'     where p.id is null\n'
         || E'        or p.grupo_pedido_id not in (\n'
         || E'             select pi.grupo_pedido_id\n'
         || E'               from ordenes_compra_items oci\n'
         || E'               join pedidos_insumos pi on pi.id = oci.pedido_insumo_id\n'
         || E'              where oci.orden_compra_id = p_orden_id)\n'
         || E'  ) then\n'
         || E'    raise exception ''Solo se pueden agregar insumos de las mismas requisiciones de la orden.'';\n';
  b text := E'     where p.id is null\n'
         || E'        or p.proyecto_id is distinct from v_o.proyecto_id\n'
         || E'  ) then\n'
         || E'    raise exception ''Solo se pueden agregar insumos pendientes del mismo proyecto de la orden.'';\n';
begin
  if position('del mismo proyecto de la orden' in d) > 0 then return; end if;
  if position(a in d) = 0 then
    raise exception 'modificar_orden_compra no tiene el texto esperado.';
  end if;
  execute replace(d, a, b);
end $$;
