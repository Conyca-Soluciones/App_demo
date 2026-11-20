-- Reversa de 20270101005100_modificar_requisicion_administrativa.sql: quita la
-- función y lo que se agregó al detalle (el código que lo usa sale antes).

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

drop function if exists public.modificar_requisicion_administrativa(uuid, uuid, jsonb, date, boolean, text, text);
select pg_temp._parche('public.detalle_requisicion_administrativa(uuid)'::regprocedure,
  $a$'id', p.id, 'insumo_id', p.insumo_id, 'insumo_codigo', mi.codigo,$a$,
  $b$'id', p.id, 'insumo_codigo', mi.codigo,$b$);
select pg_temp._parche('public.detalle_requisicion_administrativa(uuid)'::regprocedure,
  $a$
    'proyecto_id', v_r.proyecto_id,
    'modificable', v_r.solicitado_por = v_uid
                   and exists (select 1 from public.pedidos_insumos p where p.grupo_pedido_id = p_id and p.estado = 'pendiente')
                   and not exists (select 1 from public.pedidos_insumos p
                                    where p.grupo_pedido_id = p_id and p.estado not in ('pendiente', 'cancelado')),$a$,
  '');

commit;
