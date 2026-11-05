-- Crédito en espera (decisión del usuario, 2026-11-05). Una OC a crédito va a
-- Aprobación de pagos de una vez, como todas; al aprobarla Gerencia, la orden
-- queda aprobada (se puede recibir) pero su pago queda "en_espera": sin ITEM,
-- fuera del Consolidado. El LUNES de la semana de `fecha_pago_credito` (hora de
-- Colombia) pasa solo a `aprobado` y recibe el ITEM de esa semana
-- (`liberado_en`). Si la semana ya llegó al aprobar, pasa directo a aprobado.
-- Compras y Financiera (acción `cambiar_fecha_credito`) cambian la fecha
-- mientras el pago no haya pasado a pago (`cambiar_fecha_credito_oc`).
-- Crédito y anticipo no van juntos. Los pagos en espera cuentan como pagos
-- "vivos" en las funciones que siguen terceros, cuentas y empresas.
-- Parcha funciones VIVAS por texto exacto (falla si no encuentra el texto).
-- Se puede correr dos veces. Va después de 20261228400000.

alter table public.pagos add column if not exists liberado_en timestamptz;

alter table public.pagos drop constraint if exists pagos_estado_check;
alter table public.pagos add constraint pagos_estado_check
  check (estado in ('programado', 'solicitado', 'en_espera', 'aprobado', 'dispersado', 'rechazado', 'anulado'));

create index if not exists pagos_en_espera on public.pagos (orden_compra_id) where estado = 'en_espera';

