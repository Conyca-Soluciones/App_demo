-- Un acta con pago (neto redondeado > 0) exige al menos un soporte tipo
-- 'factura' (decisión del usuario). Se revisa en _pago_de_acta, que crear_acta
-- y editar_acta llaman al final, después de agregar y quitar soportes; el
-- error deshace toda la transacción. Liquidación con neto $ 0: sin pago, sin
-- factura. Mismo cuerpo que en la base (20261112100000) + la revisión.
create or replace function public._pago_de_acta(p_acta_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v record;
  v_valor numeric;
  v_tercero uuid;
  v_cuenta uuid;
  v_concepto text;
  v_pago uuid;
begin
  select a.id, a.numero, a.tipo, a.estado, a.neto, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero) as numero_contrato,
         k.numero_documento, k.nombre as contratista_nombre, py.empresa_id, e.consolidado_id
    into v
  from actas a
  join contratos c on c.id = a.contrato_id
  join contratistas k on k.id = c.contratista_id
  left join proyectos py on py.id = c.proyecto_id
  left join empresas e on e.id = py.empresa_id
  where a.id = p_acta_id;
  if not found or v.estado <> 'pendiente' then
    return;
  end if;

  select g.id into v_pago from pagos g where g.acta_id = p_acta_id and g.estado = 'solicitado'
   order by g.creado_en desc limit 1;
  v_valor := round(v.neto, 0);

  if v_valor <= 0 then
    if v_pago is not null then
      update pagos set estado = 'anulado', anulado_en = now(),
                       motivo_anulacion = 'El neto del acta quedó en cero o negativo.'
       where id = v_pago;
    end if;
    perform public._aprobar_acta(p_acta_id, auth.uid(), null);
    return;
  end if;

  if not exists (select 1 from acta_soportes s where s.acta_id = p_acta_id and s.tipo = 'factura') then
    raise exception 'Adjunta la factura del contratista: el acta con pago la exige.';
  end if;

  -- Tercero = documento del contratista; la cuenta se elige sola si tiene UNA verificada.
  select t.id into v_tercero from terceros t where t.numero_documento = v.numero_documento limit 1;
  if v_tercero is not null then
    select tc.id into v_cuenta from terceros_cuentas tc
     where tc.tercero_id = v_tercero and tc.estado = 'ACTIVO'
       and (select count(*) from terceros_cuentas x where x.tercero_id = v_tercero and x.estado = 'ACTIVO') = 1;
  end if;
  v_concepto := upper(case v.tipo when 'final' then 'Acta final' when 'liquidacion' then 'Acta de liquidación' else 'Acta' end)
                || ' N° ' || v.numero || ' - CONTRATO ' || v.numero_contrato || ' - ' || upper(v.contratista_nombre);

  if v_pago is not null then
    update pagos set valor = v_valor, concepto = v_concepto, solicitado_en = now(),
                     tercero_id = coalesce(tercero_id, v_tercero),
                     cuenta_tercero_id = coalesce(cuenta_tercero_id, v_cuenta)
     where id = v_pago;
  else
    insert into pagos (fuente, acta_id, tipo, proyecto_id, empresa_id, consolidado_id, tercero_id,
                       cuenta_tercero_id, concepto, valor, estado, solicitado_en)
    values ('acta', p_acta_id, 'unico', v.proyecto_id, v.empresa_id, v.consolidado_id, v_tercero, v_cuenta,
            v_concepto, v_valor, 'solicitado', now())
    returning id into v_pago;
  end if;
  perform public._pago_actualizar_novedad(v_pago);
end;
$function$;
