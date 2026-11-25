-- Reversa de 20270101006400: devuelve las políticas de Storage a como estaban y borra las funciones.
begin;
alter policy actas_archivos_select on storage.objects
  using (bucket_id = 'actas' and exists (select 1 from public.actas a where a.id::text = (storage.foldername(objects.name))[1]));
alter policy contratos_archivos_select on storage.objects
  using (bucket_id = 'contratos'
    and exists (select 1 from public.contratos c where c.id::text = (storage.foldername(objects.name))[1])
    and ((select public.tiene_pestana((select auth.uid()), 'contratos.solicitar'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.contratos'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_minutas'))));
alter policy dispersores_archivos_select on storage.objects
  using (bucket_id = 'dispersores'
    and ((select public.tiene_pestana((select auth.uid()), 'ayf.realizar_pagos'))
      or exists (select 1 from public.dispersiones d where d.id::text = (storage.foldername(objects.name))[1])));
alter policy dispersores_comprobante_pse_select on storage.objects
  using (bucket_id = 'dispersores' and (storage.foldername(name))[1] = 'pse'
    and (name in (select p.pago_comprobante_ruta from public.pagos p where p.pago_comprobante_ruta is not null)
      or name in (select p.pago_soporte_ruta from public.pagos p where p.pago_soporte_ruta is not null)));
alter policy entradas_archivos_select on storage.objects
  using (bucket_id = 'entradas' and exists (select 1 from public.entrada_soportes s where s.ruta = objects.name));
alter policy ordenes_compra_archivos_select on storage.objects
  using (bucket_id = 'ordenes_compra'
    and (exists (select 1 from public.orden_compra_soportes s where s.ruta = objects.name)
      or exists (select 1 from public.orden_compra_facturas f where f.ruta = objects.name)));
alter policy polizas_archivos_select on storage.objects
  using (bucket_id = 'polizas' and exists (select 1 from public.contrato_polizas p where p.ruta = objects.name));
alter policy requisiciones_admin_archivos_select on storage.objects
  using (bucket_id = 'requisiciones_admin'
    and ((storage.foldername(name))[1] = ((select auth.uid()))::text
      or exists (select 1 from public.requisicion_admin_items i where i.soporte_ruta = objects.name)));
alter policy sinco_soportes_select on storage.objects
  using (bucket_id = 'sinco'
    and ((storage.foldername(name))[1] in (select c.c::text from public._cuadros_sinco_visibles((select auth.uid())) c(c))
      or name in (select f.soporte_ruta from public.sinco_filas f where f.soporte_ruta is not null)));
alter policy terceros_rut_select on storage.objects
  using (bucket_id = 'terceros' and (select public._puede_ver_rut((select auth.uid())))
    and name in (select t.rut_ruta from public.terceros t where t.rut_ruta is not null));
drop function if exists public._ids_actas_visibles();
drop function if exists public._ids_contratos_visibles();
drop function if exists public._ids_dispersiones_visibles();
drop function if exists public._rutas_pagos_pse_visibles();
drop function if exists public._rutas_entradas_visibles();
drop function if exists public._rutas_ordenes_compra_visibles();
drop function if exists public._rutas_polizas_visibles();
drop function if exists public._rutas_requisiciones_admin_visibles();
drop function if exists public._rutas_sinco_visibles();
drop function if exists public._rutas_rut_terceros_visibles();
commit;
