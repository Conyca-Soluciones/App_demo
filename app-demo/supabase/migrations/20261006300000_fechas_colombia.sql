-- La base corre en UTC: `current_date` es el día en UTC, y después de las
-- 7 p. m. en Colombia ya es "mañana". Dos lugares lo usaban como "hoy":
--
-- 1. modificar_pedido: "la fecha requerida no puede ser anterior a hoy" --
--    entre las 7 p. m. y medianoche rechazaba la fecha de HOY como pasada.
-- 2. salidas_insumos.fecha (default current_date): una salida registrada en
--    la noche quedaba con la fecha del día siguiente. (Verificado: ninguna de
--    las salidas existentes estaba afectada todavía.)
--
-- Ahora ambos usan el día en America/Bogota.

alter table public.salidas_insumos
  alter column fecha set default ((now() at time zone 'America/Bogota')::date);

do $$
declare
  v_def text := pg_get_functiondef('public.modificar_pedido(uuid,numeric,date,boolean,text)'::regprocedure);
  v_nueva text;
begin
  v_nueva := replace(v_def,
    'p_fecha_requerida < current_date',
    'p_fecha_requerida < (now() at time zone ''America/Bogota'')::date');
  if v_nueva = v_def then
    raise exception 'No se encontró la condición a cambiar en modificar_pedido';
  end if;
  execute v_nueva;
end;
$$;
