-- ============================================================================
-- Borra TODO lo que se creó en las pruebas de Claude (2026-10-06 / 07):
--   * Proyecto ZZ-PRUEBA-VOLUMEN y todo lo que cuelga de él: presupuesto (3
--     versiones, ~5.000 ítems, APU y líneas de revisión), requisiciones 33-37,
--     órdenes de compra 49-50 con sus pagos, entradas, salidas, la solicitud de
--     contrato N° 4, historial y notificaciones.
--   * Empresa "PRUEBAS CLAUDE (BORRAR)" (NIT 900999001-1).
--   * Contratista "CONTRATISTA DE PRUEBA CLAUDE SAS (BORRAR)" (NIT 900999002-7).
--   * Deja los contadores (número de requisición, OC, contrato, entrada y
--     código de pedido) en el último número que siga existiendo, para que la
--     próxima requisición real no salte números.
--
-- El precio promedio de compra se calcula en el momento con las OC aprobadas
-- que existan: al borrar las OC de prueba deja de contarlas solo.
--
-- Correr COMPLETO en el SQL Editor de Supabase. Es una sola transacción: si
-- algo falla no se borra nada. Si el guardián de abajo no encuentra el
-- proyecto de prueba, aborta.
--
-- Los ARCHIVOS no se pueden borrar con SQL (Supabase lo impide). Al final de
-- este archivo están las carpetas a borrar desde Storage.
-- ============================================================================

begin;

-- ---------------------------------------------------------------- guardián
do $$
begin
  if (select count(*) from public.proyectos
       where codigo = 'ZZ-PRUEBA-VOLUMEN' and nombre like '%(BORRAR)%') <> 1 then
    raise exception 'No se encontró exactamente un proyecto ZZ-PRUEBA-VOLUMEN de prueba. No se borra nada.';
  end if;
end $$;

-- ------------------------------------------------------------ qué se borra
create temp table _p   on commit drop as
  select id from public.proyectos where codigo = 'ZZ-PRUEBA-VOLUMEN' and nombre like '%(BORRAR)%';
create temp table _req on commit drop as
  select id from public.requisiciones where proyecto_id in (select id from _p);
create temp table _ped on commit drop as
  select id from public.pedidos_insumos
   where proyecto_id in (select id from _p) or grupo_pedido_id in (select id from _req);
create temp table _oc  on commit drop as
  select id from public.ordenes_compra where proyecto_id in (select id from _p);
create temp table _con on commit drop as
  select id from public.contratos where proyecto_id in (select id from _p);
create temp table _apu on commit drop as
  select distinct pi.apu_id as id
    from public.presupuesto_items pi
    join public.presupuestos pr on pr.id = pi.presupuesto_id
   where pr.proyecto_id in (select id from _p) and pi.apu_id is not null;
create temp table _ent on commit drop as
  select id from _req union all select id from _ped union all select id from _oc union all select id from _con;

-- ------------------------------------------------------------- en orden
delete from public.notificaciones    where entidad_id in (select id from _ent);
delete from public.historial_eventos where entidad_id in (select id from _ent);

delete from public.pagos
 where orden_compra_id in (select id from _oc) or proyecto_id in (select id from _p);

delete from public.entradas_almacen where orden_compra_id in (select id from _oc);  -- arrastra sus líneas
delete from public.salidas_insumos  where proyecto_id in (select id from _p);

delete from public.pedidos_insumos where id in (select id from _ped);                -- arrastra líneas de OC
delete from public.ordenes_compra  where id in (select id from _oc);                 -- arrastra pagos_fallos
delete from public.requisiciones   where id in (select id from _req);

delete from public.contratos where id in (select id from _con);                      -- arrastra anexo, documentos, obligaciones, entregables

-- Presupuesto: arrastra versiones e ítems (y por los ítems: líneas de revisión,
-- precios de transporte y solicitudes pendientes). Un disparador borra cada
-- APU que queda sin ítem; el delete siguiente recoge cualquiera que quede.
delete from public.presupuestos where proyecto_id in (select id from _p);
delete from public.apu a
 where a.id in (select id from _apu)
   and not exists (select 1 from public.presupuesto_items pi where pi.apu_id = a.id);

delete from public.proyectos where id in (select id from _p);                        -- arrastra accesos y transporte

delete from public.empresas e
 where e.nit = '900999001-1' and e.razon_social = 'PRUEBAS CLAUDE (BORRAR)'
   and not exists (select 1 from public.proyectos p where p.empresa_id = e.id);

delete from public.contratistas c
 where c.numero_documento = '900999002' and c.nombre like '%(BORRAR)%'
   and not exists (select 1 from public.contratos k where k.contratista_id = c.id);  -- arrastra sus documentos

-- ------------------------------------------------ contadores al último que quede
select setval('public.requisiciones_numero_seq',
              coalesce((select max(numero) from public.requisiciones), 1),
              exists (select 1 from public.requisiciones));
select setval('public.ordenes_compra_numero_seq',
              coalesce((select max(numero) from public.ordenes_compra), 1),
              exists (select 1 from public.ordenes_compra));
select setval('public.pedidos_insumos_codigo_seq',
              coalesce((select max(codigo_consecutivo) from public.pedidos_insumos), 1),
              exists (select 1 from public.pedidos_insumos));
select setval(pg_get_serial_sequence('public.contratos', 'numero'),
              coalesce((select max(numero) from public.contratos), 1),
              exists (select 1 from public.contratos));
select setval(pg_get_serial_sequence('public.entradas_almacen', 'numero'),
              coalesce((select max(numero) from public.entradas_almacen), 1),
              exists (select 1 from public.entradas_almacen));

-- ------------------------------------------------------------ comprobación
-- Todo debe dar 0.
select
  (select count(*) from public.proyectos where codigo = 'ZZ-PRUEBA-VOLUMEN')                 as proyecto,
  (select count(*) from public.empresas where nit = '900999001-1')                            as empresa,
  (select count(*) from public.contratistas where numero_documento = '900999002')             as contratista,
  (select count(*) from public.apu where id in (select id from _apu))                         as apus,
  (select count(*) from public.notificaciones where entidad_id in (select id from _ent))      as notificaciones,
  (select count(*) from public.historial_eventos where entidad_id in (select id from _ent))   as historial;

commit;

-- ============================================================================
-- OPCIONAL (aparte): 3 compras de prueba que ya estaban antes en el historial
-- de precios (fuente 'test_desarrollo', julio-agosto 2026). Mueven el precio
-- promedio de esos insumos. Quitar el comentario para borrarlas.
-- ============================================================================
-- delete from public.historico_precios_compra where fuente = 'test_desarrollo';

-- ============================================================================
-- ARCHIVOS (Supabase -> Storage). Borrar estas carpetas completas:
--   * bucket "contratistas": carpeta 32ee4deb-c69c-4d61-9051-151d109eebd1  (6 PDF)
--   * bucket "contratos":    carpeta 05e455ed-3be9-492c-9c6a-7fa39c6de2c5  (3 PDF)
-- ============================================================================
