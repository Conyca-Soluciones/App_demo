-- Reversa de 20270101006500_terceros_nombres_primero.sql: apellidos primero otra vez.
begin;

create or replace function pg_temp._parche_rev(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $f$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  p_a := replace(p_a, E'\r\n', E'\n');
  p_b := replace(p_b, E'\r\n', E'\n');
  if position(p_a in d) = 0 then
    raise exception '% no tiene el texto esperado: %', p_fn, left(p_a, 120);
  end if;
  execute replace(d, p_a, p_b);
end;
$f$;

select pg_temp._parche_rev('public._tercero_nombre()'::regprocedure,
$a$    new.razon_social := v_nombres || ' ' || v_apellidos;  -- nombres primero (20270101006500)$a$,
$b$    new.razon_social := v_apellidos || ' ' || v_nombres;$b$);

update public.terceros
   set primer_nombre = primer_nombre
 where tipo_documento <> 'NIT' and primer_nombre is not null and primer_apellido is not null;

commit;
