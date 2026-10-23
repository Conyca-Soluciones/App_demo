-- Contratos: método de pago Transferencia o PSE (decisión del usuario,
-- 2026-10-23; como en las órdenes de compra, 20261219000000). Va DESPUÉS de
-- 20261219000000: parcha lo que esa dejó en _pago_novedad y _enlazar_pagos_tercero.
--
-- En la solicitud (contratos por grupos y generales), en "Forma de pago", se
-- elige Transferencia o PSE. Con PSE se escribe en observaciones la información
-- para pagar (obligatoria). Transferencia: igual que antes, a la cuenta del
-- contratista en Terceros (el contratista se inscribe en Terceros al crearlo,
-- con la cuenta PENDIENTE para A&F: 20261118700000) o de un titular aparte.
-- Los pagos de las actas de un contrato PSE van sin cuenta, sin titular aparte
-- y sin la novedad "falta cuenta"; A&F ve las observaciones en el pago.
--
-- Funciones vivas parchadas (texto exacto; falla si no lo encuentra el número
-- de veces esperado; si ya está aplicado, lo salta): crear_solicitud_contrato,
-- reenviar_solicitud_contrato, crear_contrato_general, reenviar_contrato_general,
-- contrato_para_acta, _pago_de_acta, _pago_novedad y _enlazar_pagos_tercero.

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'ordenes_compra' and column_name = 'metodo_pago') then
    raise exception 'Corre primero 20261219000000_oc_metodo_pago_pse.sql.';
  end if;
end $$;

-- 1. Columnas -----------------------------------------------------------------

alter table public.contratos
  add column if not exists metodo_pago text not null default 'transferencia',
  add column if not exists pago_observaciones text;

alter table public.contratos drop constraint if exists contratos_metodo_pago_check;
alter table public.contratos add constraint contratos_metodo_pago_check
  check (metodo_pago in ('transferencia', 'pse'));

-- 2. Guardar el método de la solicitud ----------------------------------------

-- p_datos.metodo_pago / pago_observaciones. Sin metodo_pago (código anterior)
-- no cambia nada.
create or replace function public._fijar_pago_contrato(p_id uuid, p_datos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metodo text := nullif(p_datos ->> 'metodo_pago', '');
  v_obs text := nullif(btrim(coalesce(p_datos ->> 'pago_observaciones', '')), '');
begin
  if v_metodo is null then
    return;
  end if;
  if v_metodo not in ('transferencia', 'pse') then
    raise exception 'El método de pago debe ser Transferencia o PSE.';
  end if;
  if v_metodo = 'pse' and v_obs is null then
    raise exception 'Escribe en observaciones la información para pagar por PSE.';
  end if;
  update public.contratos
     set metodo_pago = v_metodo,
         pago_observaciones = case when v_metodo = 'pse' then v_obs end
   where id = p_id;
end;
$$;
revoke all on function public._fijar_pago_contrato(uuid, jsonb) from public, anon, authenticated;

-- 3. Funciones vivas, parchadas ------------------------------------------------

do $$
declare
  -- función, texto a buscar, reemplazo, veces que debe aparecer
  v_cambios constant text[][] := array[
    ['crear_solicitud_contrato',
     '  perform public._fijar_requiere_poliza(p_id, p_datos);',
     E'  perform public._fijar_requiere_poliza(p_id, p_datos);\n  perform public._fijar_pago_contrato(p_id, p_datos);',
     '1'],
    ['reenviar_solicitud_contrato',
     '  perform public._fijar_requiere_poliza(p_id, p_datos);',
     E'  perform public._fijar_requiere_poliza(p_id, p_datos);\n  perform public._fijar_pago_contrato(p_id, p_datos);',
     '1'],
    ['crear_contrato_general',
     '  perform public._fijar_requiere_poliza(p_id, p_datos);',
     E'  perform public._fijar_requiere_poliza(p_id, p_datos);\n  perform public._fijar_pago_contrato(p_id, p_datos);',
     '1'],
    ['reenviar_contrato_general',
     '  perform public._fijar_requiere_poliza(p_id, p_datos);',
     E'  perform public._fijar_requiere_poliza(p_id, p_datos);\n  perform public._fijar_pago_contrato(p_id, p_datos);',
     '1'],
    -- El formulario del acta no ofrece titular aparte en un contrato PSE.
    ['contrato_para_acta',
     '    ''poliza_estado'', v.poliza_estado,',
     E'    ''poliza_estado'', v.poliza_estado,\n    -- Método de pago del contrato (20261220000000).\n    ''metodo_pago'', v.metodo_pago,',
     '1'],
    ['_pago_de_acta',
     'a.titular_tercero_id, a.cuenta_tercero_id as titular_cuenta_id',
     'a.titular_tercero_id, a.cuenta_tercero_id as titular_cuenta_id, c.metodo_pago',
     '1'],
    ['_pago_de_acta',
     '  v_concepto := upper(case v.tipo',
     E'  -- Contrato por PSE: sin cuenta ni titular aparte.\n'
       || E'  if v.metodo_pago = ''pse'' then\n'
       || E'    v_cuenta := null;\n'
       || E'    v.titular_tercero_id := null;\n'
       || E'  end if;\n'
       || E'  v_concepto := upper(case v.tipo',
     '1'],
    ['_pago_novedad',
     'left join public.ordenes_compra oc on oc.id = p.orden_compra_id',
     E'left join public.ordenes_compra oc on oc.id = p.orden_compra_id\n'
       || E'  left join public.actas ac on ac.id = p.acta_id\n'
       || E'  left join public.contratos ct on ct.id = ac.contrato_id',
     '1'],
    ['_pago_novedad',
     'case when r.metodo = ''pse'' or oc.metodo_pago = ''pse'' then null',
     'case when r.metodo = ''pse'' or oc.metodo_pago = ''pse'' or ct.metodo_pago = ''pse'' then null',
     '1'],
    -- Un pago de acta de un contrato PSE no recibe cuenta después.
    ['_enlazar_pagos_tercero',
     '                          where o.id = pg.orden_compra_id and o.metodo_pago = ''pse'')',
     E'                          where o.id = pg.orden_compra_id and o.metodo_pago = ''pse'')\n'
       || E'         and not exists (select 1 from public.actas a2\n'
       || E'                           join public.contratos c2 on c2.id = a2.contrato_id\n'
       || E'                          where a2.id = pg.acta_id and c2.metodo_pago = ''pse'')',
     '1']
  ];
  v_def text;
  v_n int;
  i int;
begin
  for i in 1 .. array_length(v_cambios, 1) loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_cambios[i][1];
    if v_def is null then
      raise exception 'No existe la función %.', v_cambios[i][1];
    end if;
    -- Ya aplicado (la migración se corre por segunda vez).
    if position(v_cambios[i][3] in v_def) > 0 then
      continue;
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_cambios[i][2], ''))) / length(v_cambios[i][2]);
    if v_n <> v_cambios[i][4]::int then
      raise exception 'En % se esperaba encontrar % veces el texto % (veces: %): ¿cambió la función?',
        v_cambios[i][1], v_cambios[i][4], v_cambios[i][2], v_n;
    end if;
    execute replace(v_def, v_cambios[i][2], v_cambios[i][3]);
  end loop;
end $$;
