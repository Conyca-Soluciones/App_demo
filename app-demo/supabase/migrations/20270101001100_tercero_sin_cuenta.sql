-- Crear un tercero sin cuenta bancaria (decisión del usuario, 2026-11-12): en el
-- formulario, la casilla "No tiene cuenta bancaria" quita la cuenta y la
-- certificación (p_datos.sin_cuenta = true, p_cuenta = null). El RUT sigue
-- obligatorio. Sin la casilla, todo igual que en 20270101000300.
--
-- Parche por texto exacto sobre crear_tercero (falla si no encuentra el texto,
-- no hace nada si ya está). Reversa: supabase/reversa/20270101001100_tercero_sin_cuenta.sql.

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

select pg_temp._parche('public.crear_tercero(jsonb,jsonb)'::regprocedure,
  $a$  if p_cuenta is null then
    raise exception 'Agrega la cuenta bancaria del tercero.';
  end if;
  if jsonb_typeof(p_cuenta -> 'certificacion') is distinct from 'object' then
    raise exception 'Adjunta la certificación bancaria.';
  end if;$a$,
  $b$  if coalesce((p_datos ->> 'sin_cuenta')::boolean, false) then
    if p_cuenta is not null then
      raise exception 'Marcaste que no tiene cuenta bancaria: quita los datos de la cuenta.';
    end if;
  else
    if p_cuenta is null then
      raise exception 'Agrega la cuenta bancaria del tercero o marca que no tiene.';
    end if;
    if jsonb_typeof(p_cuenta -> 'certificacion') is distinct from 'object' then
      raise exception 'Adjunta la certificación bancaria.';
    end if;
  end if;$b$);

commit;
