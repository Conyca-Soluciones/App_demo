-- Rendimiento: permisos de lectura de Storage sin árboles anidados.
--
-- Sigue a 20270101006300. En storage.objects las políticas de lectura de TODOS los
-- buckets se planean en cada consulta (abrir o firmar un archivo cualquiera). Las que
-- leían otra tabla con RLS (actas, contratos, dispersiones, pagos, soportes de OC y
-- entradas, pólizas, pagos administrativos, SINCO, RUT de terceros) expandían en el
-- plan las políticas de esas tablas: ~16 MB por archivo (antes de 006300, 57 MB).
-- Ahora esa lectura va en funciones plpgsql SECURITY INVOKER (mismas políticas
-- adentro: cada usuario ve los mismos archivos). Reversa en supabase/reversa/.

-- Funciones: cada una devuelve lo que la política antes leía con EXISTS / IN
-- directo. SECURITY INVOKER: adentro aplican las mismas políticas de la tabla.
create or replace function public._ids_actas_visibles() returns setof text
language plpgsql stable security invoker set search_path = public as $f$
begin return query select a.id::text from public.actas a; end $f$;

create or replace function public._ids_contratos_visibles() returns setof text
language plpgsql stable security invoker set search_path = public as $f$
begin return query select c.id::text from public.contratos c; end $f$;

create or replace function public._ids_dispersiones_visibles() returns setof text
language plpgsql stable security invoker set search_path = public as $f$
begin return query select d.id::text from public.dispersiones d; end $f$;

create or replace function public._rutas_pagos_pse_visibles() returns setof text
language plpgsql stable security invoker set search_path = public as $f$
begin
  return query
    select p.pago_comprobante_ruta from public.pagos p where p.pago_comprobante_ruta is not null
    union all
    select p.pago_soporte_ruta from public.pagos p where p.pago_soporte_ruta is not null;
end $f$;

create or replace function public._rutas_entradas_visibles() returns setof text
language plpgsql stable security invoker set search_path = public as $f$
begin return query select s.ruta from public.entrada_soportes s where s.ruta is not null; end $f$;

create or replace function public._rutas_ordenes_compra_visibles() returns setof text
language plpgsql stable security invoker set search_path = public as $f$
begin
  return query
    select s.ruta from public.orden_compra_soportes s where s.ruta is not null
    union all
    select f.ruta from public.orden_compra_facturas f where f.ruta is not null;
end $f$;

create or replace function public._rutas_polizas_visibles() returns setof text
language plpgsql stable security invoker set search_path = public as $f$
begin return query select p.ruta from public.contrato_polizas p where p.ruta is not null; end $f$;

create or replace function public._rutas_requisiciones_admin_visibles() returns setof text
language plpgsql stable security invoker set search_path = public as $f$
begin return query select i.soporte_ruta from public.requisicion_admin_items i where i.soporte_ruta is not null; end $f$;

create or replace function public._rutas_sinco_visibles() returns setof text
language plpgsql stable security invoker set search_path = public as $f$
begin return query select f.soporte_ruta from public.sinco_filas f where f.soporte_ruta is not null; end $f$;

create or replace function public._rutas_rut_terceros_visibles() returns setof text
language plpgsql stable security invoker set search_path = public as $f$
begin return query select t.rut_ruta from public.terceros t where t.rut_ruta is not null; end $f$;

revoke execute on function public._ids_actas_visibles(), public._ids_contratos_visibles(), public._ids_dispersiones_visibles(),
  public._rutas_pagos_pse_visibles(), public._rutas_entradas_visibles(), public._rutas_ordenes_compra_visibles(),
  public._rutas_polizas_visibles(), public._rutas_requisiciones_admin_visibles(), public._rutas_sinco_visibles(),
  public._rutas_rut_terceros_visibles() from public, anon;
grant execute on function public._ids_actas_visibles(), public._ids_contratos_visibles(), public._ids_dispersiones_visibles(),
  public._rutas_pagos_pse_visibles(), public._rutas_entradas_visibles(), public._rutas_ordenes_compra_visibles(),
  public._rutas_polizas_visibles(), public._rutas_requisiciones_admin_visibles(), public._rutas_sinco_visibles(),
  public._rutas_rut_terceros_visibles() to authenticated;

-- Políticas: misma condición, la lectura de la otra tabla va por la función.
alter policy actas_archivos_select on storage.objects
  using (bucket_id = 'actas' and (storage.foldername(name))[1] in (select public._ids_actas_visibles()));

alter policy contratos_archivos_select on storage.objects
  using (bucket_id = 'contratos'
    and (storage.foldername(name))[1] in (select public._ids_contratos_visibles())
    and ((select public.tiene_pestana((select auth.uid()), 'contratos.solicitar'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.contratos'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_minutas'))));

alter policy dispersores_archivos_select on storage.objects
  using (bucket_id = 'dispersores'
    and ((select public.tiene_pestana((select auth.uid()), 'ayf.realizar_pagos'))
      or (storage.foldername(name))[1] in (select public._ids_dispersiones_visibles())));

alter policy dispersores_comprobante_pse_select on storage.objects
  using (bucket_id = 'dispersores' and (storage.foldername(name))[1] = 'pse'
    and name in (select public._rutas_pagos_pse_visibles()));

alter policy entradas_archivos_select on storage.objects
  using (bucket_id = 'entradas' and name in (select public._rutas_entradas_visibles()));

alter policy ordenes_compra_archivos_select on storage.objects
  using (bucket_id = 'ordenes_compra' and name in (select public._rutas_ordenes_compra_visibles()));

alter policy polizas_archivos_select on storage.objects
  using (bucket_id = 'polizas' and name in (select public._rutas_polizas_visibles()));

alter policy requisiciones_admin_archivos_select on storage.objects
  using (bucket_id = 'requisiciones_admin'
    and ((storage.foldername(name))[1] = ((select auth.uid()))::text
      or name in (select public._rutas_requisiciones_admin_visibles())));

alter policy sinco_soportes_select on storage.objects
  using (bucket_id = 'sinco'
    and ((storage.foldername(name))[1] in (select c.c::text from public._cuadros_sinco_visibles((select auth.uid())) c(c))
      or name in (select public._rutas_sinco_visibles())));

alter policy terceros_rut_select on storage.objects
  using (bucket_id = 'terceros' and (select public._puede_ver_rut((select auth.uid())))
    and name in (select public._rutas_rut_terceros_visibles()));
