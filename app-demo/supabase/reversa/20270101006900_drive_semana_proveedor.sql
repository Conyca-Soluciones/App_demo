-- Reversa de 20270101006900_drive_semana_proveedor.sql: _drive_destino vuelve a la
-- de 20270101006800 (sin semana ni proveedor) y se borran las ayudas. Lo que ya está
-- en Drive no se mueve.

begin;
set local lock_timeout = '10s';

create or replace function public._drive_destino(p_bucket text, p_ruta text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_archivo text := regexp_replace(p_ruta, '^.*/', '');
  v_carpeta text := split_part(p_ruta, '/', 1);
  r record;
begin
  if p_bucket = 'contratos' then
    select c.proyecto_id, c.id as contrato_id, d.tipo, d.nombre_archivo into r
      from public.contrato_documentos d join public.contratos c on c.id = d.contrato_id where d.ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['Contratos', public._drive_carpeta_contrato(r.contrato_id)],
                                     r.tipo || ' - ' || coalesce(r.nombre_archivo, v_archivo));
    end if;
    select c.proyecto_id, c.id as contrato_id into r from public.contratos c where c.firmado_ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['Contratos', public._drive_carpeta_contrato(r.contrato_id)],
                                     'Contrato firmado por el contratista - ' || v_archivo);
    end if;
    select o.proyecto_id, o.contrato_id, o.numero into r from public.otrosis o where o.firmado_ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id,
        array['Contratos', public._drive_carpeta_contrato(r.contrato_id), 'Otrosí N° ' || coalesce(r.numero::text, 'sin número')],
        'Otrosí firmado por el contratista - ' || v_archivo);
    end if;

  elsif p_bucket = 'polizas' then
    select coalesce(p.proyecto_id, c.proyecto_id) as proyecto_id, p.contrato_id, p.nombre_archivo into r
      from public.contrato_polizas p join public.contratos c on c.id = p.contrato_id where p.ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['Contratos', public._drive_carpeta_contrato(r.contrato_id), 'Pólizas'],
                                     coalesce(r.nombre_archivo, v_archivo));
    end if;

  elsif p_bucket = 'actas' then
    select c.proyecto_id, a.contrato_id, a.numero, s.tipo, s.nombre_archivo into r
      from public.acta_soportes s join public.actas a on a.id = s.acta_id join public.contratos c on c.id = a.contrato_id
     where s.ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id,
        array['Contratos', public._drive_carpeta_contrato(r.contrato_id), 'Acta ' || lpad(coalesce(r.numero, 0)::text, 2, '0')],
        r.tipo || ' - ' || coalesce(r.nombre_archivo, v_archivo));
    end if;

  elsif p_bucket = 'ordenes_compra' then
    select o.proyecto_id, o.codigo, o.numero, s.tipo, s.nombre_archivo into r
      from public.orden_compra_soportes s join public.ordenes_compra o on o.id = s.orden_compra_id where s.ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['Órdenes de compra', coalesce(r.codigo, 'OC ' || r.numero)],
                                     r.tipo || ' - ' || coalesce(r.nombre_archivo, v_archivo));
    end if;
    select o.proyecto_id, o.codigo, o.numero, f.nombre_archivo into r
      from public.orden_compra_facturas f join public.ordenes_compra o on o.id = f.orden_compra_id where f.ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['Órdenes de compra', coalesce(r.codigo, 'OC ' || r.numero), 'Facturas'],
                                     coalesce(r.nombre_archivo, v_archivo));
    end if;

  elsif p_bucket = 'entradas' then
    select o.proyecto_id, o.codigo, o.numero as oc_numero, e.numero, s.nombre_archivo into r
      from public.entrada_soportes s
      join public.entradas_almacen e on e.id = s.entrada_id
      join public.ordenes_compra o on o.id = e.orden_compra_id
     where s.ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['Órdenes de compra', coalesce(r.codigo, 'OC ' || r.oc_numero), 'Entradas'],
                                     'Entrada ' || r.numero || ' - ' || coalesce(r.nombre_archivo, v_archivo));
    end if;

  elsif p_bucket = 'requisiciones' then
    select q.proyecto_id, q.codigo, q.numero, x.nombre_archivo into r
      from public.requisicion_anexos x join public.requisiciones q on q.id = x.requisicion_id where x.ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['Requisiciones', coalesce(r.codigo, 'Requisición ' || r.numero)],
                                     coalesce(r.nombre_archivo, v_archivo));
    end if;

  elsif p_bucket = 'requisiciones_admin' then
    select i.proyecto_id, i.codigo into r from public.requisicion_admin_items i where i.soporte_ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['Pagos administrativos', coalesce(r.codigo, 'Sin código')], v_archivo);
    end if;

  elsif p_bucket = 'sinco' then
    select f.proyecto_id, k.numero into r
      from public.sinco_filas f join public.sinco_cuadros k on k.id = f.cuadro_id where f.soporte_ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['SINCO', 'Cuadro ' || r.numero], v_archivo);
    end if;

  elsif p_bucket = 'documentos_firmados' then
    -- PDF aprobado y congelado: <entidad>/<id>[-<código>].pdf
    select d.entidad, d.entidad_id into r from public.documentos_firmados d where d.ruta = p_ruta limit 1;
    if found then
      if r.entidad = 'contrato' then
        return (select public._drive_resultado(c.proyecto_id, array['Contratos', public._drive_carpeta_contrato(c.id)],
                                               'Contrato aprobado (firmado) - ' || v_archivo)
                  from public.contratos c where c.id = r.entidad_id);
      elsif r.entidad = 'otrosi' then
        return (select public._drive_resultado(o.proyecto_id,
                  array['Contratos', public._drive_carpeta_contrato(o.contrato_id), 'Otrosí N° ' || coalesce(o.numero::text, 'sin número')],
                  'Otrosí aprobado (firmado) - ' || v_archivo)
                  from public.otrosis o where o.id = r.entidad_id);
      elsif r.entidad = 'acta' then
        return (select public._drive_resultado(c.proyecto_id,
                  array['Contratos', public._drive_carpeta_contrato(c.id), 'Acta ' || lpad(coalesce(a.numero, 0)::text, 2, '0')],
                  'Acta aprobada (firmada) - ' || v_archivo)
                  from public.actas a join public.contratos c on c.id = a.contrato_id where a.id = r.entidad_id);
      elsif r.entidad = 'orden_compra' then
        return (select public._drive_resultado(o.proyecto_id, array['Órdenes de compra', coalesce(o.codigo, 'OC ' || o.numero)],
                                               'Orden de compra aprobada (firmada) - ' || v_archivo)
                  from public.ordenes_compra o where o.id = r.entidad_id);
      elsif r.entidad = 'poliza' then
        return coalesce(
          (select public._drive_resultado(c.proyecto_id, array['Contratos', public._drive_carpeta_contrato(c.id), 'Pólizas'],
                                          'Acta de aprobación de la póliza - ' || v_archivo)
             from public.contrato_polizas p join public.contratos c on c.id = p.contrato_id where p.id = r.entidad_id),
          (select public._drive_resultado(c.proyecto_id, array['Contratos', public._drive_carpeta_contrato(c.id), 'Pólizas'],
                                          'Acta de aprobación de la póliza - ' || v_archivo)
             from public.contratos c where c.id = r.entidad_id));
      end if;
      return public._drive_resultado(null, array['Documentos firmados', r.entidad], v_archivo);
    end if;

  elsif p_bucket = 'contratistas' then
    select k.numero_documento, k.nombre, d.tipo, d.nombre_archivo into r
      from public.contratista_documentos d join public.contratistas k on k.id = d.contratista_id where d.ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(null, array['Contratistas', r.numero_documento || ' - ' || r.nombre],
                                     r.tipo || ' - ' || coalesce(r.nombre_archivo, v_archivo));
    end if;

  elsif p_bucket = 'terceros' then
    select t.numero_documento, t.razon_social into r from public.terceros t where t.rut_ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(null, array['Terceros', r.numero_documento || ' - ' || r.razon_social], 'RUT - ' || v_archivo);
    end if;
    select t.numero_documento, t.razon_social into r
      from public.terceros_cuentas k join public.terceros t on t.id = k.tercero_id where k.certificacion_ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(null, array['Terceros', r.numero_documento || ' - ' || r.razon_social],
                                     'Certificación bancaria - ' || v_archivo);
    end if;

  elsif p_bucket = 'dispersores' then
    if v_carpeta = 'pse' then
      select p.referencia into r from public.pagos p
       where p.pago_comprobante_ruta = p_ruta or p.pago_soporte_ruta = p_ruta limit 1;
      if found then
        return public._drive_resultado(null, array['Pagos', 'PSE y otros medios'],
                                       coalesce('REF ' || r.referencia || ' - ', '') || v_archivo);
      end if;
    else
      select d.anio, d.semana into r from public.dispersiones d where d.id::text = v_carpeta limit 1;
      if found then
        return public._drive_resultado(null, array['Pagos', 'Dispersores', r.anio || ' - Semana ' || lpad(r.semana::text, 2, '0')],
                                       v_archivo);
      end if;
    end if;

  elsif p_bucket = 'balances' then
    select m.codigo into r from public.movimientos_bancarios m where m.soporte_ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(null, array['Balances'], coalesce(r.codigo || ' - ', '') || v_archivo);
    end if;
  end if;

  return null;  -- todavía no se sabe (o el bucket no se ubica): tomar_drive reintenta
end;
$$;

revoke all on function public._drive_destino(text, text) from public, anon, authenticated;
drop function if exists public._drive_carpetas_oc(uuid);
drop function if exists public._drive_semana(timestamptz);

commit;
