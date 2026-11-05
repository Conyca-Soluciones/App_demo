-- Otrosí: también BAJAR la cantidad de una actividad del contrato (pedido del
-- usuario, 2026-11-05; antes solo se podía aumentar o agregar actividades).
--
-- Una reducción es una actividad del otrosí con tipo 'reduccion' sobre una fila
-- del anexo del contrato. Se puede bajar hasta lo que falta por cobrar en actas
-- no rechazadas, y baja el valor del contrato (su total es negativo; el valor
-- nuevo sigue siendo vigente + total, y no puede quedar por debajo de lo ya
-- cobrado: _validar_valor_otrosi).
--
-- Al aprobarse, la fila del contrato firmado NO cambia (como con las
-- adiciones): se suma en `contrato_anexo_items.cantidad_reducida`, y la cantidad
-- que vale de ahí en adelante es cantidad − cantidad_reducida: el tope de cada
-- actividad en las actas (_guardar_acta, contrato_para_acta, detalle_acta), lo
-- contratado del ítem en el presupuesto (_contratado_item,
-- items_presupuesto_para_contrato, actividades_para_otrosi) y lo que se puede
-- volver a aumentar. El presupuesto que se libera queda disponible para otros
-- contratos.
--
-- Parcha la versión VIVA de esas funciones (texto exacto, falla si no lo
-- encuentra). Va después de 20261228000000. Se puede correr más de una vez.

alter table public.contrato_anexo_items
  add column if not exists cantidad_reducida numeric not null default 0;
alter table public.contrato_anexo_items drop constraint if exists contrato_anexo_items_cantidad_reducida_check;
alter table public.contrato_anexo_items add constraint contrato_anexo_items_cantidad_reducida_check
  check (cantidad_reducida >= 0 and cantidad_reducida <= cantidad);

-- Reemplaza `buscar` por `nuevo` en la función viva (una vez). Si ya tiene
-- `marca`, no hace nada (la migración ya corrió).
create or replace function pg_temp.parchar(p_funcion regprocedure, p_buscar text, p_nuevo text, p_marca text)
returns void
language plpgsql
as $$
declare
  v text := pg_get_functiondef(p_funcion);
begin
  if position(p_marca in v) > 0 then
    return;
  end if;
  if position(p_buscar in v) = 0 then
    raise exception '% cambió: no se encontró el texto a parchar.', p_funcion;
  end if;
  execute replace(v, p_buscar, p_nuevo);
end;
$$;

-- ---------------------------------------------------------------- lo contratado de un ítem
create or replace function public._contratado_item(p_presupuesto_id uuid, p_codigo text)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(sum(ai.cantidad - ai.cantidad_reducida), 0)
  from public.contrato_anexo_items ai
  join public.contratos c on c.id = ai.contrato_id
  join public.presupuesto_items p2 on p2.id = ai.presupuesto_item_id
  where p2.presupuesto_id = p_presupuesto_id and p2.codigo = p_codigo
    and c.estado <> 'rechazada'
$function$;

select pg_temp.parchar('public.items_presupuesto_para_contrato(uuid)'::regprocedure,
  $b$sum(ai.cantidad) as total$b$,
  $r$sum(ai.cantidad - ai.cantidad_reducida) as total$r$,
  $m$ai.cantidad - ai.cantidad_reducida$m$);

-- ---------------------------------------------------------------- formulario del otrosí
select pg_temp.parchar('public.actividades_para_otrosi(uuid)'::regprocedure,
  $b$sum(ai.cantidad) as total$b$,
  $r$sum(ai.cantidad - ai.cantidad_reducida) as total$r$,
  $m$sum(ai.cantidad - ai.cantidad_reducida)$m$);
select pg_temp.parchar('public.actividades_para_otrosi(uuid)'::regprocedure,
  $b$select ai.id, ai.orden, ai.actividad, ai.unidad, ai.cantidad, ai.valor_unitario, p2.codigo$b$,
  $r$select ai.id, ai.orden, ai.actividad, ai.unidad, ai.cantidad - ai.cantidad_reducida as cantidad, ai.valor_unitario, p2.codigo$r$,
  $m$ai.cantidad - ai.cantidad_reducida as cantidad$m$);
-- Lo cobrado de cada actividad: hasta ahí se puede bajar.
select pg_temp.parchar('public.actividades_para_otrosi(uuid)'::regprocedure,
  $b$'cantidad', pr.cantidad, 'valor_unitario', pr.valor_unitario,$b$,
  $r$'cantidad', pr.cantidad, 'valor_unitario', pr.valor_unitario,
                 'cobrado', coalesce((select sum(x.cantidad) from acta_actividades x join actas o on o.id = x.acta_id
                                       where x.contrato_anexo_item_id = pr.id and o.estado <> 'rechazada'), 0),$r$,
  $m$'cobrado'$m$);

-- ---------------------------------------------------------------- actividades del otrosí
select pg_temp.parchar('public._normalizar_actividades_otrosi(uuid, jsonb)'::regprocedure,
  $b$  v_sin_mo boolean;
$b$,
  $r$  v_sin_mo boolean;
  v_cobrado numeric;
$r$,
  $m$v_cobrado numeric$m$);
