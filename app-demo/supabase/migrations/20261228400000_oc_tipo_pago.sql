-- Tipo de pago de la orden de compra (decisión del usuario, 2026-11-05): al
-- generar la OC se elige De contado, Crédito o Fiducia; con Crédito, la fecha
-- futura en que se debe pagar. Es aparte del método de pago (Transferencia o
-- PSE, 20261219000000): sus propias columnas, su propia función y sus propios
-- parámetros. Es INFORMATIVO: el pago llega a Aprobación de pagos como siempre
-- (aprobarlo aprueba la orden) y Gerencia / A&F ven el tipo y la fecha.
-- `crear_orden_compra_con_soporte` gana p_tipo_pago y p_fecha_pago_credito
-- (parchada sobre su versión VIVA, texto exacto) y llama a
-- `_fijar_tipo_pago_orden` en la misma transacción. Sin tipo (código de antes
-- del deploy) la orden se crea igual: la pantalla lo exige. Las OC de antes
-- quedan sin tipo. Se puede correr dos veces. Va después de 20261227000000 (antes se llamaba 20261228000000_oc_tipo_pago; ese número lo usa otra rama).

alter table public.ordenes_compra
  add column if not exists tipo_pago text,
  add column if not exists fecha_pago_credito date;

alter table public.ordenes_compra drop constraint if exists ordenes_compra_tipo_pago_check;
alter table public.ordenes_compra add constraint ordenes_compra_tipo_pago_check
  check (tipo_pago is null or tipo_pago in ('contado', 'credito', 'fiducia'));
alter table public.ordenes_compra drop constraint if exists ordenes_compra_fecha_credito_check;
alter table public.ordenes_compra add constraint ordenes_compra_fecha_credito_check
  check ((tipo_pago = 'credito' and fecha_pago_credito is not null)
         or (tipo_pago is distinct from 'credito' and fecha_pago_credito is null));

create or replace function public._fijar_tipo_pago_orden(p_orden_id uuid, p_tipo text, p_fecha date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tipo is null then
    return;  -- código de antes: la orden queda sin tipo
  end if;
  if p_tipo not in ('contado', 'credito', 'fiducia') then
    raise exception 'El tipo de pago debe ser de contado, crédito o fiducia.';
  end if;
  if p_tipo = 'credito' then
    if p_fecha is null then
      raise exception 'Escribe la fecha en que se debe pagar el crédito.';
    end if;
    if p_fecha <= (now() at time zone 'America/Bogota')::date then
      raise exception 'La fecha de pago del crédito tiene que ser posterior a hoy.';
    end if;
  end if;
  update public.ordenes_compra
     set tipo_pago = p_tipo,
         fecha_pago_credito = case when p_tipo = 'credito' then p_fecha end
   where id = p_orden_id;
end;
$$;
revoke all on function public._fijar_tipo_pago_orden(uuid, text, date) from public, anon, authenticated;

do $$
declare
  f regprocedure;
  d text;
  a_firma text := 'p_pago jsonb DEFAULT NULL::jsonb)';
  a_llamada text := '  perform public._fijar_pago_orden(v_id, p_pago);';
begin
  if exists (select 1 from pg_proc where proname = 'crear_orden_compra_con_soporte'
              and pg_get_function_identity_arguments(oid) like '%p_tipo_pago%') then
    return;
  end if;
  select p.oid::regprocedure into f from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'crear_orden_compra_con_soporte';
  d := pg_get_functiondef(f);
  if position(a_firma in d) = 0 or position(a_llamada in d) = 0 then
    raise exception 'crear_orden_compra_con_soporte no tiene el texto esperado.';
  end if;
  d := replace(d, a_firma, 'p_pago jsonb DEFAULT NULL::jsonb, p_tipo_pago text DEFAULT NULL::text, p_fecha_pago_credito date DEFAULT NULL::date)');
  d := replace(d, a_llamada, a_llamada || E'\n  perform public._fijar_tipo_pago_orden(v_id, p_tipo_pago, p_fecha_pago_credito);');
  -- Con otra firma no se puede reemplazar: se quita la vieja (si no, quedan dos).
  execute format('drop function %s', f);
  execute d;
end $$;

revoke all on function public.crear_orden_compra_con_soporte(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, numeric, text, date, jsonb, jsonb, text, date) from public, anon;
grant execute on function public.crear_orden_compra_con_soporte(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, numeric, text, date, jsonb, jsonb, text, date) to authenticated, service_role;
