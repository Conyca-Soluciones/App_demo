-- REF de los pagos (decisión del usuario, 2026-11-05). Reemplaza al ITEM.
-- * Al APROBAR, el pago recibe solo su semana (la del viernes en que se paga):
--   `_pago_asignar_item` ya no da número. En Preparación se puede pasar a la
--   semana siguiente o devolver a la anterior (no antes de la actual):
--   `mover_pagos_semana`.
-- * Al ENVIAR A LIQUIDAR recibe su REF por proyecto: '001-00001' (número del
--   proyecto + consecutivo de 5 dígitos, `contadores_proyecto`), que ya no
--   cambia nunca. Se muestra "REF 001-00001"; en el archivo del banco va
--   "REF 001 00001".
-- * `devolver_pagos_a_preparacion`: un pago enviado a liquidar u observado (no
--   liquidado) vuelve a Preparación CONSERVANDO su REF; al reenviarlo sale con
--   la misma.
-- * La columna `item` queda sin uso (los pagos con consolidado se reconocen por
--   tener semana). Los mensajes dicen REF.
-- Parches por texto exacto sobre las funciones VIVAS. Se puede correr dos
-- veces. Va después de 20261230000000.

alter table public.pagos add column if not exists referencia text;
create unique index if not exists pagos_referencia_unica on public.pagos (referencia) where referencia is not null;

-- ------------------------------------------- semana sin ITEM (índices y regla)
drop index if exists public.pagos_item_unico;
alter table public.pagos drop constraint if exists pagos_item_completo;
alter table public.pagos drop constraint if exists pagos_semana_completa;
alter table public.pagos add constraint pagos_semana_completa check ((anio is null) = (semana is null));

drop index if exists public.idx_pagos_semana_item;
drop index if exists public.idx_pagos_aprobados_sin_item;
drop index if exists public.idx_pagos_consolidado_creado;
drop index if exists public.idx_pagos_consolidado_semana_liquidacion;
create index if not exists idx_pagos_semana_ref on public.pagos (anio desc nulls last, semana desc nulls last, consolidado_id, referencia, id) where semana is not null;
create index if not exists idx_pagos_aprobados_sin_semana on public.pagos (aprobado_en) where estado = 'aprobado' and semana is null;
create index if not exists idx_pagos_consolidado_creado2 on public.pagos (consolidado_id, creado_en) where semana is not null;
create index if not exists idx_pagos_consolidado_semana_liq on public.pagos (consolidado_id, anio, semana, liquidacion_estado) where semana is not null;

