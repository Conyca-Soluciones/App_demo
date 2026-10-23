-- Pestaña "Dispersados" del Consolidado (decisión del usuario, 2026-10-23):
-- los pagos que ya salieron en un dispersor, con el soporte individual del
-- dispersor al lado del soporte del pago. Solo agrega su conteo; la lista ya
-- filtra estado = 'dispersado'. Va después de 20261217000000.

create or replace function public.conteo_etapas_consolidado(p_consolidado_id uuid, p_anios integer[], p_semanas integer[])
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'preparacion', count(*) filter (where liquidacion_estado is null and estado = 'aprobado'),
    'por_liquidar', count(*) filter (where liquidacion_estado = 'por_liquidar' and estado = 'aprobado'),
    'observado', count(*) filter (where liquidacion_estado = 'observado' and estado = 'aprobado'),
    'liquidado', count(*) filter (where liquidacion_estado = 'liquidado' and estado = 'aprobado'),
    'dispersado', count(*) filter (where estado = 'dispersado'),
    'todos', count(*))
    from public.pagos
   where consolidado_id = p_consolidado_id and item is not null
     and (coalesce(array_length(p_anios, 1), 0) = 0 or anio = any (p_anios))
     and (coalesce(array_length(p_semanas, 1), 0) = 0 or semana = any (p_semanas))
$$;
