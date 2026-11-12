-- Reversa de 20270101001100_tercero_sin_cuenta.sql: la cuenta y la certificación
-- vuelven a ser obligatorias al crear un tercero.

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

select pg_temp._deshacer('public.crear_tercero(jsonb,jsonb)'::regprocedure,
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
  end if;$b$,
  $a$  if p_cuenta is null then
    raise exception 'Agrega la cuenta bancaria del tercero.';
  end if;
  if jsonb_typeof(p_cuenta -> 'certificacion') is distinct from 'object' then
    raise exception 'Adjunta la certificación bancaria.';
  end if;$a$);

commit;
