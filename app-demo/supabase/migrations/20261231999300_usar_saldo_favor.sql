-- Paquete C, entrega 3: usar el saldo a favor en la siguiente orden de compra
-- al mismo proveedor (decisiones del usuario, 2026-11-11).
--
-- En Generar OC, Compras decide marcar "Usar saldo a favor" (no se aplica
-- solo). La orden se crea igual y en la MISMA transacción se descuenta el saldo
-- de sus pagos por aprobar (primero el saldo, después el anticipo / pago
-- único): `crear_orden_compra_con_saldo` envuelve a
-- `crear_orden_compra_con_soporte` (que no cambia; sin saldo la app la sigue
-- llamando igual). El pago muestra el desglose: valor documento = costo de la
-- orden, otros descuentos = saldo a favor aplicado, valor = lo que se paga.
--
-- Si el saldo cubre todo, el pago queda en $ 0 (decisión del usuario): Gerencia
-- lo aprueba igual y al aprobarlo queda liquidado en $ 0 y "dispersado" (pagado
-- con saldo a favor), sin REF ni dispersor (Realizar Pagos solo toma pagos con
-- REF). Si la orden se cancela o se rechaza, el saldo vuelve a quedar disponible
-- (lo disponible solo cuenta órdenes vigentes).
--
-- SOLO AGREGA, salvo tres ajustes:
--   * `pagos.valor` acepta 0 solo con saldo a favor aplicado (CHECK);
--   * `_pago_desglose_origen` (parche por texto exacto, falla sin cambiar
--     nada): el saldo aplicado va en otros descuentos y suma al valor documento;
--   * `_motivo_orden_no_modificable` (parche por texto exacto): una OC con
--     saldo a favor aplicado no se modifica (se cancela y se crea de nuevo).
-- No toca ningún dato existente. Se puede correr dos veces. Va después de
-- 20261231999200. Reversa: supabase/reversa/20261231999300_usar_saldo_favor.sql

begin;

alter table public.pagos add column if not exists saldo_favor_aplicado numeric(18,2) not null default 0;

alter table public.pagos drop constraint if exists pagos_valor_check;
alter table public.pagos add constraint pagos_valor_check
  check (valor > 0 or (valor = 0 and saldo_favor_aplicado > 0));

-- ------------------------------------------ desglose del pago de una OC
do $$
declare
  d text := pg_get_functiondef('public._pago_desglose_origen()'::regprocedure);
  a1 text := 'new.otros_descuentos := 0;';
  b1 text := 'new.otros_descuentos := coalesce(new.saldo_favor_aplicado, 0);';
  a2 text := 'new.valor_documento := new.valor + v_ant;';
  b2 text := 'new.valor_documento := new.valor + v_ant + coalesce(new.saldo_favor_aplicado, 0);';
begin
  if position(b1 in d) > 0 and position(b2 in d) > 0 then
    return;  -- ya aplicado
  end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 then
    raise exception '_pago_desglose_origen no tiene el texto esperado.';
  end if;
  execute replace(replace(d, a1, b1), a2, b2);
end $$;

