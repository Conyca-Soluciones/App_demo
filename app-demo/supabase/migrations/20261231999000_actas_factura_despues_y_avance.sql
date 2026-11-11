-- Actas: la factura se sube DESPUÉS de aprobar, y se puede aprobar un AVANCE
-- (pago parcial) con el saldo en espera (decisiones del usuario, 2026-11-11).
--
-- Flujo:
--   1. El ingeniero crea el acta. La factura (o cuenta de cobro) ya no es
--      obligatoria al crearla: muchas veces el contratista factura cuando el
--      acta está aprobada. El pago queda "por aprobar" en Aprobación de pagos,
--      como siempre.
--   2. Quien aprueba pagos aprueba el acta completa o un AVANCE
--      (aprobar_pago_acta con un valor menor): una sola aprobación. Lo que
--      falta se crea como otro pago del mismo acta, "saldo en espera"
--      (pagos.saldo_acta, estado en_espera, sin aprobar). No entra al
--      consolidado; sale en Aprobación de pagos, marcado.
--   3. Si el acta todavía no tiene factura, el pago aprobado queda en_espera
--      (aprobado_en con fecha) y se avisa a quien hizo el acta. Cuando sube la
--      factura (subir_factura_acta) el pago pasa solo a aprobado, con la semana
--      en que se liberó, y sigue al consolidado. Sin otra aprobación.
--   4. "Pagar saldo" = aprobar_pago_acta sobre el saldo (todo o otra parte).
--
-- en_espera de un pago de acta:
--   aprobado_en null      -> saldo en espera (falta decidir cuándo se paga)
--   aprobado_en con fecha -> aprobado, falta la factura del acta
-- (El crédito de las OC también usa en_espera; esos tienen orden_compra_id.)
--
-- Los descuentos del acta (amortización, retención, otros) van en el primer
-- pago; los saldos tienen documento = su valor. Lo pedido + saldos = neto del
-- acta siempre. Se puede correr más de una vez.

alter table public.pagos add column if not exists saldo_acta boolean not null default false;
comment on column public.pagos.saldo_acta is
  'Pago del saldo de un acta a la que se le aprobó un avance (20261231999000).';

-- Aviso nuevo: "acta aprobada, sube la factura".
do $$
declare
  d text;
begin
  select pg_get_constraintdef(oid) into d from pg_constraint
   where conrelid = 'public.notificaciones'::regclass and conname = 'notificaciones_tipo_check';
  if d is null or position('acta_por_facturar' in d) > 0 then return; end if;
  alter table public.notificaciones drop constraint notificaciones_tipo_check;
  execute 'alter table public.notificaciones add constraint notificaciones_tipo_check '
       || replace(d, 'ARRAY[', 'ARRAY[''acta_por_facturar''::text, ');
end $$;

create index if not exists pagos_saldo_acta_espera
  on public.pagos (acta_id) where saldo_acta and estado = 'en_espera';

-- ---------------------------------------------------------------- factura del acta
create or replace function public._acta_tiene_factura(p_acta_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from acta_soportes s
                  where s.acta_id = p_acta_id and s.tipo in ('factura', 'cuenta_cobro'))
$$;
revoke execute on function public._acta_tiene_factura(uuid) from public;

-- ---------------------------------------------------------------- el pago espera la factura
-- Antes de aprobar un pago de acta: sin factura, queda en_espera (aprobado).
create or replace function public._pago_acta_sin_factura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'aprobado' and old.estado in ('solicitado', 'en_espera')
     and new.acta_id is not null and not public._acta_tiene_factura(new.acta_id) then
    new.estado := 'en_espera';
  end if;
  return new;
end;
$$;
revoke execute on function public._pago_acta_sin_factura() from public;

drop trigger if exists trg_pago_acta_sin_factura on public.pagos;
create trigger trg_pago_acta_sin_factura
  before update of estado on public.pagos
  for each row when (old.estado is distinct from new.estado)
  execute function public._pago_acta_sin_factura();

