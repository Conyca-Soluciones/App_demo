-- Requisiciones compradas a medias: cerrar el saldo y verlos todos.
--
-- Problema: una requisición de 10 cajas de la que se compraron 8 sigue
-- comprometiendo las 10 en el cupo del presupuesto mientras esté abierta; las 2
-- que no se van a comprar quedan "perdidas". Hoy la única salida es que Compras
-- la RECHACE (eso libera el cupo: solo cuenta lo ya comprado), pero el nombre
-- engaña y nadie ve cuáles están a medias.
--
-- 1. Cerrar saldo: igual que rechazar (libera lo no comprado del cupo y saca la
--    línea de la lista de Compras) pero exige que YA haya compras y quede un
--    saldo, se marca como "saldo cerrado" (no como rechazada) y avisa al
--    ingeniero que la pidió.
-- 2. Saldos pendientes: la lista de requisiciones con compra parcial, con
--    cuánto falta y hace cuántos días fue la última compra.
--
-- Se reutiliza rechazado_compras_at/por/observaciones_compras para el efecto en
-- el cupo (_comprometido_insumo_item ya cuenta solo lo comprado, sin pasar de
-- lo pedido, cuando Compras cerró la línea); saldo_cerrado_at/por solo dicen
-- QUÉ clase de cierre fue. Se puede correr más de una vez.

-- ---------------------------------------------------------------- columnas
alter table public.pedidos_insumos
  add column if not exists saldo_cerrado_at  timestamptz,
  add column if not exists saldo_cerrado_por uuid references public.perfiles(id);

create index if not exists idx_pedidos_insumos_saldo_cerrado_por
  on public.pedidos_insumos(saldo_cerrado_por);

-- ------------------------------------------------------ 1. cerrar el saldo
create or replace function public.cerrar_saldo_pedido(p_pedido_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v record;
  v_comprado numeric;
begin
  if not public.rol_compras(auth.uid()) then
    raise exception 'No tienes permiso para cerrar saldos en Compras.';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo es obligatorio.';
  end if;

  select p.id, p.estado, p.cantidad, p.rechazado_compras_at, p.solicitado_por,
         p.grupo_pedido_id, mi.descripcion
    into v
    from pedidos_insumos p
    join maestro_insumos mi on mi.id = p.insumo_id
   where p.id = p_pedido_id
     for update of p;

  if not found then
    raise exception 'El pedido no existe.';
  end if;
  if v.estado <> 'aprobado' or v.rechazado_compras_at is not null then
    raise exception 'Esta requisición ya no está disponible para Compras (ya fue cerrada o rechazada, o cambió de estado). Actualiza la página.';
  end if;

  -- Lo comprado, en la unidad de la requisición.
  v_comprado := public._comprado_pedido(p_pedido_id);
  if v_comprado <= 0 then
    raise exception 'Esta requisición todavía no tiene compras: si no se va a comprar, recházala.';
  end if;
  if v_comprado >= v.cantidad then
    raise exception 'Esta requisición ya está comprada completa: no tiene saldo por cerrar.';
  end if;

  update pedidos_insumos
     set rechazado_compras_at  = now(),
         rechazado_compras_por = auth.uid(),
         observaciones_compras = btrim(p_motivo),
         saldo_cerrado_at      = now(),
         saldo_cerrado_por     = auth.uid()
   where id = p_pedido_id;

  -- Aviso al ingeniero que la pidió. Se usa el tipo que ya existe para
  -- requisiciones cerradas por Compras; el título y el mensaje dicen que es el
  -- saldo, no toda la requisición.
  perform public.notificar_una(
    v.solicitado_por,
    'pedido_rechazado',
    'requisicion',
    v.grupo_pedido_id,
    'Saldo de requisición cerrado',
    'Compras cerró el saldo de ' || v.descripcion || ': se compraron '
      || rtrim(rtrim(to_char(v_comprado, 'FM999999990.99'), '0'), '.') || ' de '
      || rtrim(rtrim(to_char(v.cantidad, 'FM999999990.99'), '0'), '.')
      || '. Motivo: ' || btrim(p_motivo)
  );
end;
$$;

revoke all on function public.cerrar_saldo_pedido(uuid, text) from public, anon;
grant execute on function public.cerrar_saldo_pedido(uuid, text) to authenticated;

-- --------------------------------------------------- 2. saldos pendientes
-- Requisiciones aprobadas con compra parcial (algo comprado, pero menos que lo
-- pedido) y que Compras no ha cerrado. Las más antiguas primero. Se recorren
-- solo las abiertas del usuario (sus proyectos visibles) y cada una consulta sus
-- líneas de orden por índice: costo lineal en las requisiciones abiertas.
create or replace function public.listar_saldos_pendientes(
  p_proyecto_id uuid default null,
  p_limite integer default 50,
  p_offset integer default 0
)
returns table(
  pedido_id uuid,
  requisicion_id uuid,
  requisicion_numero bigint,
  proyecto_id uuid,
  proyecto_codigo text,
  proyecto_nombre text,
  insumo_codigo integer,
  insumo_descripcion text,
  unidad text,
  cantidad numeric,
  comprado numeric,
  pendiente numeric,
  ultima_compra timestamptz,
  dias_sin_compra integer,
  solicitante text,
  fecha_requerida date
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.rol_compras(auth.uid()) then
    raise exception 'No tienes permiso para ver los saldos pendientes.';
  end if;

  return query
  select p.id,
         p.grupo_pedido_id,
         r.numero,
         p.proyecto_id,
         py.codigo,
         py.nombre,
         mi.codigo,
         mi.descripcion,
         coalesce(p.unidad, mi.u_m),
         p.cantidad,
         c.comprado,
         p.cantidad - c.comprado,
         c.ultima,
         ((now() at time zone 'America/Bogota')::date - (c.ultima at time zone 'America/Bogota')::date)::integer,
         sol.nombre,
         p.fecha_requerida
    from pedidos_insumos p
    join lateral (
      select sum(oci.cantidad * oci.factor_unidad) as comprado,
             max(oc.created_at) as ultima
        from ordenes_compra_items oci
        join ordenes_compra oc on oc.id = oci.orden_compra_id
       where oci.pedido_insumo_id = p.id
         and oc.estado not in ('cancelada', 'rechazada')
    ) c on c.comprado > 0 and c.comprado < p.cantidad
    join maestro_insumos mi on mi.id = p.insumo_id
    join proyectos py on py.id = p.proyecto_id
    left join requisiciones r on r.id = p.grupo_pedido_id
    left join perfiles sol on sol.id = p.solicitado_por
   where p.estado = 'aprobado'
     and p.rechazado_compras_at is null
     and (p_proyecto_id is null or p.proyecto_id = p_proyecto_id)
     and p.proyecto_id in (select public.proyectos_visibles(auth.uid()))
   order by c.ultima asc, p.id
   limit least(greatest(p_limite, 1), 200)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.listar_saldos_pendientes(uuid, integer, integer) from public, anon;
grant execute on function public.listar_saldos_pendientes(uuid, integer, integer) to authenticated;

-- ------------------------------------------------------------- permisos
-- Pestaña "Saldos pendientes" (Compras). Los roles de Compras la reciben; el
-- resto se asigna en Roles y permisos.
insert into public.rol_permisos (rol_id, permiso)
select r.id, 'tab.compras.saldos_pendientes'
  from public.roles r
 where r.clave in ('compras', 'lider_compras')
on conflict do nothing;
