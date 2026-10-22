-- Liquidación: base e IVA de la factura (decisión del usuario, 2026-10-22).
--
-- Las retenciones se calculan sobre la BASE (sin IVA) y el ReteIVA sobre el
-- IVA. Un pago de OC trae su desglose de las líneas, pero uno de requisición
-- administrativa (o cualquiera sin desglose) solo trae el valor total: la base
-- quedaba igual al valor del documento, las retenciones salían sobre el valor
-- con IVA y el ReteIVA nunca aparecía. Ahora Contabilidad pone la base y el
-- IVA de la factura en la liquidación (o confirma los que estima el motor).
--
-- liquidar_pago(p_pago_id, p_datos) acepta en p_datos `base_gravable` e `iva`:
-- si vienen, se revisan (no negativos, base > 0, base + IVA <= valor del
-- documento) y se guardan en el pago ANTES de liquidar, así la liquidación los
-- copia y el consolidado los muestra. Sin ellos, todo sigue igual.
-- La función de siempre pasa a ser _liquidar_pago_lineas (sin EXECUTE para
-- usuarios); el permiso y el bloqueo de la fila los hace esta envoltura.

alter function public.liquidar_pago(uuid, jsonb) rename to _liquidar_pago_lineas;
revoke execute on function public._liquidar_pago_lineas(uuid, jsonb) from public, anon, authenticated;

create or replace function public.liquidar_pago(p_pago_id uuid, p_datos jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p    record;
  v_base numeric;
  v_iva  numeric;
begin
  if not public.tiene_accion(auth.uid(), 'liquidar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para liquidar pagos.';
  end if;

  if p_datos ? 'base_gravable' or p_datos ? 'iva' then
    select g.id, g.estado, g.valor_documento, g.valor into v_p
      from public.pagos g where g.id = p_pago_id for update;
    if not found then
      raise exception 'El pago no existe.';
    end if;
    if v_p.estado not in ('aprobado', 'liquidado') then
      raise exception 'Solo se liquidan pagos aprobados (este está %).', v_p.estado;
    end if;
    v_base := round((p_datos->>'base_gravable')::numeric, 2);
    v_iva := round(coalesce((p_datos->>'iva')::numeric, 0), 2);
    if v_base is null or v_base <= 0 then
      raise exception 'La base de la factura debe ser mayor que cero.';
    end if;
    if v_iva < 0 then
      raise exception 'El IVA no puede ser negativo.';
    end if;
    -- Un peso de holgura por los redondeos de la factura.
    if v_base + v_iva > coalesce(v_p.valor_documento, v_p.valor) + 1 then
      raise exception 'La base más el IVA (%) pasan del valor del documento (%).',
        v_base + v_iva, coalesce(v_p.valor_documento, v_p.valor);
    end if;
    update public.pagos set base_gravable = v_base, iva = v_iva where id = p_pago_id;
  end if;

  return public._liquidar_pago_lineas(p_pago_id, p_datos);
end;
$$;

revoke execute on function public.liquidar_pago(uuid, jsonb) from public, anon;
grant execute on function public.liquidar_pago(uuid, jsonb) to authenticated;
