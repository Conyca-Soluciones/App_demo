-- ===========================================================================
-- Caja menor: Contabilidad liquida GASTO POR GASTO y Financiera dispersa UN pago
-- (decisiones del usuario, 2026-11-26). Todos los gastos se reembolsan; solo
-- algunos llevan retenciones.
--
-- El reembolso sigue siendo un solo pago (cuadro tipo caja_menor de un ítem).
-- Contabilidad, desde la ventana de ese pago en el Consolidado, liquida cada
-- gasto (base, IVA, retefuente, ReteIVA, ReteICA y valor a pagar, o "sin
-- retenciones" = valor a pagar = valor del gasto); puede guardar unos hoy y
-- otros después. Cuando todos están liquidados, el pago queda liquidado con la
-- SUMA (por liquidar_pagos_lote, con sus mismas reglas) y Financiera lo
-- dispersa como cualquier pago. El pago de caja menor ya no se liquida directo
-- (pantalla ni Excel). Para cambiar un gasto ya liquidado: devolver el pago a
-- Por liquidar (como cualquier pago liquidado).
--
-- Va antes que el código. Reversa: supabase/reversa/20270101007600_caja_menor_liquidacion_por_gasto.sql
-- ===========================================================================
begin;

alter table public.caja_menor_gastos
  add column if not exists liq_base numeric(16, 2),
  add column if not exists liq_iva numeric(16, 2),
  add column if not exists retefuente numeric(16, 2),
  add column if not exists reteiva numeric(16, 2),
  add column if not exists reteica numeric(16, 2),
  add column if not exists valor_a_pagar numeric(16, 2),
  add column if not exists liquidado_en timestamptz,
  add column if not exists liquidado_por uuid references public.perfiles(id);
create index if not exists caja_menor_gastos_liquidado_por_idx on public.caja_menor_gastos (liquidado_por);

-- El reembolso de caja menor de un pago (null si el pago no es de caja menor).
create or replace function public._legalizacion_de_pago(p_pago public.pagos)
returns uuid language sql stable security definer set search_path = public as $$
  select l.id from public.caja_menor_legalizaciones l
    join public.requisiciones_admin r on r.id = l.requisicion_admin_id
   where r.id = p_pago.requisicion_admin_id and r.tipo = 'caja_menor'
   order by l.aprobada_en desc nulls last limit 1
$$;
revoke execute on function public._legalizacion_de_pago(public.pagos) from public;

-- Liquidar gastos de la caja menor de un pago. p_filas = [{gasto_id, base, iva,
-- retefuente, reteiva, reteica, valor_a_pagar, sin_retenciones}]; una fila sin
-- ningún valor deja ese gasto sin liquidar. Devuelve {gastos, liquidados, pago_liquidado}.
create or replace function public.liquidar_gastos_caja_menor(p_pago uuid, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.pagos;
  v_leg uuid;
  v_f jsonb;
  v_g public.caja_menor_gastos;
  v_n jsonb;
  c text;
  v_num numeric;
  v_vap numeric;
  v_sin boolean;
  v_campos constant text[] := array['base', 'iva', 'retefuente', 'reteiva', 'reteica', 'valor_a_pagar'];
  v_tot record;
  v_res jsonb;
begin
  if not public.tiene_accion(auth.uid(), 'liquidar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para liquidar pagos.';
  end if;
  v := public._pago_para_liquidar(p_pago);
  if v.liquidacion_estado is null then
    raise exception 'Financiera todavía no lo ha enviado a liquidar.';
  end if;
  if v.liquidacion_estado = 'liquidado' then
    raise exception 'Ya está liquidado: para cambiar un gasto, devuelve el pago a Por liquidar.';
  end if;
  v_leg := public._legalizacion_de_pago(v);
  if v_leg is null then
    raise exception 'Este pago no es el reembolso de una caja menor.';
  end if;
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) > 200 then
    raise exception 'Se esperaba una lista de hasta 200 gastos.';
  end if;

  for v_f in select * from jsonb_array_elements(p_filas) loop
    select * into v_g from public.caja_menor_gastos
     where id = nullif(v_f ->> 'gasto_id', '')::uuid and legalizacion_id = v_leg for update;
    if v_g.id is null then
      raise exception 'Un gasto no es de esta caja menor.';
    end if;
    v_n := '{}';
    foreach c in array v_campos loop
      if nullif(btrim(coalesce(v_f ->> c, '')), '') is null then
        v_n := v_n || jsonb_build_object(c, null);
      else
        begin
          v_num := round((v_f ->> c)::numeric, 2);
        exception when others then
          raise exception 'Gasto %: "%" no es un número.', v_g.orden, replace(c, '_', ' ');
        end;
        if v_num < 0 then
          raise exception 'Gasto %: "%" no puede ser negativo.', v_g.orden, replace(c, '_', ' ');
        end if;
        v_n := v_n || jsonb_build_object(c, v_num);
      end if;
    end loop;
    v_sin := coalesce((v_f ->> 'sin_retenciones')::boolean, false);

    if v_sin then
      v_vap := v_g.valor;
      v_n := v_n || jsonb_build_object('retefuente', 0, 'reteiva', 0, 'reteica', 0);
    else
      v_vap := (v_n ->> 'valor_a_pagar')::numeric;
    end if;

    if v_vap is null then
      -- Sin valor a pagar: si no escribió nada, el gasto queda sin liquidar; si
      -- escribió retenciones pero no el valor a pagar, falta el valor.
      if (select bool_or(value <> 'null'::jsonb) from jsonb_each(v_n)) then
        raise exception 'Gasto %: escribe el valor a pagar (o usa sin retenciones).', v_g.orden;
      end if;
      update public.caja_menor_gastos
         set liq_base = null, liq_iva = null, retefuente = null, reteiva = null, reteica = null,
             valor_a_pagar = null, liquidado_en = null, liquidado_por = null
       where id = v_g.id;
      continue;
    end if;
    if v_vap <= 0 or v_vap > v_g.valor then
      raise exception 'Gasto %: el valor a pagar debe ser mayor que cero y no más que el valor del gasto ($ %).',
        v_g.orden, replace(to_char(round(v_g.valor), 'FM999,999,999,990'), ',', '.');
    end if;
    update public.caja_menor_gastos
       set liq_base = (v_n ->> 'base')::numeric, liq_iva = (v_n ->> 'iva')::numeric,
           retefuente = coalesce((v_n ->> 'retefuente')::numeric, 0),
           reteiva = coalesce((v_n ->> 'reteiva')::numeric, 0),
           reteica = coalesce((v_n ->> 'reteica')::numeric, 0),
           valor_a_pagar = v_vap, liquidado_en = now(), liquidado_por = auth.uid()
     where id = v_g.id;
  end loop;

  select count(*) as n, count(valor_a_pagar) as hechos,
         sum(liq_base) as base, sum(liq_iva) as iva, sum(retefuente) as retefuente,
         sum(reteiva) as reteiva, sum(reteica) as reteica, sum(valor_a_pagar) as vap
    into v_tot
    from public.caja_menor_gastos where legalizacion_id = v_leg;

  if v_tot.n > 0 and v_tot.hechos = v_tot.n then
    -- Todos liquidados: el pago queda liquidado con la suma (mismas reglas de siempre).
    perform set_config('app.liquidando_caja_menor', 'on', true);
    v_res := public.liquidar_pagos_lote(jsonb_build_array(jsonb_build_object(
      'pago_id', v.id, 'base', v_tot.base, 'iva', v_tot.iva, 'retefuente', v_tot.retefuente,
      'reteiva', v_tot.reteiva, 'reteica', v_tot.reteica, 'asumidas', 0, 'liquidaciones', 0,
      'anticipos_descuentos', 0, 'valor_a_pagar', v_tot.vap)));
    perform set_config('app.liquidando_caja_menor', '', true);
    if v_res -> 0 ->> 'resultado' = 'error' then
      raise exception '%', v_res -> 0 ->> 'mensaje';
    end if;
    perform public._evento_caja_menor(v_leg, 'liquidada', null,
      jsonb_build_object('pago_id', v.id, 'valor_a_pagar', v_tot.vap));
  end if;

  return jsonb_build_object('gastos', v_tot.n, 'liquidados', v_tot.hechos,
                            'pago_liquidado', v_tot.n > 0 and v_tot.hechos = v_tot.n);
end;
$$;
revoke execute on function public.liquidar_gastos_caja_menor(uuid, jsonb) from public;
grant execute on function public.liquidar_gastos_caja_menor(uuid, jsonb) to authenticated;

-- Detalle: también la liquidación de cada gasto y el pago del reembolso.
create or replace function public.detalle_legalizacion_caja_menor(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_l record;
begin
  select * into v_l from public.caja_menor_legalizaciones where id = p_id;
  if v_l.id is null or (v_l.responsable_id is distinct from auth.uid()
                        and (v_l.estado = 'borrador' or not public._ve_cajas_menores(auth.uid()))) then
    raise exception 'La legalización no existe o no tienes acceso.';
  end if;
  return public._legalizacion_caja_menor_fila(p_id) || jsonb_build_object(
    'gastos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'orden', g.orden, 'fecha', g.fecha, 'proyecto_id', g.proyecto_id,
               'proyecto_codigo', p.codigo, 'proyecto_nombre', p.nombre,
               'solicitado_por_nombre', sp.nombre, 'numero_factura', g.numero_factura,
               'documento', g.documento, 'nombre', g.nombre, 'concepto', g.concepto, 'destino', g.destino,
               'valor', g.valor,
               'soporte', jsonb_build_object('ruta', g.soporte_ruta, 'nombre', g.soporte_nombre,
                                             'mime', g.soporte_mime, 'tamano', g.soporte_tamano),
               'liquidacion', case when g.valor_a_pagar is null then null else jsonb_build_object(
                 'base', g.liq_base, 'iva', g.liq_iva, 'retefuente', g.retefuente, 'reteiva', g.reteiva,
                 'reteica', g.reteica, 'valor_a_pagar', g.valor_a_pagar, 'liquidado_en', g.liquidado_en,
                 'liquidado_por_nombre', lq.nombre) end
             ) order by g.orden)
        from public.caja_menor_gastos g
        join public.proyectos p on p.id = g.proyecto_id
        left join public.perfiles sp on sp.id = g.solicitado_por
        left join public.perfiles lq on lq.id = g.liquidado_por
       where g.legalizacion_id = p_id), '[]'::jsonb),
    'eventos', coalesce((
      select jsonb_agg(jsonb_build_object('evento', h.evento, 'fecha', h.created_at, 'usuario_nombre', u.nombre,
                                          'motivo', h.motivo, 'datos', h.datos) order by h.created_at)
        from public.historial_eventos h
        left join public.perfiles u on u.id = h.usuario_id
       where h.entidad_tipo = 'caja_menor' and h.entidad_id = p_id), '[]'::jsonb),
    'pago', (select jsonb_build_object('id', g.id, 'estado', g.estado, 'liquidacion_estado', g.liquidacion_estado,
                                       'referencia', g.referencia)
               from public.pagos g
              where v_l.requisicion_admin_id is not null and g.requisicion_admin_id = v_l.requisicion_admin_id
              order by g.creado_en desc limit 1),
    'caja', public._caja_menor_json(v_l.caja_id));
end;
$$;

-- El pago de caja menor ya no se liquida directo (pantalla del Consolidado ni Excel).
do $$
declare
  v text;
  ancla text := E'        elsif v.liquidacion_estado = ''liquidado'' then\n'
             || E'          raise exception ''Ya está liquidado: sus valores no se cambian.'';\n'
             || E'        else\n';
begin
  v := pg_get_functiondef('public.liquidar_pagos_lote(jsonb)'::regprocedure);
  if position('app.liquidando_caja_menor' in v) > 0 then
    return; -- ya parchada
  end if;
  if (length(v) - length(replace(v, ancla, ''))) / length(ancla) <> 1 then
    raise exception 'liquidar_pagos_lote cambió: no se encontró dónde liquida.';
  end if;
  execute replace(v, ancla, ancla
    || E'          if public._legalizacion_de_pago(v) is not null\n'
    || E'             and coalesce(current_setting(''app.liquidando_caja_menor'', true), '''') <> ''on'' then\n'
    || E'            raise exception ''Es el reembolso de una caja menor: se liquida gasto por gasto (botón «Liquidar gastos» en la ventana del pago).'';\n'
    || E'          end if;\n');
end;
$$;

commit;
