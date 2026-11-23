-- Reversa de 20270101005800: Modificar vuelve a exigir soporte nuevo y se quitan
-- añadir / cambiar soporte. Los soportes ya guardados no se tocan.

begin;
set local lock_timeout = '10s';

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $f$
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
$f$;

select pg_temp._parche(
  'public.modificar_orden_compra(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, text, date, numeric, text, date, jsonb, jsonb)'::regprocedure,
$a$  -- Se conservan los soportes; el nuevo es opcional (20270101005800). Solo se exige si
  -- la orden no tiene ninguno.
  if v_ruta is null then
    if not exists (select 1 from orden_compra_soportes s where s.orden_compra_id = p_orden_id) then
      raise exception 'Adjunta el soporte de la modificación (cotización, cuenta de cobro o factura).';
    end if;
  else
    perform public._validar_soporte_orden_nuevo(v_ruta, v_tipo_soporte);
  end if;$a$,
$b$  if v_ruta is null then
    raise exception 'Adjunta el soporte de la modificación (cotización, cuenta de cobro o factura).';
  end if;
  begin
    if v_tipo_soporte is null or v_tipo_soporte not in ('cotizacion', 'cuenta_cobro', 'factura') then
      raise exception 'El soporte debe ser una cotización, una cuenta de cobro o una factura.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'ordenes_compra' and o.name = v_ruta) then
      raise exception 'No se encontró el archivo del soporte. Vuelve a adjuntarlo.';
    end if;
    if exists (select 1 from orden_compra_soportes s where s.ruta = v_ruta) then
      raise exception 'Ese archivo ya es soporte de otra orden. Vuelve a adjuntarlo.';
    end if;
  end;$b$);

select pg_temp._parche(
  'public.modificar_orden_compra(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, text, date, numeric, text, date, jsonb, jsonb)'::regprocedure,
$a$  if v_ruta is not null then
    insert into orden_compra_soportes (orden_compra_id, tipo, ruta, nombre_archivo, tamano, mime, subido_por)
    values (p_orden_id, v_tipo_soporte, v_ruta, coalesce(nullif(trim(p_soporte->>'nombre_archivo'), ''), 'soporte'),
            nullif(p_soporte->>'tamano', '')::bigint, p_soporte->>'mime', auth.uid());
  end if;$a$,
$b$  begin
    insert into orden_compra_soportes (orden_compra_id, tipo, ruta, nombre_archivo, tamano, mime, subido_por)
    values (p_orden_id, v_tipo_soporte, v_ruta, coalesce(nullif(trim(p_soporte->>'nombre_archivo'), ''), 'soporte'),
            nullif(p_soporte->>'tamano', '')::bigint, p_soporte->>'mime', auth.uid());
  end;$b$);

drop function if exists public.cambiar_soporte_orden(uuid, jsonb);
drop function if exists public.agregar_soporte_orden(uuid, jsonb);
drop function if exists public.soportes_orden_editables(uuid);
drop function if exists public._exigir_soportes_orden_editables(uuid);
drop function if exists public._validar_soporte_orden_nuevo(text, text);
drop function if exists public._motivo_soportes_orden_fijos(uuid);

commit;
