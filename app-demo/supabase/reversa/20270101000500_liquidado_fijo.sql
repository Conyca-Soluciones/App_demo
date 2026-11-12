-- Reversa de 20270101000500_liquidado_fijo.sql: quita los tres bloqueos y
-- devolver_pagos_a_por_liquidar.

begin;

create or replace function pg_temp._deshacer(p_fn regprocedure, p_nuevo text, p_viejo text)
returns void
language plpgsql
as $$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  if position(p_nuevo in d) = 0 then
    return;
  end if;
  execute replace(d, p_nuevo, p_viejo);
end;
$$;

select pg_temp._deshacer('public.liquidar_pagos_lote(jsonb)'::regprocedure,
  $b$      if v_coment is not null and v_coment is distinct from v_ultimo and v.liquidacion_estado = 'liquidado' then
        raise exception 'Ya está liquidado: no se puede observar ni cambiar.';
      end if;
$b$, '');

select pg_temp._deshacer('public.liquidar_pagos_lote(jsonb)'::regprocedure,
  $b$        elsif v.liquidacion_estado = 'liquidado' then
          raise exception 'Ya está liquidado: sus valores no se cambian.';
$b$, '');

select pg_temp._deshacer('public.comentar_pago(uuid,text,text)'::regprocedure,
  $b$  if p_tipo = 'observacion' and v.liquidacion_estado = 'liquidado' then
    raise exception 'El pago REF % ya está liquidado: no se puede observar.', coalesce(v.referencia, '—');
  end if;
$b$, '');

drop function if exists public.devolver_pagos_a_por_liquidar(uuid[], text);

commit;
