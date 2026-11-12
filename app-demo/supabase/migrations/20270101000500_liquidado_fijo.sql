-- Un pago liquidado ya no cambia su liquidación (decisión del usuario,
-- 2026-11-12). Antes liquidar_pagos_lote lo volvía a liquidar con valores
-- nuevos ("reliquidado") y una observación de Contabilidad lo reabría.
--
-- 1. liquidar_pagos_lote: un liquidado con los mismos valores sigue "sin
--    cambios" (el Excel de ida y vuelta trae los liquidados); con valores
--    distintos o con comentario nuevo, error en esa fila.
-- 2. comentar_pago: no se puede observar un liquidado (comentar sí).
--
-- Parches por texto exacto (fallan si no encuentran el texto, no hacen nada si
-- ya están). Reversa en supabase/reversa/20270101000500_liquidado_fijo.sql.

begin;

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $$
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
$$;

select pg_temp._parche('public.liquidar_pagos_lote(jsonb)'::regprocedure,
  $a$      if v_coment is not null and v_coment is distinct from v_ultimo then
$a$,
  $b$      if v_coment is not null and v_coment is distinct from v_ultimo and v.liquidacion_estado = 'liquidado' then
        raise exception 'Ya está liquidado: no se puede observar ni cambiar.';
      end if;
      if v_coment is not null and v_coment is distinct from v_ultimo then
$b$);

select pg_temp._parche('public.liquidar_pagos_lote(jsonb)'::regprocedure,
  $a$          v_res := 'sin_cambios';
        else
          update public.pagos
             set liq_base = coalesce((v_n ->> 'base')::numeric, v.base_gravable),$a$,
  $b$          v_res := 'sin_cambios';
        elsif v.liquidacion_estado = 'liquidado' then
          raise exception 'Ya está liquidado: sus valores no se cambian.';
        else
          update public.pagos
             set liq_base = coalesce((v_n ->> 'base')::numeric, v.base_gravable),$b$);

select pg_temp._parche('public.comentar_pago(uuid,text,text)'::regprocedure,
  $a$  insert into public.pago_comentarios (pago_id, autor_id, texto, tipo)$a$,
  $b$  if p_tipo = 'observacion' and v.liquidacion_estado = 'liquidado' then
    raise exception 'El pago REF % ya está liquidado: no se puede observar.', coalesce(v.referencia, '—');
  end if;
  insert into public.pago_comentarios (pago_id, autor_id, texto, tipo)$b$);

commit;

-- 3. "Devolver a por liquidar": la única forma de corregir un liquidado (mientras
--    no se haya dispersado ni pagado). Contabilidad o Financiera, con motivo.
--    Conserva los valores (quedan de borrador) y su REF; quita la cuenta a
--    debitar que tuviera asignada en Realizar Pagos.
begin;

create or replace function public.devolver_pagos_a_por_liquidar(p_ids uuid[], p_motivo text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_ids uuid[];
begin
  if not (public.tiene_accion(auth.uid(), 'liquidar_pagos') or public.tiene_accion(auth.uid(), 'gestionar_pagos')) then
    raise exception 'No autorizado -- no puedes devolver pagos a Por liquidar.';
  end if;
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'Escribe por qué se devuelve.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 2000 then
    raise exception 'Como mucho 2000 pagos a la vez.';
  end if;
  with devueltos as (
    update public.pagos g
       set liquidacion_estado = 'por_liquidar', liquidado_en = null, liquidado_por = null, cuenta_debitar_id = null
     where g.id = any (coalesce(p_ids, '{}'))
       and g.estado = 'aprobado' and g.liquidacion_estado = 'liquidado' and g.dispersion_id is null
       and (public.tiene_pestana(auth.uid(), 'ayf.aprobacion_pagos')
            or g.consolidado_id in (select public._consolidados_visibles(auth.uid())))
    returning g.id
  )
  select array_agg(id) into v_ids from devueltos;
  if v_ids is null then
    return 0;
  end if;
  insert into public.pago_comentarios (pago_id, autor_id, texto, tipo)
  select i, auth.uid(), left('Devuelto a Por liquidar: ' || v_motivo, 2000), 'comentario' from unnest(v_ids) i;
  perform public._anotar_historial('pago', i, 'devuelto_por_liquidar', null, left(v_motivo, 500)) from unnest(v_ids) i;
  return array_length(v_ids, 1);
end;
$$;
revoke all on function public.devolver_pagos_a_por_liquidar(uuid[], text) from public, anon;
grant execute on function public.devolver_pagos_a_por_liquidar(uuid[], text) to authenticated;

commit;
