-- Deshace 20261231999300_usar_saldo_favor.sql. Correr ANTES que la reversa de
-- 20261231999200. OJO: falla si ya hay pagos en $ 0 (pagados con saldo a
-- favor): el CHECK original no los admite. Borra las aplicaciones de saldo.
begin;

drop trigger if exists trg_pago_saldo_favor_cubierto on public.pagos;
drop function if exists public._pago_saldo_favor_cubierto();
drop function if exists public.crear_orden_compra_con_saldo(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, numeric, numeric, text, date, jsonb, jsonb, text, date);
drop function if exists public._aplicar_saldo_favor_orden(uuid, numeric);

do $$
declare
  d text := pg_get_functiondef('public._motivo_orden_no_modificable(uuid)'::regprocedure);
  bloque text := '  if exists (select 1 from ordenes_compra c where c.id = p_orden_id and c.saldo_favor_aplicado > 0) then
    return ''La orden usa saldo a favor: para cambiarla, cancélala (el saldo vuelve a quedar disponible) y créala de nuevo.'';
  end if;
';
begin
  if position(bloque in d) > 0 then execute replace(d, bloque, ''); end if;
end $$;

do $$
declare
  d text := pg_get_functiondef('public._pago_desglose_origen()'::regprocedure);
begin
  d := replace(d, 'new.otros_descuentos := coalesce(new.saldo_favor_aplicado, 0);', 'new.otros_descuentos := 0;');
  d := replace(d, 'new.valor_documento := new.valor + v_ant + coalesce(new.saldo_favor_aplicado, 0);', 'new.valor_documento := new.valor + v_ant;');
  execute d;
end $$;

alter table public.pagos drop constraint if exists pagos_valor_check;
alter table public.pagos add constraint pagos_valor_check check (valor > 0);
alter table public.pagos drop column if exists saldo_favor_aplicado;

commit;
