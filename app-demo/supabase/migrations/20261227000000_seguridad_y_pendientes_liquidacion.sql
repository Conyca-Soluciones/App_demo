-- Antes de las capacitaciones (2026-11-05, pedido del usuario):
--  1. Seguridad (revisor de Supabase): 16 funciones de `public` se podían
--     ejecutar SIN sesión (rol anon), porque se crearon con el permiso por
--     omisión de Postgres (EXECUTE a PUBLIC). Por dentro piden permiso, pero
--     no deben estar abiertas. Se les quita PUBLIC y anon y se deja
--     authenticated (que ya las usaba) y service_role; y de aquí en adelante
--     las funciones nuevas nacen sin PUBLIC. `_pesos_texto` con search_path fijo.
--  2. Mis pendientes: "Pagos observados por Contabilidad" (a quien gestiona
--     pagos: Financiera) y "Pagos por liquidar" (a quien liquida:
--     Contabilidad), solo de los consolidados que cada uno ve. Se parcha la
--     versión VIVA de _pendientes_de (texto exacto); se puede correr dos veces.
-- Va después de 20261226000000.

-- 1. Seguridad ---------------------------------------------------------------

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

alter function public._pesos_texto(numeric) set search_path = public;

-- 2. Mis pendientes: liquidación ------------------------------------------------

do $$
declare
  d text := pg_get_functiondef('public._pendientes_de(uuid)'::regprocedure);
  a_var text := '  v_gestionar_pagos boolean := public.tiene_accion(p_uid, ''gestionar_pagos'');';
  a_bloque text := '  -- ------------------------------------------------ Cuentas de terceros por verificar';
begin
  if position('pago_por_liquidar' in d) > 0 then return; end if;
  if position(a_var in d) = 0 or position(a_bloque in d) = 0 then
    raise exception '_pendientes_de no tiene el texto esperado.';
  end if;

  d := replace(d, a_var, a_var || E'\n  v_liquidar boolean := public.tiene_accion(p_uid, ''liquidar_pagos'');');
  d := replace(d, a_bloque, $b$  -- ------------------------------------------------ Pagos observados por Contabilidad (Financiera)
  union all
  select 'pago_observado', 'hacer', g.id, g.proyecto_id,
         'ITEM ' || g.item || ' · ' || coalesce(t.razon_social, g.concepto, 'Pago'), left(o.texto, 160),
         g.valor, coalesce(o.creado_en, g.enviado_liquidar_en), o.autor_id, null::date,
         '/ayf/consolidado/' || c.clave || '?etapa=observado'
    from pagos g
    join consolidados c on c.id = g.consolidado_id
    left join terceros t on t.id = g.tercero_id
    left join lateral (select pc.texto, pc.creado_en, pc.autor_id from pago_comentarios pc
                        where pc.pago_id = g.id and pc.tipo = 'observacion'
                        order by pc.creado_en desc limit 1) o on true
   where v_gestionar_pagos and g.estado = 'aprobado' and g.liquidacion_estado = 'observado'
     and g.consolidado_id in (select public._consolidados_visibles(p_uid))

  -- ------------------------------------------------ Pagos por liquidar (Contabilidad)
  union all
  select 'pago_por_liquidar', 'hacer', g.id, g.proyecto_id,
         'ITEM ' || g.item || ' · ' || coalesce(t.razon_social, g.concepto, 'Pago'), c.nombre,
         g.valor, coalesce(g.enviado_liquidar_en, g.aprobado_en), g.enviado_liquidar_por, null::date,
         '/ayf/consolidado/' || c.clave || '?etapa=por_liquidar'
    from pagos g
    join consolidados c on c.id = g.consolidado_id
    left join terceros t on t.id = g.tercero_id
   where v_liquidar and g.estado = 'aprobado' and g.liquidacion_estado = 'por_liquidar'
     and g.consolidado_id in (select public._consolidados_visibles(p_uid))

$b$ || a_bloque);
  execute d;
end $$;
