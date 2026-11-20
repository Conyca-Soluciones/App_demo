-- Reversa de 20270101005200_solicitud_insumo_extraordinaria.sql: los avisos
-- vuelven a como estaban. El origen 'requisicion_extraordinaria' y la entidad
-- 'solicitud_insumo' se dejan en los CHECK (puede haber filas con ellos).

begin;
set local lock_timeout = '10s';

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $f$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  if position(p_a in d) = 0 then return; end if;
  execute replace(d, p_a, p_b);
end;
$f$;

select pg_temp._parche('public._notificar_insumo_aprobado()'::regprocedure,
  $a$    case when v_presupuesto is not null then 'presupuesto'
         when new.origen = 'requisicion_extraordinaria' then 'solicitud_insumo'
         else 'pedido_insumo' end,$a$,
  $b$    case when v_presupuesto is null then 'pedido_insumo' else 'presupuesto' end,$b$);
select pg_temp._parche('public._notificar_insumo_aprobado()'::regprocedure,
  $a$case when v_presupuesto is null and new.origen = 'requisicion_extraordinaria'
                then '. Ya puedes pedirlo en una requisición extraordinaria.'
              when v_presupuesto is null then '. Ya puedes hacer la requisición.'$a$,
  $b$case when v_presupuesto is null then '. Ya puedes hacer la requisición.'$b$);
select pg_temp._parche('public._notificar_insumo_rechazado()'::regprocedure,
  $a$    'insumo_rechazado',
    case when v_presupuesto is not null then 'presupuesto'
         when new.origen = 'requisicion_extraordinaria' then 'solicitud_insumo'
         when new.origen = 'requisicion_administrativa' then 'pedido_insumo'
         else 'presupuesto' end,$a$,
  $b$    'insumo_rechazado',
    'presupuesto',$b$);

commit;
