-- Mis pendientes: pagos de semanas anteriores que siguen sin pagarse (2026-11-23,
-- decisión del usuario: para Financiera).
--
-- Un pago APROBADO (todavía no dispersado ni pagado) cuya semana de pago ya pasó:
-- se quedó en Preparación, Por liquidar, Observado o Liquidado sin dispersar. Le
-- sale a quien tiene la acción gestionar_pagos (Financiera), solo de los
-- consolidados que ve, como los demás pendientes de pagos. Vence el domingo de su
-- semana (sale como vencido). El enlace lleva a la pestaña donde está el pago;
-- los liquidados que no son PSE se dispersan en Realizar Pagos.
--
-- Solo agrega una parte a _pendientes_de (parche por texto exacto sobre la
-- versión viva). Los crédito en espera no cuentan (estado en_espera).

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
  if position(p_b in d) > 0 then
    return;
  end if;
  if position(p_a in d) = 0 then
    raise exception '% no tiene el texto esperado: %', p_fn, left(p_a, 120);
  end if;
  execute replace(d, p_a, p_b);
end;
$f$;

select pg_temp._parche('public._pendientes_de(uuid)'::regprocedure,
$a$  -- ------------------------------------------------ Cuentas de terceros por verificar$a$,
$b$  -- ------------------------------------------------ Pagos de semanas anteriores sin pagar (Financiera)
  union all
  select 'pago_semana_anterior', 'hacer', g.id, g.proyecto_id,
         'REF ' || coalesce(g.referencia, '—') || ' · ' || coalesce(t.razon_social, g.concepto, 'Pago'),
         concat_ws(' · ', 'Semana ' || g.semana || ' de ' || g.anio,
                   case g.liquidacion_estado when 'por_liquidar' then 'Por liquidar' when 'observado' then 'Observado'
                                             when 'liquidado' then 'Liquidado sin pagar' else 'En preparación' end,
                   c.nombre),
         coalesce(g.valor_a_pagar, g.valor), coalesce(g.aprobado_en, g.creado_en), g.aprobado_por,
         to_date(g.anio || '-' || g.semana, 'IYYY-IW') + 6,
         case
           when g.liquidacion_estado = 'liquidado' and not public.pago_es_pse(g) then '/ayf/realizar-pagos'
           else '/ayf/consolidado/' || c.clave || '?etapa=' ||
                case when g.liquidacion_estado = 'liquidado' then 'pse' else coalesce(g.liquidacion_estado, 'preparacion') end
         end
    from pagos g
    join consolidados c on c.id = g.consolidado_id
    left join terceros t on t.id = g.tercero_id
   where v_gestionar_pagos and g.estado = 'aprobado' and g.semana is not null
     and (g.anio, g.semana) < (extract(isoyear from (now() at time zone 'America/Bogota')::date)::int,
                               extract(week from (now() at time zone 'America/Bogota')::date)::int)
     and g.consolidado_id in (select public._consolidados_visibles(p_uid))

  -- ------------------------------------------------ Cuentas de terceros por verificar$b$);

commit;