-- Al aprobar (o al pasar un crédito): solo la semana. Mismo nombre de antes
-- para no tocar a quien la llama.
create or replace function public._pago_asignar_item(p_pago_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p     record;
  v_anio  smallint;
  v_sem   smallint;
begin
  select id, estado, consolidado_id, anio, coalesce(liberado_en, aprobado_en) as aprobado_en, fuente, empresa_id into v_p
    from public.pagos where id = p_pago_id for update;
  if not found or v_p.anio is not null or v_p.estado <> 'aprobado' then
    return;
  end if;

  if v_p.consolidado_id is null then
    if v_p.fuente = 'requisicion_admin' then
      update public.pagos set consolidado_id = (select consolidado_id from public.empresas where id = v_p.empresa_id)
       where id = p_pago_id;
    else
      perform public._pago_sincronizar_empresa(p_pago_id);
    end if;
    select consolidado_id into v_p.consolidado_id from public.pagos where id = p_pago_id;
  end if;

  if v_p.consolidado_id is not null then
    select s.anio, s.semana into v_anio, v_sem from public._semana_pago(coalesce(v_p.aprobado_en, now())) s;
    update public.pagos set anio = v_anio, semana = v_sem where id = p_pago_id;
  end if;

  perform public._pago_actualizar_novedad(p_pago_id);
end;
$$;

-- ------------------------------------------------------------ dar la REF
create or replace function public._pago_asignar_referencia(p_pago_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  n integer;
begin
  select id, proyecto_id, referencia into v from public.pagos where id = p_pago_id for update;
  if not found or v.referencia is not null then
    return;  -- ya tiene (p. ej. devuelto a preparación y reenviado)
  end if;
  if v.proyecto_id is null then
    raise exception 'El pago no tiene proyecto: no se le puede dar REF.';
  end if;
  n := public._siguiente_consecutivo(v.proyecto_id, 'pago');
  update public.pagos set referencia = public._numero_proyecto(v.proyecto_id) || '-' || public._con_ceros(n, 5)
   where id = p_pago_id;
end;
$$;
revoke all on function public._pago_asignar_referencia(uuid) from public, anon, authenticated;

-- Enviar a liquidar: la REF se da aquí, en orden de semana y aprobación.
create or replace function public.enviar_pagos_a_liquidar(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para gestionar pagos.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 2000 then
    raise exception 'Como mucho 2000 pagos a la vez.';
  end if;
  for v_id in
    with enviados as (
      update public.pagos g
         set liquidacion_estado = 'por_liquidar', enviado_liquidar_en = now(), enviado_liquidar_por = auth.uid()
       where g.id = any (coalesce(p_ids, '{}'))
         and g.estado = 'aprobado' and g.liquidacion_estado is null and g.semana is not null
         and (public.tiene_pestana(auth.uid(), 'ayf.aprobacion_pagos')
              or g.consolidado_id in (select public._consolidados_visibles(auth.uid())))
      returning g.id, g.anio, g.semana, g.aprobado_en
    )
    select e.id from enviados e order by e.anio, e.semana, e.aprobado_en, e.id
  loop
    perform public._pago_asignar_referencia(v_id);
    perform public._anotar_historial('pago', v_id, 'enviado_liquidar',
      jsonb_build_object('referencia', (select referencia from public.pagos where id = v_id)), null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.enviar_pagos_a_liquidar(uuid[]) from public, anon;
grant execute on function public.enviar_pagos_a_liquidar(uuid[]) to authenticated;

-- ------------------------------------------- devolver a preparación (desenviar)
create or replace function public.devolver_pagos_a_preparacion(p_ids uuid[], p_motivo text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para gestionar pagos.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 2000 then
    raise exception 'Como mucho 2000 pagos a la vez.';
  end if;
  for v_id in
    update public.pagos g
       set liquidacion_estado = null, enviado_liquidar_en = null, enviado_liquidar_por = null
     where g.id = any (coalesce(p_ids, '{}'))
       and g.estado = 'aprobado' and g.liquidacion_estado in ('por_liquidar', 'observado')
       and (public.tiene_pestana(auth.uid(), 'ayf.aprobacion_pagos')
            or g.consolidado_id in (select public._consolidados_visibles(auth.uid())))
    returning g.id
  loop
    perform public._anotar_historial('pago', v_id, 'devuelto_preparacion', null, nullif(trim(coalesce(p_motivo, '')), ''));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.devolver_pagos_a_preparacion(uuid[], text) from public, anon;
grant execute on function public.devolver_pagos_a_preparacion(uuid[], text) to authenticated;

-- ---------------------------------------------- mover de semana (Preparación)
-- p_semanas = 1 (la siguiente) o -1 (la anterior, nunca antes de la actual).
create or replace function public.mover_pagos_semana(p_ids uuid[], p_semanas integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_n integer := 0;
  v_lunes date;
  v_anio smallint;
  v_sem smallint;
  v_actual_anio smallint;
  v_actual_sem smallint;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para gestionar pagos.';
  end if;
  if p_semanas not in (1, -1) then
    raise exception 'Solo se mueve una semana a la vez.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 2000 then
    raise exception 'Como mucho 2000 pagos a la vez.';
  end if;
  select s.anio, s.semana into v_actual_anio, v_actual_sem from public._semana_pago(now()) s;

  for v in
    select g.id, g.anio, g.semana from public.pagos g
     where g.id = any (coalesce(p_ids, '{}'))
       and g.estado = 'aprobado' and g.liquidacion_estado is null and g.semana is not null
       and (public.tiene_pestana(auth.uid(), 'ayf.aprobacion_pagos')
            or g.consolidado_id in (select public._consolidados_visibles(auth.uid())))
     for update of g
  loop
    v_lunes := to_date(v.anio || '-' || lpad(v.semana::text, 2, '0'), 'IYYY-IW') + 7 * p_semanas;
    v_anio := extract(isoyear from v_lunes)::smallint;
    v_sem := extract(week from v_lunes)::smallint;
    if (v_anio, v_sem) < (v_actual_anio, v_actual_sem) then
      raise exception 'Un pago no se puede pasar a una semana que ya pasó (semana % de %).', v_sem, v_anio;
    end if;
    update public.pagos set anio = v_anio, semana = v_sem where id = v.id;
    perform public._anotar_historial('pago', v.id, 'semana_cambiada',
      jsonb_build_object('de', v.semana, 'de_anio', v.anio, 'a', v_sem, 'a_anio', v_anio), null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.mover_pagos_semana(uuid[], integer) from public, anon;
grant execute on function public.mover_pagos_semana(uuid[], integer) to authenticated;

-- ------------------------------------------------------- parches por texto
do $$
declare
  d text;
  i int;
  p text[][] := array[
    ['public._empresa_consolidado_asignado()', 'estado = ''aprobado'' and item is null', 'estado = ''aprobado'' and semana is null'],
    ['public.reintentar_pagos()', 'where estado = ''aprobado'' and item is null', 'where estado = ''aprobado'' and semana is null'],
    ['public.reintentar_pagos()', 'id = v_id and item is not null', 'id = v_id and semana is not null'],
    ['public._pago_sincronizar_empresa(uuid)', 'and p.item is null', 'and p.semana is null'],
    ['public._proyecto_empresa_cambio()', 'where proyecto_id = new.id and item is null', 'where proyecto_id = new.id and semana is null'],
    ['public.conteo_etapas_consolidado(uuid, integer[], integer[], timestamp with time zone[], timestamp with time zone[])', 'g.item is not null', 'g.semana is not null'],
    ['public._pago_dispersado_fijo()', '''El pago ITEM %', '''El pago REF %'],
    ['public._pago_dispersado_fijo()', '.'', old.item;', '.'', coalesce(old.referencia, ''—'');'],
    ['public._pago_para_liquidar(uuid)', '''El pago ITEM %', '''El pago REF %'],
    ['public._pago_para_liquidar(uuid)', 'coalesce(v.item::text, ''—'')', 'coalesce(v.referencia, ''—'')'],
    ['public.comentar_pago(uuid, text, text)', '''El pago ITEM %', '''El pago REF %'],
    ['public.comentar_pago(uuid, text, text)', 'coalesce(v.item::text, ''—'')', 'coalesce(v.referencia, ''—'')'],
    ['public.registrar_dispersiones(jsonb)', '''El pago ITEM %', '''El pago REF %'],
    ['public.registrar_dispersiones(jsonb)', '''El valor a pagar del ITEM %', '''El valor a pagar del pago REF %'],
    ['public.registrar_dispersiones(jsonb)', '''No se encontró el soporte individual del ITEM %.''', '''No se encontró el soporte individual del pago REF %.'''],
    ['public.registrar_dispersiones(jsonb)', 'v_pago.item', 'v_pago.referencia'],
    ['public._pendientes_de(uuid)', '''ITEM '' || g.item || '' · ''', '''REF '' || coalesce(g.referencia, ''—'') || '' · '''],
    ['public.detalle_acta(uuid)', '''item'', g.item,', '''item'', g.referencia,'],
    ['public.detalle_requisicion_admin(uuid)', 'select x.item, x.semana', 'select x.referencia as item, x.semana']
  ];
begin
  for i in 1 .. array_length(p, 1) loop
    d := pg_get_functiondef(p[i][1]::regprocedure);
    if position(p[i][2] in d) = 0 then
      if position(p[i][3] in d) > 0 then
        continue;  -- ya aplicado
      end if;
      raise exception '% no tiene el texto esperado: %', p[i][1], p[i][2];
    end if;
    execute replace(d, p[i][2], p[i][3]);
  end loop;
end $$;
