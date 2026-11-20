-- Solicitar un insumo nuevo desde la requisición extraordinaria (decisión del
-- usuario, 2026-11-20).
--
-- En "Pedir insumo que no está en el presupuesto" de la requisición
-- extraordinaria se busca en el maestro; si el insumo no existe, ahora se puede
-- pedir a Aprobación de insumos ahí mismo (como en las requisiciones
-- administrativas). La solicitud NO se cuelga del ítem del presupuesto (si
-- tuviera presupuesto_item_id, al aprobarla se agregaría al APU del ítem y
-- cambiaría el presupuesto): lleva origen 'requisicion_extraordinaria' y el
-- proyecto. Al aprobarla o rechazarla, el aviso lleva a Elaboración de
-- requisiciones (entidad 'solicitud_insumo'); el rechazo de las de
-- requisiciones administrativas ahora lleva a esa pantalla (antes a
-- Presupuestos).
--
-- Va ANTES del código. Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $f$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  p_a := replace(p_a, E'\r\n', E'\n');
  p_b := replace(p_b, E'\r\n', E'\n');
  if position(p_a in d) = 0 then
    raise exception 'No se encontró el texto a reemplazar en %: %', p_fn, left(p_a, 80);
  end if;
  execute replace(d, p_a, p_b);
end;
$f$;

alter table public.solicitudes_insumos drop constraint if exists solicitudes_insumos_origen_check;
alter table public.solicitudes_insumos
  add constraint solicitudes_insumos_origen_check
  check (origen in ('presupuesto', 'requisicion_administrativa', 'requisicion_extraordinaria'));

alter table public.notificaciones drop constraint if exists notificaciones_entidad_tipo_check;
alter table public.notificaciones add constraint notificaciones_entidad_tipo_check check (entidad_tipo = any (array[
  'cuadro_sinco', 'pedido_insumo', 'orden_compra', 'requisicion', 'contrato', 'acta', 'presupuesto', 'otrosi',
  'requisicion_admin', 'requisicion_espera', 'solicitud_insumo'
]::text[])) not valid;

select pg_temp._parche('public._notificar_insumo_aprobado()'::regprocedure,
  $a$    case when v_presupuesto is null then 'pedido_insumo' else 'presupuesto' end,$a$,
  $b$    case when v_presupuesto is not null then 'presupuesto'
         when new.origen = 'requisicion_extraordinaria' then 'solicitud_insumo'
         else 'pedido_insumo' end,$b$);
select pg_temp._parche('public._notificar_insumo_aprobado()'::regprocedure,
  $a$case when v_presupuesto is null then '. Ya puedes hacer la requisición.'$a$,
  $b$case when v_presupuesto is null and new.origen = 'requisicion_extraordinaria'
                then '. Ya puedes pedirlo en una requisición extraordinaria.'
              when v_presupuesto is null then '. Ya puedes hacer la requisición.'$b$);

select pg_temp._parche('public._notificar_insumo_rechazado()'::regprocedure,
  $a$    'insumo_rechazado',
    'presupuesto',$a$,
  $b$    'insumo_rechazado',
    case when v_presupuesto is not null then 'presupuesto'
         when new.origen = 'requisicion_extraordinaria' then 'solicitud_insumo'
         when new.origen = 'requisicion_administrativa' then 'pedido_insumo'
         else 'presupuesto' end,$b$);

commit;
