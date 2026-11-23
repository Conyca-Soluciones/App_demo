-- Reversa de 20270101005300: quita el bloque "Pagos de semanas anteriores sin pagar"
-- de _pendientes_de (mismo parche al revés).
begin;
create or replace function pg_temp._quitar(p_fn regprocedure)
returns void language plpgsql as $f$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
  i int := position('  -- ------------------------------------------------ Pagos de semanas anteriores sin pagar (Financiera)' in d);
  j int := position('  -- ------------------------------------------------ Cuentas de terceros por verificar' in d);
begin
  if i = 0 then return; end if;
  execute left(d, i - 1) || substr(d, j);
end;
$f$;
select pg_temp._quitar('public._pendientes_de(uuid)'::regprocedure);
commit;