-- ---------------------------------------------------------------- el acta sigue al pago
-- Aprobar el pago aprueba el acta aunque el pago quede esperando la factura.
create or replace function public._acta_sigue_pago()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.acta_id is null or old.estado is not distinct from new.estado or old.estado <> 'solicitado' then
    return new;
  end if;
  if new.estado in ('aprobado', 'en_espera') then
    perform public._aprobar_acta(new.acta_id, new.aprobado_por, new.id);
  elsif new.estado = 'rechazado' then
    perform public._rechazar_acta(new.acta_id, new.rechazado_por, new.motivo_rechazo);
  end if;
  return new;
end;
$$;

create or replace function public._aprobar_acta(p_acta_id uuid, p_usuario uuid, p_pago_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_nombre text;
  v_pago_valor numeric;
  v_pago_estado text;
  v_saldo numeric := 0;
  v_mensaje text;
begin
  select a.id, a.numero, a.tipo, a.estado, a.neto, a.creado_por, a.contrato_id,
         coalesce(c.numero_contrato, c.codigo) as numero_contrato
    into v
  from actas a join contratos c on c.id = a.contrato_id
  where a.id = p_acta_id
  for update of a;
  if not found or v.estado <> 'pendiente' then
    return;
  end if;

  update actas set estado = 'aprobada', resuelto_por = p_usuario, resuelto_at = now(), motivo_resolucion = null
   where id = p_acta_id;
  if v.tipo = 'liquidacion' then
    update contratos set liquidado_at = now() where id = v.contrato_id and liquidado_at is null;
  end if;

  if p_pago_id is not null then
    select g.valor, g.estado into v_pago_valor, v_pago_estado from pagos g where g.id = p_pago_id;
    select coalesce(sum(g.valor), 0) into v_saldo from pagos g
     where g.acta_id = p_acta_id and g.saldo_acta and g.estado = 'en_espera' and g.aprobado_en is null;
  end if;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('acta', p_acta_id, 'aprobada', p_usuario,
          case when p_pago_id is not null
               then jsonb_build_object('pago_id', p_pago_id, 'neto', v.neto, 'aprobado', v_pago_valor,
                                       'saldo', v_saldo, 'falta_factura', v_pago_estado is not distinct from 'en_espera')
               else jsonb_build_object('sin_pago', true, 'neto', v.neto) end);

  v_nombre := case v.tipo when 'final' then 'Acta final' when 'liquidacion' then 'Acta de liquidación' else 'Acta' end;
  if v.creado_por is not null and v.creado_por is distinct from p_usuario then
    v_mensaje := v_nombre || ' ' || v.numero || ' del contrato ' || v.numero_contrato;
    if p_pago_id is null then
      v_mensaje := v_mensaje || ' aprobada (sin pago: el neto es cero o negativo).';
    else
      v_mensaje := v_mensaje || ': aprobada'
        || case when v_saldo > 0
                then ' con un avance de ' || '$ ' || replace(to_char(v_pago_valor, 'FM999G999G999G999'), ',', '.') || ' (el saldo de '
                     || '$ ' || replace(to_char(v_saldo, 'FM999G999G999G999'), ',', '.') || ' queda en espera)'
                else '' end
        || case when v_pago_estado is not distinct from 'en_espera'
                then '. Sube la factura o cuenta de cobro del contratista para que el pago pase a A&F.'
                else '. Su pago sigue en A&F.' end;
    end if;
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    values (v.creado_por,
            case when v_pago_estado is not distinct from 'en_espera' then 'acta_por_facturar' else 'acta_aprobada' end,
            'acta', p_acta_id,
            v_nombre || ' aprobada' || case when v_pago_estado is not distinct from 'en_espera' then ': sube la factura' else '' end,
            v_mensaje);
  end if;
end;
$$;

-- ---------------------------------------------------------------- pago del acta sin exigir factura
do $$
declare
  d text := replace(pg_get_functiondef('public._pago_de_acta'::regproc), E'\r\n', E'\n');
  a text := E'  if not exists (select 1 from acta_soportes s where s.acta_id = p_acta_id and s.tipo in (''factura'', ''cuenta_cobro'')) then\n    raise exception ''Adjunta el soporte de pago (factura o cuenta de cobro del contratista): el acta con pago lo exige.'';\n  end if;\n';
begin
  if position(a in d) = 0 then
    if position('el acta con pago lo exige' in d) = 0 then return; end if;  -- ya aplicada
    raise exception '_pago_de_acta no tiene el texto esperado.';
  end if;
  execute replace(d, a, E'  -- La factura se puede subir después de aprobar (20261231999000).\n');
end $$;

-- ---------------------------------------------------------------- desglose de los saldos
-- El saldo no repite los descuentos del acta (ya van en el primer pago).
do $$
declare
  d text := replace(pg_get_functiondef('public._pago_desglose_origen'::regproc), E'\r\n', E'\n');
  a text := E'  elsif new.fuente = ''acta'' and new.acta_id is not null then\n';
  b text := E'  elsif new.fuente = ''acta'' and new.acta_id is not null and new.saldo_acta then\n'
         || E'    -- Saldo de un acta con avance (20261231999000): sin los descuentos del acta.\n'
         || E'    if new.solicitado_por is null then\n'
         || E'      select a.creado_por into new.solicitado_por from public.actas a where a.id = new.acta_id;\n'
         || E'    end if;\n'
         || E'    new.descuento_anticipos := 0;\n'
         || E'    new.retencion_garantia := 0;\n'
         || E'    new.otros_descuentos := 0;\n'
         || E'    new.valor_documento := new.valor;\n'
         || E'    new.base_gravable := new.valor;\n'
         || E'    new.iva := 0;\n';
begin
  if position('new.saldo_acta' in d) > 0 then return; end if;
  if position(a in d) = 0 then
    raise exception '_pago_desglose_origen no tiene el texto esperado.';
  end if;
  execute replace(d, a, b || a);
end $$;

-- ---------------------------------------------------------------- aprobar total o un avance
-- p_valor null = todo el pago. Sirve para el pago por aprobar del acta y para
-- "Pagar saldo" (saldo en espera). Lo que no se aprueba queda como saldo.
create or replace function public.aprobar_pago_acta(p_pago_id uuid, p_valor numeric default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  v_valor numeric;
  v_saldo uuid;
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para aprobar pagos.';
  end if;

  select * into g from pagos where id = p_pago_id for update;
  if not found or g.acta_id is null then
    raise exception 'El pago no existe o no es de un acta.';
  end if;
  if not (g.estado = 'solicitado' or (g.estado = 'en_espera' and g.saldo_acta and g.aprobado_en is null)) then
    raise exception 'El pago ya no está pendiente de aprobación (actualiza la página).';
  end if;

  v_valor := round(coalesce(p_valor, g.valor), 0);
  if v_valor <= 0 then
    raise exception 'El valor a pagar debe ser mayor que cero.';
  end if;
  if v_valor > g.valor then
    raise exception 'El valor a pagar (%) no puede ser mayor que el del pago (%).',
      '$ ' || replace(to_char(v_valor, 'FM999G999G999G999'), ',', '.'), '$ ' || replace(to_char(g.valor, 'FM999G999G999G999'), ',', '.');
  end if;

  -- Avance: lo que falta queda como saldo en espera del mismo acta.
  if v_valor < g.valor then
    insert into pagos (fuente, acta_id, tipo, proyecto_id, empresa_id, consolidado_id, tercero_id,
                       cuenta_tercero_id, titular_tercero_id, concepto, valor, estado, solicitado_en,
                       solicitado_por, saldo_acta)
    values ('acta', g.acta_id, g.tipo, g.proyecto_id, g.empresa_id, g.consolidado_id, g.tercero_id,
            g.cuenta_tercero_id, g.titular_tercero_id,
            case when g.concepto like '% - SALDO' then g.concepto else g.concepto || ' - SALDO' end,
            g.valor - v_valor, 'en_espera', now(), g.solicitado_por, true)
    returning id into v_saldo;
    update pagos set valor = v_valor where id = p_pago_id;
    perform public._pago_actualizar_novedad(v_saldo);
  end if;

  -- Sin factura, el disparador lo deja en_espera (aprobado); con factura, aprobado.
  update pagos set estado = 'aprobado', aprobado_por = auth.uid(), aprobado_en = now(),
                   liberado_en = case when g.estado = 'en_espera' then now() else liberado_en end
   where id = p_pago_id;
  perform public._pago_asignar_item(p_pago_id);
  return v_saldo;
end;
$$;
revoke execute on function public.aprobar_pago_acta(uuid, numeric) from public;
grant execute on function public.aprobar_pago_acta(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------- subir la factura después
-- Acta aprobada sin factura: quien elabora actas sube la factura o cuenta de
-- cobro y los pagos aprobados que la esperaban pasan a aprobado (consolidado).
create or replace function public.subir_factura_acta(p_acta_id uuid, p_soporte jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_id uuid;
  v_n integer := 0;
begin
  if not public.tiene_accion(auth.uid(), 'elaborar_actas') then
    raise exception 'No tienes permiso para subir la factura del acta.';
  end if;
  select a.id, a.estado, c.proyecto_id into v
    from actas a join contratos c on c.id = a.contrato_id where a.id = p_acta_id for update of a;
  if not found or not public.puede_ver_actas(v.proyecto_id) then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;
  if v.estado <> 'aprobada' then
    raise exception 'La factura se sube aquí cuando el acta está aprobada. Si no, adjúntala al corregir el acta.';
  end if;
  if coalesce(p_soporte->>'tipo', '') not in ('factura', 'cuenta_cobro') then
    raise exception 'El soporte debe ser la factura o la cuenta de cobro del contratista.';
  end if;

  perform public._agregar_soportes_acta(p_acta_id, jsonb_build_array(p_soporte));

  for v_id in
    update pagos set estado = 'aprobado', liberado_en = now()
     where acta_id = p_acta_id and estado = 'en_espera' and aprobado_en is not null
    returning id
  loop
    perform public._pago_asignar_item(v_id);
    v_n := v_n + 1;
  end loop;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('acta', p_acta_id, 'factura_subida', auth.uid(),
          jsonb_build_object('nombre_archivo', p_soporte->>'nombre_archivo', 'tipo', p_soporte->>'tipo',
                             'pagos_liberados', v_n));
  return v_n;
end;
$$;
revoke execute on function public.subir_factura_acta(uuid, jsonb) from public;
grant execute on function public.subir_factura_acta(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- saldos de un contrato
-- Para avisar al crear la siguiente acta: actas del contrato con saldo en espera.
create or replace function public.saldos_actas_contrato(p_contrato_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_proyecto uuid;
begin
  select c.proyecto_id into v_proyecto from contratos c where c.id = p_contrato_id;
  if v_proyecto is null or not public.puede_ver_actas(v_proyecto) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('acta_id', a.id, 'numero', a.numero, 'saldo', s.saldo) order by a.numero)
      from actas a
      join lateral (select sum(g.valor) as saldo from pagos g
                     where g.acta_id = a.id and g.saldo_acta and g.estado = 'en_espera' and g.aprobado_en is null) s
        on s.saldo > 0
     where a.contrato_id = p_contrato_id), '[]'::jsonb);
end;
$$;
revoke execute on function public.saldos_actas_contrato(uuid) from public;
grant execute on function public.saldos_actas_contrato(uuid) to authenticated;

-- ---------------------------------------------------------------- detalle del acta: sus pagos y saldos
do $$
declare
  d text := replace(pg_get_functiondef('public.detalle_acta'::regproc), E'\r\n', E'\n');
  a text := E'    ''lineas_anteriores'', coalesce((';
  b text := E'    ''pagos'', coalesce((select jsonb_agg(jsonb_build_object(\n'
         || E'               ''id'', g.id, ''estado'', g.estado, ''valor'', g.valor, ''saldo_acta'', g.saldo_acta,\n'
         || E'               ''aprobado'', g.aprobado_en is not null, ''anio'', g.anio, ''semana'', g.semana,\n'
         || E'               ''referencia'', g.referencia) order by g.creado_en, g.id)\n'
         || E'      from pagos g where g.acta_id = v.id and g.estado not in (''anulado'', ''rechazado'')), ''[]''::jsonb),\n'
         || E'    ''saldos_anteriores'', coalesce((select jsonb_agg(jsonb_build_object(''numero'', x.numero, ''saldo'', x.saldo) order by x.numero)\n'
         || E'      from (select a2.numero, sum(g.valor) as saldo from actas a2 join pagos g on g.acta_id = a2.id\n'
         || E'             where a2.contrato_id = v.contrato_id and a2.numero < v.numero\n'
         || E'               and g.saldo_acta and g.estado = ''en_espera'' and g.aprobado_en is null\n'
         || E'             group by a2.numero) x), ''[]''::jsonb),\n';
begin
  if position('''saldos_anteriores''' in d) > 0 then return; end if;
  if position(a in d) = 0 then
    raise exception 'detalle_acta no tiene el texto esperado.';
  end if;
  execute replace(d, a, b || a);
end $$;

-- ---------------------------------------------------------------- Mis pendientes
-- Quien hizo el acta: actas aprobadas que esperan la factura.
-- Quien aprueba pagos: saldos de actas en espera.
do $$
declare
  d text := replace(pg_get_functiondef('public._pendientes_de'::regproc), E'\r\n', E'\n');
  a1 text := E'  -- ------------------------------------------------ Lo mío: requisición administrativa rechazada\n';
  b1 text := E'  -- ------------------------------------------------ Lo mío: acta aprobada que espera la factura (20261231999000)\n'
          || E'  union all\n'
          || E'  select ''mi_acta_por_facturar'', ''hacer'', a.id, c.proyecto_id,\n'
          || E'         ''Acta '' || a.numero || '' · '' || coalesce(c.numero_contrato, c.codigo),\n'
          || E'         k.nombre, x.valor, coalesce(a.resuelto_at, a.created_at), a.resuelto_por, null::date,\n'
          || E'         ''/contratos/actas?ver='' || a.id\n'
          || E'    from actas a\n'
          || E'    join contratos c on c.id = a.contrato_id\n'
          || E'    join contratistas k on k.id = c.contratista_id\n'
          || E'    join lateral (select sum(g.valor) as valor from pagos g\n'
          || E'                   where g.acta_id = a.id and g.estado = ''en_espera'' and g.aprobado_en is not null) x on x.valor > 0\n'
          || E'   where a.creado_por = p_uid and a.estado = ''aprobada''\n\n';
  a2 text := E'  -- ------------------------------------------------ Requisiciones administrativas por aprobar (A&F: global)\n';
  b2 text := E'  -- ------------------------------------------------ Saldos de actas en espera (A&F: global, 20261231999000)\n'
          || E'  union all\n'
          || E'  select ''saldo_acta_por_pagar'', ''hacer'', g.id, g.proyecto_id,\n'
          || E'         g.concepto, coalesce(t.razon_social, ''Sin tercero''),\n'
          || E'         g.valor, coalesce(g.solicitado_en, g.creado_en), null::uuid, null::date, ''/ayf/aprobacion-pagos?estado=saldo_acta''\n'
          || E'    from pagos g\n'
          || E'    left join terceros t on t.id = g.tercero_id\n'
          || E'   where v_aprobar_pagos and g.saldo_acta and g.estado = ''en_espera'' and g.aprobado_en is null\n\n';
begin
  if position('mi_acta_por_facturar' in d) > 0 then return; end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 then
    raise exception '_pendientes_de no tiene el texto esperado.';
  end if;
  execute replace(replace(d, a1, b1 || a1), a2, b2 || a2);
end $$;

-- ---------------------------------------------------------------- historial del pago
-- En un pago de acta, en_espera no es crédito: espera la factura.
do $$
declare
  d text := replace(pg_get_functiondef('public._historial_pago'::regproc), E'\r\n', E'\n');
  a text := E'case when old.estado = ''dispersado'' and new.estado = ''aprobado'' then ''rebotado''';
  b text := E'case when new.acta_id is not null and new.estado = ''en_espera'' then ''espera_factura'''
         || E' when new.acta_id is not null and old.estado = ''en_espera'' and new.estado = ''aprobado'''
         || E' then (case when old.aprobado_en is null then ''aprobado'' else ''factura_recibida'' end)'
         || E' when old.estado = ''dispersado'' and new.estado = ''aprobado'' then ''rebotado''';
begin
  if position('espera_factura' in d) > 0 then return; end if;
  if position(a in d) = 0 then
    raise exception '_historial_pago no tiene el texto esperado.';
  end if;
  execute replace(d, a, b);
end $$;