select pg_temp.parchar('public._normalizar_actividades_otrosi(uuid, jsonb)'::regprocedure,
  $b$    if v_cant is null or v_cant <= 0 then
      raise exception 'Cada actividad del otrosí necesita una cantidad mayor que cero.';
    end if;
$b$,
  $r$    if v_cant is null or v_cant <= 0 then
      raise exception 'Cada actividad del otrosí necesita una cantidad mayor que cero.';
    end if;

    -- Reducción: menos cantidad de una actividad del contrato, hasta lo que
    -- falta por cobrar en actas no rechazadas. Su total es negativo.
    if e->>'tipo' = 'reduccion' then
      begin
        select ai.id, ai.actividad, ai.unidad, ai.valor_unitario, ai.sin_mano_obra, ai.presupuesto_item_id,
               ai.cantidad - ai.cantidad_reducida as vigente, p2.codigo
          into v_ai
          from contrato_anexo_items ai
          left join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
         where ai.id = (e->>'anexo_item_id')::uuid and ai.contrato_id = p_contrato_id
         for update of ai;
      exception when invalid_text_representation then
        raise exception 'Una actividad no es de este contrato.';
      end;
      if not found then
        raise exception 'Una actividad no es de este contrato.';
      end if;
      select coalesce(sum(x.cantidad), 0) into v_cobrado
        from acta_actividades x join actas o on o.id = x.acta_id
       where x.contrato_anexo_item_id = v_ai.id and o.estado <> 'rechazada';
      if v_cant > v_ai.vigente - v_cobrado then
        raise exception 'No se puede bajar "%" en %: lo que falta por cobrar en actas es %.',
          v_ai.actividad, v_cant, greatest(v_ai.vigente - v_cobrado, 0);
      end if;
      if coalesce(v_ai.codigo, v_ai.id::text) = any (v_codigos) then
        raise exception 'La actividad "%" está repetida en las actividades del otrosí.', v_ai.actividad;
      end if;
      v_codigos := v_codigos || coalesce(v_ai.codigo, v_ai.id::text);
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'tipo', 'reduccion', 'anexo_item_id', v_ai.id, 'presupuesto_item_id', v_ai.presupuesto_item_id,
        'codigo', v_ai.codigo, 'actividad', regexp_replace(v_ai.actividad, ' \((adición )?Otrosí N° \d+\)$', ''),
        'unidad', v_ai.unidad, 'cantidad', v_cant, 'valor_unitario', v_ai.valor_unitario,
        'total', -round(v_cant * v_ai.valor_unitario, 2), 'sin_mano_obra', v_ai.sin_mano_obra));
      continue;
    end if;
$r$,
  $m$'reduccion'$m$);

-- Al aprobar: las reducciones no son filas nuevas del anexo; suman en
-- cantidad_reducida de la actividad.
select pg_temp.parchar('public.resolver_otrosi(uuid, text, text, jsonb)'::regprocedure,
  $b$        from jsonb_array_elements(v_acts) with ordinality as t(e, ord);
$b$,
  $r$        from jsonb_array_elements(v_acts) with ordinality as t(e, ord)
       where t.e->>'tipo' is distinct from 'reduccion';
      update contrato_anexo_items ai
         set cantidad_reducida = ai.cantidad_reducida + (t.e->>'cantidad')::numeric
        from jsonb_array_elements(v_acts) as t(e)
       where t.e->>'tipo' = 'reduccion' and ai.id = (t.e->>'anexo_item_id')::uuid;
$r$,
  $m$cantidad_reducida = ai.cantidad_reducida$m$);

-- ---------------------------------------------------------------- actas: la cantidad vigente
select pg_temp.parchar('public._guardar_acta(uuid, uuid, jsonb)'::regprocedure,
  $b$select i.id, i.orden, i.actividad, i.unidad, i.cantidad, i.valor_unitario into v_item$b$,
  $r$select i.id, i.orden, i.actividad, i.unidad, i.cantidad - i.cantidad_reducida as cantidad, i.valor_unitario into v_item$r$,
  $m$i.cantidad - i.cantidad_reducida as cantidad$m$);
select pg_temp.parchar('public.contrato_para_acta(uuid, uuid)'::regprocedure,
  $b$'cantidad', i.cantidad, 'valor_unitario', i.valor_unitario,$b$,
  $r$'cantidad', i.cantidad - i.cantidad_reducida, 'valor_unitario', i.valor_unitario,$r$,
  $m$'cantidad', i.cantidad - i.cantidad_reducida$m$);
select pg_temp.parchar('public.detalle_acta(uuid)'::regprocedure,
  $b$'cantidad_contratada', i.cantidad,$b$,
  $r$'cantidad_contratada', i.cantidad - i.cantidad_reducida,$r$,
  $m$'cantidad_contratada', i.cantidad - i.cantidad_reducida$m$);