-- ------------------------------------------------ aplicar el saldo a una OC
create or replace function public._aplicar_saldo_favor_orden(p_orden_id uuid, p_valor numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valor numeric := round(coalesce(p_valor, 0), 2);
  v_oc record;
  v_total numeric;
  v_s record;
  v_disp numeric;
  v_toma numeric;
  v_resto numeric;
  v_hay numeric := 0;
  v_p record;
  v_menos numeric;
begin
  if v_valor <= 0 then
    return;
  end if;
  select o.id, o.estado, o.proveedor_id, o.saldo_favor_aplicado, p.empresa_id
    into v_oc
    from ordenes_compra o left join proyectos p on p.id = o.proyecto_id
   where o.id = p_orden_id
   for update of o;
  if not found then raise exception 'La orden de compra no existe.'; end if;
  if v_oc.estado <> 'pendiente_aprobacion' then
    raise exception 'El saldo a favor se usa al crear la orden de compra.';
  end if;
  if v_oc.saldo_favor_aplicado > 0 then
    raise exception 'Esta orden ya usa saldo a favor.';
  end if;
  v_total := round(public.total_orden_compra(p_orden_id), 0);
  if v_valor > v_total then
    raise exception 'No se puede usar más saldo a favor que el valor de la orden (%).', to_char(v_total, 'FM999G999G999G990');
  end if;

  -- Los saldos del proveedor en la empresa, del más viejo al más nuevo
  -- (bloqueados: dos órdenes no usan el mismo saldo a la vez).
  v_resto := v_valor;
  for v_s in
    select s.id from proveedor_saldos_favor s
     where s.proveedor_id = v_oc.proveedor_id
       and s.empresa_id is not distinct from v_oc.empresa_id
       and s.cerrado_at is null
     order by s.created_at, s.id
     for update
  loop
    v_disp := public._saldo_favor_disponible(v_s.id);
    v_hay := v_hay + v_disp;
    continue when v_disp <= 0 or v_resto <= 0;
    v_toma := least(v_disp, v_resto);
    insert into saldo_favor_aplicaciones (saldo_id, orden_compra_id, valor, creado_por)
    values (v_s.id, p_orden_id, v_toma, auth.uid());
    v_resto := v_resto - v_toma;
  end loop;
  if v_resto > 0 then
    raise exception 'El saldo a favor disponible de este proveedor no alcanza (hay %).', to_char(v_hay, 'FM999G999G999G990');
  end if;

  update ordenes_compra set saldo_favor_aplicado = v_valor where id = p_orden_id;

  -- Se descuenta de los pagos por aprobar de la orden: primero el saldo.
  v_resto := v_valor;
  for v_p in
    select id, valor from pagos
     where orden_compra_id = p_orden_id and estado in ('solicitado', 'programado')
     order by (tipo = 'saldo') desc, valor desc, id
     for update
  loop
    exit when v_resto <= 0;
    v_menos := least(v_resto, v_p.valor);
    update pagos set valor = valor - v_menos, saldo_favor_aplicado = saldo_favor_aplicado + v_menos where id = v_p.id;
    v_resto := v_resto - v_menos;
  end loop;
  if v_resto > 0 then
    raise exception 'No se encontró el pago de la orden para descontar el saldo a favor.';
  end if;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('orden_compra', p_orden_id, 'saldo_favor_aplicado', auth.uid(),
          jsonb_build_object('valor', v_valor, 'total_orden', v_total, 'a_pagar', v_total - v_valor));
end;
$$;
revoke all on function public._aplicar_saldo_favor_orden(uuid, numeric) from public, anon, authenticated;

-- La orden con su soporte y, en la misma transacción, el saldo a favor.
create or replace function public.crear_orden_compra_con_saldo(
  p_proyecto_id uuid, p_proveedor_id uuid, p_sitio_entrega text, p_fecha_entrega date,
  p_contacto_nombre text, p_telefono text, p_ciudad text, p_email text, p_condiciones_pago text,
  p_observaciones text, p_lineas jsonb, p_soporte jsonb, p_saldo_favor numeric,
  p_anticipo_porcentaje numeric default null, p_saldo_modo text default null, p_saldo_fecha date default null,
  p_titular jsonb default null, p_pago jsonb default null, p_tipo_pago text default null,
  p_fecha_pago_credito date default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(p_saldo_favor, 0) <= 0 then
    raise exception 'Escribe cuánto saldo a favor se usa.';
  end if;
  v_id := public.crear_orden_compra_con_soporte(
    p_proyecto_id => p_proyecto_id, p_proveedor_id => p_proveedor_id, p_sitio_entrega => p_sitio_entrega,
    p_fecha_entrega => p_fecha_entrega, p_contacto_nombre => p_contacto_nombre, p_telefono => p_telefono,
    p_ciudad => p_ciudad, p_email => p_email, p_condiciones_pago => p_condiciones_pago,
    p_observaciones => p_observaciones, p_lineas => p_lineas, p_soporte => p_soporte,
    p_anticipo_porcentaje => p_anticipo_porcentaje, p_saldo_modo => p_saldo_modo, p_saldo_fecha => p_saldo_fecha,
    p_titular => p_titular, p_pago => p_pago, p_tipo_pago => p_tipo_pago, p_fecha_pago_credito => p_fecha_pago_credito);
  perform public._aplicar_saldo_favor_orden(v_id, p_saldo_favor);
  return v_id;
end;
$$;
revoke all on function public.crear_orden_compra_con_saldo(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, numeric, numeric, text, date, jsonb, jsonb, text, date) from public, anon;
grant execute on function public.crear_orden_compra_con_saldo(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, numeric, numeric, text, date, jsonb, jsonb, text, date) to authenticated;

-- ------------------------- pago en $ 0 cubierto por saldo a favor: pagado
-- Al aprobarlo (o al liberarse un crédito en $ 0) queda con su semana,
-- liquidado en $ 0 y dispersado, sin REF: no pasa por Contabilidad ni por el
-- dispersor. Corre después de que la OC sigue a su pago (trg_oc_sigue_pago).
create or replace function public._pago_saldo_favor_cubierto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._pago_asignar_item(new.id);
  update pagos
     set liquidacion_estado = 'liquidado', liq_base = 0, liq_iva = 0, retefuente = 0, reteiva = 0, reteica = 0,
         asumidas = 0, liquidaciones = 0, liq_anticipos_descuentos = 0, valor_a_pagar = 0,
         liquidado_en = now(), liquidado_por = new.aprobado_por,
         estado = 'dispersado', dispersado_en = now()
   where id = new.id and estado = 'aprobado';
  return null;
end;
$$;
revoke all on function public._pago_saldo_favor_cubierto() from public, anon, authenticated;

drop trigger if exists trg_pago_saldo_favor_cubierto on public.pagos;
create trigger trg_pago_saldo_favor_cubierto
  after update of estado on public.pagos
  for each row
  when (new.valor = 0 and new.saldo_favor_aplicado > 0 and new.estado = 'aprobado' and old.estado is distinct from 'aprobado')
  execute function public._pago_saldo_favor_cubierto();

-- --------------------------- una OC con saldo a favor aplicado no se modifica
do $$
declare
  d text := pg_get_functiondef('public._motivo_orden_no_modificable(uuid)'::regprocedure);
  ancla text := '  if v_o.estado_entrega <> ''sin_entregar''';
  nuevo text := '  if exists (select 1 from ordenes_compra c where c.id = p_orden_id and c.saldo_favor_aplicado > 0) then
    return ''La orden usa saldo a favor: para cambiarla, cancélala (el saldo vuelve a quedar disponible) y créala de nuevo.'';
  end if;
';
begin
  if position('c.saldo_favor_aplicado > 0' in d) > 0 then
    return;  -- ya aplicado
  end if;
  if position(ancla in d) = 0 then
    raise exception '_motivo_orden_no_modificable no tiene el texto esperado.';
  end if;
  execute replace(d, ancla, nuevo || ancla);
end $$;

commit;
