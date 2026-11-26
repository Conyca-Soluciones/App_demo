-- Caja menor: el código CM-001-0001 usa el consecutivo del proyecto con tipo
-- 'caja_menor', que el CHECK de contadores_proyecto no aceptaba (al enviar la
-- primera legalización: "violates check constraint contadores_proyecto_tipo_check").
-- Lee la lista viva y le agrega 'caja_menor' (no se pierde ningún tipo).
-- Reversa: supabase/reversa/20270101007500_caja_menor_contador.sql
begin;
do $$
declare
  v_def text;
  v_lista text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = 'contadores_proyecto_tipo_check';
  select array_agg(distinct m[1]) into v_lista
    from regexp_matches(substring(v_def from 'ANY \((.*)\)'), '([a-z][a-z0-9_]*)', 'g') as m where m[1] <> 'text';
  if coalesce(array_length(v_lista, 1), 0) < 2 then raise exception 'No se pudo leer el CHECK: %', v_def; end if;
  v_lista := array(select distinct unnest(v_lista || array['caja_menor']) order by 1);
  alter table public.contadores_proyecto drop constraint contadores_proyecto_tipo_check;
  execute format('alter table public.contadores_proyecto add constraint contadores_proyecto_tipo_check check (tipo = any (%L::text[]))', v_lista);
end;
$$;
commit;
