-- Eliminar un tercero (2026-11-24, decisión del usuario): Financiera (editar_terceros) y el
-- Administrador. Solo si no se usa en nada (pagos, proveedor, contratista, órdenes, contratos,
-- actas, otrosí, pagos administrativos): si se usa, dice dónde y no borra. Borra también sus
-- cuentas. Queda en terceros_auditoria (evento "Tercero borrado" / "Cuenta borrada" en Auditoría).
-- Los archivos (RUT, certificaciones) se dejan en el bucket.
-- Solo agrega una función: no toca datos existentes.

create or replace function public.eliminar_tercero(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_usos text[] := '{}';
  v_n int;
  v_txt text;
begin
  if v_uid is null or not public.tiene_accion(v_uid, 'editar_terceros') then
    raise exception 'No tienes permiso para eliminar terceros.';
  end if;
  perform 1 from terceros where id = p_id for update;
  if not found then
    raise exception 'El tercero ya no existe.';
  end if;

  select count(*) into v_n from pagos p
   where p.tercero_id = p_id or p.titular_tercero_id = p_id
      or p.cuenta_tercero_id in (select id from terceros_cuentas where tercero_id = p_id);
  if v_n > 0 then v_usos := v_usos || format('%s pago(s)', v_n); end if;

  select string_agg(coalesce(id_prov, nombre), ', ') into v_txt from proveedores where tercero_id = p_id;
  if v_txt is not null then v_usos := v_usos || ('el proveedor ' || v_txt); end if;

  select string_agg(nombre, ', ') into v_txt from contratistas where tercero_id = p_id;
  if v_txt is not null then v_usos := v_usos || ('el contratista ' || v_txt); end if;

  select count(*) into v_n from ordenes_compra
   where titular_tercero_id = p_id or cuenta_tercero_id in (select id from terceros_cuentas where tercero_id = p_id);
  if v_n > 0 then v_usos := v_usos || format('%s orden(es) de compra', v_n); end if;

  select count(*) into v_n from contratos
   where titular_tercero_id = p_id or cuenta_tercero_id in (select id from terceros_cuentas where tercero_id = p_id);
  if v_n > 0 then v_usos := v_usos || format('%s contrato(s)', v_n); end if;

  select count(*) into v_n from actas
   where titular_tercero_id = p_id or cuenta_tercero_id in (select id from terceros_cuentas where tercero_id = p_id);
  if v_n > 0 then v_usos := v_usos || format('%s acta(s)', v_n); end if;

  select count(*) into v_n from otrosis
   where titular_tercero_id = p_id or cuenta_tercero_id in (select id from terceros_cuentas where tercero_id = p_id);
  if v_n > 0 then v_usos := v_usos || format('%s otrosí', v_n); end if;

  select count(*) into v_n from requisicion_admin_items
   where tercero_factura_id = p_id or titular_tercero_id = p_id
      or cuenta_tercero_id in (select id from terceros_cuentas where tercero_id = p_id);
  if v_n > 0 then v_usos := v_usos || format('%s pago(s) administrativo(s)', v_n); end if;

  if array_length(v_usos, 1) > 0 then
    raise exception 'No se puede eliminar: el tercero se usa en %.', array_to_string(v_usos, ', ');
  end if;

  delete from terceros_cuentas where tercero_id = p_id;
  delete from terceros where id = p_id;
end;
$$;

revoke execute on function public.eliminar_tercero(uuid) from public;
grant execute on function public.eliminar_tercero(uuid) to authenticated;
