-- Reversa de 20270101000300_paquete_e_ayf.sql.
-- Deshace los parches y quita las funciones y políticas nuevas. Las columnas
-- (pagos.pagado_manual_por / pago_comprobante_*, terceros.rut_*) se dejan:
-- borrarlas perdería los RUT y comprobantes ya subidos.

begin;

create or replace function pg_temp._deshacer(p_fn regprocedure, p_nuevo text, p_viejo text)
returns void
language plpgsql
as $$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  p_nuevo := replace(p_nuevo, E'\r\n', E'\n');
  p_viejo := replace(p_viejo, E'\r\n', E'\n');
  if position(p_nuevo in d) = 0 then
    return;
  end if;
  execute replace(d, p_nuevo, p_viejo);
end;
$$;

select pg_temp._deshacer('public.enviar_pagos_a_liquidar(uuid[])'::regprocedure,
  $b$
         and (g.cuenta_tercero_id is not null or public.pago_es_pse(g))$b$, '');

select pg_temp._deshacer('public.redispersar_pagos(uuid[],text)'::regprocedure,
  $b$,
         pagado_manual_por = null, pago_comprobante_ruta = null, pago_comprobante_nombre = null, pago_comprobante_mime = null$b$, '');

select pg_temp._deshacer('public.crear_tercero(jsonb,jsonb)'::regprocedure,
  $b$
  perform public._rut_tercero_nuevo(v_id, p_datos -> 'rut');$b$, '');
select pg_temp._deshacer('public.crear_tercero(jsonb,jsonb)'::regprocedure,
  $b$  if p_cuenta is null then
    raise exception 'Agrega la cuenta bancaria del tercero.';
  end if;
  if jsonb_typeof(p_cuenta -> 'certificacion') is distinct from 'object' then
    raise exception 'Adjunta la certificación bancaria.';
  end if;
  if jsonb_typeof(p_datos -> 'rut') is distinct from 'object' then
    raise exception 'Adjunta el RUT.';
  end if;

$b$, '');

drop policy if exists dispersores_comprobante_pse_select on storage.objects;
drop policy if exists terceros_rut_insert on storage.objects;
drop policy if exists terceros_rut_delete on storage.objects;
drop policy if exists terceros_rut_select on storage.objects;

drop function if exists public.enviar_pagos_a_liquidar_detalle(uuid[]);
drop function if exists public.marcar_pagos_pagados(uuid[], uuid, jsonb);
drop function if exists public.guardar_rut_tercero(uuid, text, text, text);
drop function if exists public._rut_tercero_nuevo(uuid, jsonb);
drop function if exists public._puede_ver_rut(uuid);
drop function if exists public.pago_es_pse(public.pagos);

commit;
