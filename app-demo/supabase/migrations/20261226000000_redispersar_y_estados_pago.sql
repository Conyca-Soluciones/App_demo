-- Pagos dispersados y estados del pago (decisiones del usuario, 2026-10-26):
--  1. Un pago DISPERSADO es siempre un pago liquidado (o "liquidado sin
--     retenciones", que también queda liquidado): la base lo exige.
--  2. Un pago dispersado no se anula ni cambia de estado. Si REBOTA en el
--     banco, se marca en Realizar Pagos ("Rebotó en el banco") con el motivo y
--     vuelve a dispersión: queda aprobado y liquidado, sin cuenta a debitar
--     (Por asignar), con el mismo ITEM. El intento que rebotó queda en
--     `dispersion_pagos` (fecha, quién y motivo) y en el historial del pago.
--  3. Se quitan los estados del pago que no usaba nada: 'en_dispersion' y
--     'liquidado' (la liquidación va en `liquidacion_estado`). Ninguna fila
--     los tiene; las funciones que los nombraban se limpian aquí.
-- Va después de 20261225000000. Las funciones se parchan sobre su versión VIVA
-- (reemplazo de texto exacto); se puede correr dos veces.

-- 1. Estados ------------------------------------------------------------------

alter table public.pagos drop constraint if exists pagos_estado_check;
alter table public.pagos add constraint pagos_estado_check
  check (estado in ('programado', 'solicitado', 'aprobado', 'dispersado', 'rechazado', 'anulado'));

alter table public.pagos drop constraint if exists pagos_dispersado_liquidado;
alter table public.pagos add constraint pagos_dispersado_liquidado
  check (estado <> 'dispersado' or liquidacion_estado = 'liquidado');

do $$
declare
  f regprocedure;
  d text;
  n text;
  r text[][] := array[
    array['(''aprobado'', ''liquidado'', ''en_dispersion'', ''dispersado'')', '(''aprobado'', ''dispersado'')'],
    array['(''programado'', ''solicitado'', ''aprobado'', ''liquidado'')', '(''programado'', ''solicitado'', ''aprobado'')'],
    array['(''en_dispersion'', ''dispersado'')', '(''dispersado'')'],
    array['(''en_dispersion'',''dispersado'',''rechazado'',''anulado'')', '(''dispersado'',''rechazado'',''anulado'')']
  ];
  i int;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('_cancelar_orden_compra_sin_proyecto', '_cuenta_tercero_sigue_pagos', '_enlazar_pagos_tercero',
                         '_oc_estado_pagos', 'asignar_tercero_pago')
  loop
    d := pg_get_functiondef(f);
    n := d;
    for i in 1 .. array_length(r, 1) loop
      n := replace(n, r[i][1], r[i][2]);
    end loop;
    if n <> d then
      execute n;
    end if;
  end loop;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%en_dispersion%') then
    raise exception 'Quedó una función que nombra en_dispersion: revisar a mano.';
  end if;
end $$;

-- 2. Cada intento de dispersión de un pago --------------------------------------

alter table public.dispersion_pagos
  add column if not exists rebotado_en timestamptz,
  add column if not exists rebotado_por uuid references public.perfiles(id),
  add column if not exists motivo_rebote text;

-- Un pago puede tener varios intentos; vigente (sin rebote) solo uno.
alter table public.dispersion_pagos drop constraint if exists dispersion_pagos_pago_id_key;
create unique index if not exists dispersion_pagos_pago_vigente on public.dispersion_pagos(pago_id) where rebotado_en is null;
create index if not exists idx_dispersion_pagos_pago on public.dispersion_pagos(pago_id);
create index if not exists idx_dispersion_pagos_rebotado_por on public.dispersion_pagos(rebotado_por) where rebotado_por is not null;

-- 3. Un pago dispersado no cambia de estado (salvo "Rebotó en el banco") --------

create or replace function public._pago_dispersado_fijo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.estado = 'dispersado' and new.estado is distinct from 'dispersado'
     and coalesce(current_setting('app.redispersando', true), '') <> 'on' then
    raise exception 'El pago ITEM % ya se dispersó: no se puede anular ni cambiar de estado. Si rebotó en el banco, márcalo en Realizar Pagos para volver a dispersarlo.', old.item;
  end if;
  return new;
end;
$$;
revoke all on function public._pago_dispersado_fijo() from public, anon, authenticated;
drop trigger if exists trg_pago_dispersado_fijo on public.pagos;
create trigger trg_pago_dispersado_fijo before update of estado on public.pagos
  for each row execute function public._pago_dispersado_fijo();

-- 4. Historial: el rebote es su propio evento, con el motivo --------------------

do $$
declare
  d text := pg_get_functiondef('public._historial_pago()'::regprocedure);
  a text := 'values (''pago'', new.id, new.estado, v_uid,';
  b text := 'when ''anulado'' then new.motivo_anulacion';
begin
  if position('rebotado' in d) > 0 then return; end if;
  if position(a in d) = 0 or position(b in d) = 0 then
    raise exception '_historial_pago no tiene el texto esperado.';
  end if;
  d := replace(d, a, 'values (''pago'', new.id, case when old.estado = ''dispersado'' and new.estado = ''aprobado'' then ''rebotado'' else new.estado end, v_uid,');
  d := replace(d, b, b || E'\n              when ''aprobado'' then nullif(current_setting(''app.motivo_rebote'', true), '''')');
  execute d;
end $$;

-- 5. "Rebotó en el banco": vuelve a dispersión ---------------------------------

create or replace function public.redispersar_pagos(p_ids uuid[], p_motivo text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_ids uuid[];
  v_n integer;
begin
  if not public.tiene_accion(auth.uid(), 'generar_dispersores') then
    raise exception 'No autorizado -- no tienes permiso para generar dispersores.';
  end if;
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'Escribe por qué rebotó el pago.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 3000 then
    raise exception 'Como mucho 3000 pagos a la vez.';
  end if;

  select array_agg(g.id) into v_ids
    from (select g.id from public.pagos g
           where g.id = any (coalesce(p_ids, '{}'))
             and g.estado = 'dispersado'
             and g.consolidado_id in (select public._consolidados_visibles(auth.uid()))
           for update of g) g;
  if v_ids is null then
    return 0;
  end if;

  update public.dispersion_pagos dp
     set rebotado_en = now(), rebotado_por = auth.uid(), motivo_rebote = v_motivo
    from public.pagos g
   where g.id = any (v_ids) and dp.pago_id = g.id and dp.dispersion_id = g.dispersion_id
     and dp.rebotado_en is null;

  perform set_config('app.redispersando', 'on', true);
  perform set_config('app.motivo_rebote', v_motivo, true);
  update public.pagos
     set estado = 'aprobado', dispersion_id = null, dispersado_en = null, cuenta_debitar_id = null
   where id = any (v_ids);
  get diagnostics v_n = row_count;
  perform set_config('app.redispersando', '', true);
  perform set_config('app.motivo_rebote', '', true);
  return v_n;
end;
$$;
revoke all on function public.redispersar_pagos(uuid[], text) from public, anon;
grant execute on function public.redispersar_pagos(uuid[], text) to authenticated;