-- ------------------------------------------------ crédito y anticipo, no juntos
create or replace function public._fijar_tipo_pago_orden(p_orden_id uuid, p_tipo text, p_fecha date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tipo is null then
    return;  -- código de antes: la orden queda sin tipo
  end if;
  if p_tipo not in ('contado', 'credito', 'fiducia') then
    raise exception 'El tipo de pago debe ser de contado, crédito o fiducia.';
  end if;
  if p_tipo = 'credito' then
    if p_fecha is null then
      raise exception 'Escribe la fecha en que se debe pagar el crédito.';
    end if;
    if p_fecha <= (now() at time zone 'America/Bogota')::date then
      raise exception 'La fecha de pago del crédito tiene que ser posterior a hoy.';
    end if;
    if exists (select 1 from public.ordenes_compra where id = p_orden_id and anticipo_porcentaje is not null) then
      raise exception 'Una orden a crédito no lleva anticipo.';
    end if;
  end if;
  update public.ordenes_compra
     set tipo_pago = p_tipo,
         fecha_pago_credito = case when p_tipo = 'credito' then p_fecha end
   where id = p_orden_id;
end;
$$;
revoke all on function public._fijar_tipo_pago_orden(uuid, text, date) from public, anon, authenticated;

-- ------------------------------------------- al aprobar: en espera si no es la semana
-- Lunes de la semana de la fecha (date_trunc('week') es lunes, como la ISO).
create or replace function public._pago_credito_en_espera()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.estado = 'solicitado' and new.estado = 'aprobado'
     and new.orden_compra_id is not null and new.tipo = 'unico'
     and exists (select 1 from public.ordenes_compra o
                  where o.id = new.orden_compra_id and o.tipo_pago = 'credito'
                    and date_trunc('week', o.fecha_pago_credito)::date > (now() at time zone 'America/Bogota')::date) then
    new.estado := 'en_espera';
  end if;
  return new;
end;
$$;
revoke all on function public._pago_credito_en_espera() from public, anon, authenticated;

drop trigger if exists trg_pago_credito_en_espera on public.pagos;
create trigger trg_pago_credito_en_espera
  before update of estado on public.pagos
  for each row when (old.estado is distinct from new.estado)
  execute function public._pago_credito_en_espera();

-- ----------------------------------------------- el lunes de su semana: a pago
create or replace function public._liberar_creditos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  for v_id in
    update public.pagos g
       set estado = 'aprobado', liberado_en = now()
      from public.ordenes_compra o
     where g.estado = 'en_espera' and o.id = g.orden_compra_id
       and (o.fecha_pago_credito is null
            or date_trunc('week', o.fecha_pago_credito)::date <= (now() at time zone 'America/Bogota')::date)
    returning g.id
  loop
    perform public._pago_asignar_item(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public._liberar_creditos() from public, anon, authenticated;

-- ------------------------------------------------------- parches por texto exacto
do $$
declare
  d text;
  f record;
  -- [función, texto, reemplazo]
  parches text[][] := array[
    -- La OC se aprueba también cuando el pago queda en espera.
    ['public._oc_sigue_pago()',
     'if new.estado = ''aprobado'' then',
     'if new.estado in (''aprobado'', ''en_espera'') then'],
    -- El ITEM de un crédito es el de la semana en que pasó a pago.
    ['public._pago_asignar_item(uuid)',
     'select id, estado, consolidado_id, item, aprobado_en, fuente, empresa_id into v_p',
     'select id, estado, consolidado_id, item, coalesce(liberado_en, aprobado_en) as aprobado_en, fuente, empresa_id into v_p'],
    -- Historial: pasar de la espera a pago no es "aprobado" otra vez.
    ['public._historial_pago()',
     'case when old.estado = ''dispersado'' and new.estado = ''aprobado'' then ''rebotado'' else new.estado end',
     'case when old.estado = ''dispersado'' and new.estado = ''aprobado'' then ''rebotado'' when old.estado = ''en_espera'' and new.estado = ''aprobado'' then ''credito_liberado'' else new.estado end'],
    -- La tarea de cada hora también libera los créditos.
    ['public._liberar_pagos_programados()',
     'get diagnostics v_n = row_count;',
     'get diagnostics v_n = row_count;' || E'\n  perform public._liberar_creditos();'],
    -- Una OC con el pago en espera ya tiene el pago aprobado.
    ['public._cancelar_orden_compra_sin_proyecto(uuid, text)',
     'and estado in (''aprobado'', ''dispersado'')',
     'and estado in (''en_espera'', ''aprobado'', ''dispersado'')']
  ];
  i int;
begin
  for i in 1 .. array_length(parches, 1) loop
    d := pg_get_functiondef(parches[i][1]::regprocedure);
    if position(parches[i][3] in d) > 0 then
      continue;  -- ya aplicado
    end if;
    if position(parches[i][2] in d) = 0 then
      raise exception '% no tiene el texto esperado: %', parches[i][1], parches[i][2];
    end if;
    execute replace(d, parches[i][2], parches[i][3]);
  end loop;

  -- Pagos "vivos" (siguen tercero, cuenta, empresa; se anulan con la OC): el
  -- pago en espera también. Todas las funciones con esa lista.
  for f in
    select p.oid::regprocedure as fn from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (p.prosrc like '%''programado'', ''solicitado'', ''aprobado'')%'
            or p.prosrc like '%''programado'',''solicitado'',''aprobado'')%')
  loop
    d := pg_get_functiondef(f.fn);
    d := replace(d, '''programado'', ''solicitado'', ''aprobado'')', '''programado'', ''solicitado'', ''en_espera'', ''aprobado'')');
    d := replace(d, '''programado'',''solicitado'',''aprobado'')', '''programado'',''solicitado'',''en_espera'',''aprobado'')');
    execute d;
  end loop;
end $$;

-- ------------------------------------------------ cambiar la fecha del crédito
create or replace function public.cambiar_fecha_credito_oc(p_orden_id uuid, p_fecha date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_oc record;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  if not public.tiene_accion(auth.uid(), 'cambiar_fecha_credito') then
    raise exception 'No autorizado -- no tienes permiso para cambiar la fecha de pago de un crédito.';
  end if;
  select id, estado, tipo_pago, fecha_pago_credito into v_oc
    from public.ordenes_compra where id = p_orden_id for update;
  if not found then
    raise exception 'La orden de compra no existe.';
  end if;
  if v_oc.tipo_pago is distinct from 'credito' then
    raise exception 'La orden no es a crédito.';
  end if;
  if v_oc.estado in ('cancelada', 'rechazada') then
    raise exception 'La orden está %: ya no se le cambia la fecha.', v_oc.estado;
  end if;
  if p_fecha is null or p_fecha < v_hoy then
    raise exception 'La fecha de pago no puede ser anterior a hoy.';
  end if;
  if exists (select 1 from public.pagos where orden_compra_id = p_orden_id
              and estado in ('aprobado', 'dispersado')) then
    raise exception 'El pago de esta orden ya pasó a pago: ya no se le cambia la fecha.';
  end if;
  if p_fecha = v_oc.fecha_pago_credito then
    return;
  end if;

  update public.ordenes_compra set fecha_pago_credito = p_fecha where id = p_orden_id;
  insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('orden_compra', p_orden_id, 'fecha_credito_cambiada', auth.uid(),
          jsonb_build_object('de', v_oc.fecha_pago_credito, 'a', p_fecha));

  -- Si la fecha nueva ya está en esta semana, el pago en espera pasa ya.
  perform public._liberar_creditos();
end;
$$;
revoke all on function public.cambiar_fecha_credito_oc(uuid, date) from public, anon;
grant execute on function public.cambiar_fecha_credito_oc(uuid, date) to authenticated;

insert into public.rol_permisos (rol_id, permiso)
select r.id, 'accion.cambiar_fecha_credito'
  from public.roles r
 where r.clave in ('compras', 'lider_compras', 'financiera')
on conflict do nothing;
