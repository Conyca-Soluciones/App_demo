-- Estado de compra "parcial" de la requisición (decisión del usuario,
-- 2026-11-10). Antes una requisición con algo comprado pero no todo decía
-- "pendiente", igual que una sin nada comprado. Ahora:
--   completa          = todas sus líneas activas comprado >= pedido
--   parcial           = alguna línea activa ya tiene compra, pero falta algo
--   pendiente         = falta todo (ninguna línea activa tiene compra)
--   rechazada_compras = Compras rechazó todas sus líneas
-- Una línea con el saldo cerrado o rechazada por Compras no está "activa"
-- (como antes). Lo comprado cuenta solo en órdenes no canceladas ni
-- rechazadas (_comprado_pedido).
--
-- "Por comprar" sigue siendo pendiente O parcial: Mis pendientes (parche de
-- texto sobre _pendientes_de, falla si no lo encuentra) y el filtro "Solo
-- pendientes por comprar" de Compras (en TS). Al final recalcula el estado
-- guardado de todas las requisiciones. Se puede correr más de una vez.

create or replace function public._estado_requisiciones(p_ids uuid[])
returns table(id uuid, n_lineas integer, estado text, estado_compra text)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    l.n_lineas,
    case
      when l.n_lineas = 0 or l.n_cancelado = l.n_lineas then 'cancelada'
      when l.n_pendiente > 0 then 'pendiente'
      when l.n_aprobado > 0 then 'aprobada'
      else 'rechazada'
    end,
    case
      when l.n_pendiente > 0 or l.n_aprobado = 0 then null
      when l.n_activas = 0 then 'rechazada_compras'
      when l.n_por_comprar = 0 then 'completa'
      when l.n_con_compra > 0 then 'parcial'
      else 'pendiente'
    end
  from public.requisiciones r
  cross join lateral (
    select
      count(*)::integer as n_lineas,
      count(*) filter (where p.estado = 'cancelado')::integer as n_cancelado,
      count(*) filter (where p.estado = 'pendiente')::integer as n_pendiente,
      count(*) filter (where p.estado = 'aprobado')::integer as n_aprobado,
      count(*) filter (where p.activa)::integer as n_activas,
      count(*) filter (where p.activa and p.comprado < p.cantidad)::integer as n_por_comprar,
      count(*) filter (where p.activa and p.comprado > 0)::integer as n_con_compra
    from (
      select pi.estado, pi.cantidad,
             (pi.estado = 'aprobado' and pi.rechazado_compras_at is null) as activa,
             -- lo comprado se calcula una sola vez por línea
             case when pi.estado = 'aprobado' and pi.rechazado_compras_at is null
                  then public._comprado_pedido(pi.id) else 0 end as comprado
      from public.pedidos_insumos pi
      where pi.grupo_pedido_id = r.id
    ) p
  ) l
  where r.id = any(p_ids)
$$;

do $$
declare
  d text := pg_get_functiondef('public._pendientes_de'::regproc);
  a text := 'r.estado_compra = ''pendiente''';
  b text := 'r.estado_compra in (''pendiente'', ''parcial'')';
begin
  d := replace(d, E'\r\n', E'\n');
  if position(a in d) = 0 then
    if position(b in d) > 0 then return; end if;
    raise exception '_pendientes_de no tiene el texto esperado.';
  end if;
  execute replace(d, a, b);
end $$;

select public._recalcular_estado_requisiciones(array(select id from public.requisiciones));
