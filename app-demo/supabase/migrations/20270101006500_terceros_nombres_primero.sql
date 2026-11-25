-- Personas: el nombre del tercero va NOMBRES + APELLIDOS (2026-11-25, decisión del usuario).
-- Antes, desde 20270101004300, la razón social de una persona se armaba con los apellidos
-- primero ("TORRES PEREZ LUIS EDUARDO"). Ahora "LUIS EDUARDO TORRES PEREZ", igual que el
-- nombre para el banco. Solo cambian los terceros que tienen el nombre en casillas (hoy 2);
-- los demás conservan el nombre con que se cargaron hasta que se edite.
-- Parche por texto exacto sobre la versión viva. Reversa en supabase/reversa/.

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

select pg_temp._parche('public._tercero_nombre()'::regprocedure,
$a$    new.razon_social := v_apellidos || ' ' || v_nombres;$a$,
$b$    new.razon_social := v_nombres || ' ' || v_apellidos;  -- nombres primero (20270101006500)$b$);

-- Rehace el nombre de las personas que lo tienen en casillas (el disparador lo arma).
update public.terceros
   set primer_nombre = primer_nombre
 where tipo_documento <> 'NIT' and primer_nombre is not null and primer_apellido is not null;

commit;
