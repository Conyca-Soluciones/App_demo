-- Reversa de 20270101001200_balances.sql. Quita funciones, políticas, permisos y
-- el parche a eliminar_empresa. Las TABLAS y el bucket se dejan (borrarlas
-- perdería los saldos y movimientos registrados); si de verdad se quieren
-- borrar, al final están comentadas.

begin;

create or replace function pg_temp._deshacer(p_fn regprocedure, p_nuevo text, p_viejo text)
returns void
language plpgsql
as $$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  if position(p_nuevo in d) = 0 then
    return;
  end if;
  execute replace(d, p_nuevo, p_viejo);
end;
$$;

select pg_temp._deshacer('public.eliminar_empresa(uuid)'::regprocedure,
  $b$  select count(*) into n from public.cuentas_empresa c
   where c.empresa_id = p_empresa_id
     and (exists (select 1 from public.cuentas_saldo_inicial s where s.cuenta_id = c.id)
          or exists (select 1 from public.movimientos_bancarios m where m.cuenta_id = c.id or m.cuenta_destino_id = c.id));
  if n > 0 then v_usos := v_usos || (n || case when n = 1 then ' cuenta con saldos en Balances' else ' cuentas con saldos en Balances' end); end if;

$b$, '');

drop function if exists public.movimientos_consolidado_gerencia(text[], integer[], integer[], uuid, text, uuid, timestamptz[], timestamptz[]);
drop function if exists public.listar_movimientos_bancarios(uuid, text, date, date, boolean, integer, integer);
drop function if exists public.extracto_cuenta(uuid, date, date);
drop function if exists public.saldos_bancarios();
drop function if exists public._lineas_balance(uuid);
drop function if exists public.eliminar_movimiento_bancario(uuid, text);
drop function if exists public.guardar_movimiento_bancario(uuid, jsonb);
drop function if exists public.guardar_saldo_inicial(uuid, numeric, date);
drop function if exists public._exigir_registrar_balances();

drop policy if exists balances_soportes_insert on storage.objects;
drop policy if exists balances_soportes_delete on storage.objects;
drop policy if exists balances_soportes_select on storage.objects;

delete from public.rol_permisos where permiso in ('tab.ayf.balances_saldos', 'tab.ayf.balances_movimientos',
                                                  'accion.registrar_movimientos_bancarios');

-- drop table public.balances_cambios, public.movimientos_bancarios, public.cuentas_saldo_inicial, public.contadores_balances;
-- drop function public._ve_balances(uuid);

commit;
