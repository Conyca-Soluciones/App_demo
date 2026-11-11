-- Paquete C, entrega 2: cerrar una orden de compra con faltante y saldo a favor
-- del proveedor (decisiones del usuario, 2026-11-11).
--
-- "Cerrar con faltante" (Compras, con motivo): el proveedor ya no va a entregar
-- el resto. Solo una OC aprobada, con alguna entrada y sin entrega completa.
--   * Cada línea queda en lo RECIBIDO (lo pedido se guarda en
--     `ordenes_compra_items.pedido_original`). Así, sin tocar otras funciones:
--     lo que faltó vuelve a Requisiciones por comprar (_comprado_pedido), la
--     orden queda Entregada, Control del proyecto cuenta lo recibido y el total
--     de la orden es lo entregado.
--   * El valor de lo no entregado se descuenta primero de los pagos de la orden
--     que todavía no se han aprobado (programados, por aprobar o crédito en
--     espera; primero el saldo). Lo que ya se pagó de más queda como SALDO A
--     FAVOR del proveedor en la empresa del proyecto.
--   * Un saldo a favor no se edita: se usa en otra OC (entrega 3) o Compras lo
--     cierra con motivo (redondeos, devolución del dinero). Lo disponible =
--     valor − lo aplicado en órdenes vigentes (una orden cancelada o rechazada
--     lo devuelve sola).
--
-- SOLO AGREGA: columnas opcionales, dos tablas, funciones nuevas, la pestaña
-- "Saldos a favor" para quien tiene la acción Comprar, y dos ajustes:
--   * el CHECK de cantidad de las líneas acepta 0 solo en una línea cerrada;
--   * `_motivo_orden_no_modificable` (parche por texto exacto): una OC cerrada
--     con faltante no se modifica.
-- No toca ningún dato existente. Se puede correr dos veces. Va después de
-- 20261231999100. Reversa: supabase/reversa/20261231999200_cierre_faltante_y_saldo_favor.sql

begin;

-- ---------------------------------------------------------------- columnas
alter table public.ordenes_compra
  add column if not exists cerrada_faltante_at timestamptz,
  add column if not exists cerrada_faltante_por uuid references public.perfiles(id) on delete set null,
  add column if not exists motivo_cierre_faltante text,
  add column if not exists valor_faltante numeric(18,2),
  add column if not exists pagos_reducidos numeric(18,2),
  add column if not exists saldo_favor_generado numeric(18,2),
  -- Entrega 3: saldo a favor usado en esta orden (lo descontado de sus pagos).
  add column if not exists saldo_favor_aplicado numeric(18,2) not null default 0;

alter table public.ordenes_compra_items
  add column if not exists pedido_original jsonb;

alter table public.ordenes_compra_items drop constraint if exists ordenes_compra_items_cantidad_check;
alter table public.ordenes_compra_items add constraint ordenes_compra_items_cantidad_check
  check (cantidad > 0 or (cantidad = 0 and pedido_original is not null));

-- ------------------------------------------------------------------ tablas
create table if not exists public.proveedor_saldos_favor (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references public.proveedores(unique_id),
  empresa_id uuid references public.empresas(id),
  orden_origen_id uuid not null references public.ordenes_compra(id),
  valor numeric(18,2) not null check (valor > 0),
  creado_por uuid references public.perfiles(id) on delete set null,
  created_at timestamptz not null default now(),
  cerrado_at timestamptz,
  cerrado_por uuid references public.perfiles(id) on delete set null,
  motivo_cierre text,
  constraint proveedor_saldos_favor_cierre check ((cerrado_at is null) = (motivo_cierre is null))
);
create index if not exists proveedor_saldos_favor_proveedor on public.proveedor_saldos_favor (proveedor_id, empresa_id) where cerrado_at is null;
create index if not exists proveedor_saldos_favor_origen on public.proveedor_saldos_favor (orden_origen_id);

create table if not exists public.saldo_favor_aplicaciones (
  id uuid primary key default gen_random_uuid(),
  saldo_id uuid not null references public.proveedor_saldos_favor(id),
  orden_compra_id uuid not null references public.ordenes_compra(id) on delete cascade,
  valor numeric(18,2) not null check (valor > 0),
  creado_por uuid references public.perfiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists saldo_favor_aplicaciones_saldo on public.saldo_favor_aplicaciones (saldo_id);
create index if not exists saldo_favor_aplicaciones_orden on public.saldo_favor_aplicaciones (orden_compra_id);

-- Sin políticas: se leen y escriben solo por las funciones de abajo.
alter table public.proveedor_saldos_favor enable row level security;
alter table public.saldo_favor_aplicaciones enable row level security;
revoke all on public.proveedor_saldos_favor, public.saldo_favor_aplicaciones from anon, authenticated;

-- ------------------------------------------------- lo disponible de un saldo
create or replace function public._saldo_favor_disponible(p_saldo_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when s.cerrado_at is not null then 0
    else greatest(s.valor - coalesce((
      select sum(a.valor) from saldo_favor_aplicaciones a
        join ordenes_compra o on o.id = a.orden_compra_id
       where a.saldo_id = s.id and o.estado not in ('cancelada', 'rechazada')), 0), 0) end
  from proveedor_saldos_favor s
  where s.id = p_saldo_id
$$;
revoke all on function public._saldo_favor_disponible(uuid) from public, anon, authenticated;

-- ------------------------------------------- cálculo del cierre (sin escribir)
-- Lo usan la vista previa y el cierre: líneas (pedido, recibido, faltante),
-- valor faltante, cuánto se descuenta de cada pago y el saldo a favor.
create or replace function public._calcular_cierre_faltante(p_orden_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lineas jsonb := '[]'::jsonb;
  v_total_actual numeric;
  v_total_nuevo numeric := 0;
  v_recibido numeric;
  v_l record;
  v_pagos_vivos numeric;
  v_aplicado numeric;
  v_exceso numeric;
  v_pagos jsonb := '[]'::jsonb;
  v_p record;
  v_menos numeric;
begin
  v_total_actual := round(public.total_orden_compra(p_orden_id), 0);

  for v_l in
    select i.id, i.cantidad, i.precio_unitario, i.porcentaje_descuento, i.porcentaje_iva,
           i.um_compra, i.cantidad_por_um, i.cantidad_compra,
           mi.codigo as insumo_codigo, mi.descripcion as insumo_descripcion, mi.u_m
      from ordenes_compra_items i
      left join pedidos_insumos pe on pe.id = i.pedido_insumo_id
      left join maestro_insumos mi on mi.id = pe.insumo_id
     where i.orden_compra_id = p_orden_id
     order by mi.descripcion, i.id
  loop
    v_recibido := least(public._recibido_linea_oc(v_l.id), v_l.cantidad);
    v_total_nuevo := v_total_nuevo
      + v_recibido * v_l.precio_unitario * (1 - v_l.porcentaje_descuento / 100.0) * (1 + v_l.porcentaje_iva / 100.0);
    v_lineas := v_lineas || jsonb_build_object(
      'id', v_l.id, 'insumo_codigo', v_l.insumo_codigo, 'insumo_descripcion', v_l.insumo_descripcion,
      'unidad', coalesce(v_l.um_compra, v_l.u_m),
      -- En la unidad que muestra la orden (la presentación si la línea la tiene).
      'pedido', case when v_l.um_compra is not null then v_l.cantidad_compra else v_l.cantidad end,
      'recibido', case when v_l.um_compra is not null then round(v_recibido / v_l.cantidad_por_um, 4) else v_recibido end,
      'valor_faltante', round((v_l.cantidad - v_recibido) * v_l.precio_unitario
                              * (1 - v_l.porcentaje_descuento / 100.0) * (1 + v_l.porcentaje_iva / 100.0), 2));
  end loop;
  v_total_nuevo := round(v_total_nuevo, 0);

  select coalesce(sum(valor), 0) into v_pagos_vivos
    from pagos where orden_compra_id = p_orden_id and estado not in ('anulado', 'rechazado');
  select coalesce(saldo_favor_aplicado, 0) into v_aplicado from ordenes_compra where id = p_orden_id;
  v_exceso := greatest(v_pagos_vivos + v_aplicado - v_total_nuevo, 0);

  -- Primero lo que todavía no se ha pagado: el saldo, después lo demás.
  for v_p in
    select id, tipo, estado, valor from pagos
     where orden_compra_id = p_orden_id and estado in ('programado', 'solicitado', 'en_espera')
     order by (tipo = 'saldo') desc, valor desc, id
  loop
    exit when v_exceso <= 0;
    v_menos := least(v_exceso, v_p.valor);
    v_pagos := v_pagos || jsonb_build_object('pago_id', v_p.id, 'tipo', v_p.tipo, 'estado', v_p.estado,
                                             'valor', v_p.valor, 'menos', v_menos, 'queda', v_p.valor - v_menos);
    v_exceso := v_exceso - v_menos;
  end loop;

  return jsonb_build_object(
    'total_actual', v_total_actual,
    'total_nuevo', v_total_nuevo,
    'valor_faltante', greatest(v_total_actual - v_total_nuevo, 0),
    'lineas', v_lineas,
    'pagos', v_pagos,
    'pagos_reducidos', coalesce((select sum((x->>'menos')::numeric) from jsonb_array_elements(v_pagos) x), 0),
    'saldo_favor', v_exceso);
end;
$$;
revoke all on function public._calcular_cierre_faltante(uuid) from public, anon, authenticated;

-- Si se puede cerrar y por qué no (para la pantalla y el cierre).
create or replace function public._motivo_no_cierre_faltante(p_orden_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_o record;
begin
  select estado, estado_entrega, cerrada_faltante_at into v_o from ordenes_compra where id = p_orden_id;
  if not found then return 'La orden de compra no existe.'; end if;
  if v_o.cerrada_faltante_at is not null then return 'La orden ya se cerró con faltante.'; end if;
  if v_o.estado <> 'aprobada' then return 'Solo se cierra con faltante una orden aprobada.'; end if;
  if v_o.estado_entrega = 'entregada' then return 'La orden ya se entregó completa.'; end if;
  if not exists (select 1 from entradas_almacen e where e.orden_compra_id = p_orden_id and e.anulada_at is null) then
    return 'La orden no tiene entradas de almacén: si el proveedor no va a entregar nada, cancélala.';
  end if;
  return null;
end;
$$;
revoke all on function public._motivo_no_cierre_faltante(uuid) from public, anon, authenticated;

-- Vista previa para la pantalla (Compras, con acceso al proyecto).
create or replace function public.vista_cierre_faltante(p_orden_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_proyecto uuid;
begin
  if not public.tiene_accion(auth.uid(), 'comprar') then
    raise exception 'No autorizado -- solo Compras cierra órdenes con faltante.';
  end if;
  select proyecto_id into v_proyecto from ordenes_compra where id = p_orden_id;
  if not found then raise exception 'La orden de compra no existe.'; end if;
  perform public._exigir_proyecto(v_proyecto);
  return public._calcular_cierre_faltante(p_orden_id)
         || jsonb_build_object('motivo_no', public._motivo_no_cierre_faltante(p_orden_id));
end;
$$;
revoke all on function public.vista_cierre_faltante(uuid) from public, anon;
grant execute on function public.vista_cierre_faltante(uuid) to authenticated;

-- --------------------------------------------------------------- cerrar
create or replace function public.cerrar_orden_con_faltante(p_orden_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_oc record;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_no text;
  v_calc jsonb;
  v_x jsonb;
  v_l record;
  v_recibido numeric;
  v_saldo numeric;
  v_saldo_id uuid;
begin
  if not public.tiene_accion(auth.uid(), 'comprar') then
    raise exception 'No autorizado -- solo Compras cierra órdenes con faltante.';
  end if;
  if v_motivo is null or length(v_motivo) < 3 then raise exception 'Escribe el motivo del cierre.'; end if;

  select o.id, o.proyecto_id, o.proveedor_id, o.codigo, p.empresa_id
    into v_oc
    from ordenes_compra o left join proyectos p on p.id = o.proyecto_id
   where o.id = p_orden_id
   for update of o;
  if not found then raise exception 'La orden de compra no existe.'; end if;
  perform public._exigir_proyecto(v_oc.proyecto_id);
  -- Los pagos de la orden quedan bloqueados mientras se calcula y se descuenta.
  perform 1 from pagos where orden_compra_id = p_orden_id for update;

  v_no := public._motivo_no_cierre_faltante(p_orden_id);
  if v_no is not null then raise exception '%', v_no; end if;

  v_calc := public._calcular_cierre_faltante(p_orden_id);
  if (v_calc->>'valor_faltante')::numeric <= 0
     and not exists (select 1 from jsonb_array_elements(v_calc->'lineas') x
                      where (x->>'recibido')::numeric < (x->>'pedido')::numeric) then
    raise exception 'No hay faltante: todo lo de la orden está recibido.';
  end if;

  -- 1. Pagos: se descuenta lo no entregado de lo que todavía no se ha pagado.
  for v_x in select * from jsonb_array_elements(v_calc->'pagos') loop
    if (v_x->>'queda')::numeric > 0 then
      update pagos set valor = (v_x->>'queda')::numeric where id = (v_x->>'pago_id')::uuid;
    else
      update pagos set estado = 'anulado', anulado_en = now(),
                       motivo_anulacion = 'La orden de compra se cerró con faltante: no queda nada por pagar en este pago.'
       where id = (v_x->>'pago_id')::uuid;
    end if;
  end loop;

  -- 2. Líneas: quedan en lo recibido; lo pedido se guarda.
  for v_l in
    select i.* from ordenes_compra_items i where i.orden_compra_id = p_orden_id for update
  loop
    v_recibido := least(public._recibido_linea_oc(v_l.id), v_l.cantidad);
    continue when v_recibido >= v_l.cantidad;
    update ordenes_compra_items
       set pedido_original = jsonb_build_object(
             'cantidad', v_l.cantidad, 'um_compra', v_l.um_compra, 'conversion_compra', v_l.conversion_compra,
             'cantidad_compra', v_l.cantidad_compra, 'precio_compra', v_l.precio_compra, 'cantidad_por_um', v_l.cantidad_por_um),
           cantidad = v_recibido,
           -- La presentación solo se conserva si lo recibido son unidades completas de ella.
           um_compra = case when v_l.um_compra is not null and v_recibido > 0
                              and v_recibido / v_l.cantidad_por_um = trunc(v_recibido / v_l.cantidad_por_um)
                            then v_l.um_compra end,
           conversion_compra = case when v_l.um_compra is not null and v_recibido > 0
                              and v_recibido / v_l.cantidad_por_um = trunc(v_recibido / v_l.cantidad_por_um)
                            then v_l.conversion_compra end,
           cantidad_compra = case when v_l.um_compra is not null and v_recibido > 0
                              and v_recibido / v_l.cantidad_por_um = trunc(v_recibido / v_l.cantidad_por_um)
                            then v_recibido / v_l.cantidad_por_um end,
           precio_compra = case when v_l.um_compra is not null and v_recibido > 0
                              and v_recibido / v_l.cantidad_por_um = trunc(v_recibido / v_l.cantidad_por_um)
                            then v_l.precio_compra end,
           cantidad_por_um = case when v_l.um_compra is not null and v_recibido > 0
                              and v_recibido / v_l.cantidad_por_um = trunc(v_recibido / v_l.cantidad_por_um)
                            then v_l.cantidad_por_um end
     where id = v_l.id;
  end loop;

  -- 3. Saldo a favor: lo que ya se pagó de más.
  v_saldo := round((v_calc->>'saldo_favor')::numeric, 2);
  if v_saldo > 0 then
    insert into proveedor_saldos_favor (proveedor_id, empresa_id, orden_origen_id, valor, creado_por)
    values (v_oc.proveedor_id, v_oc.empresa_id, p_orden_id, v_saldo, auth.uid())
    returning id into v_saldo_id;
  end if;

  update ordenes_compra
     set cerrada_faltante_at = now(), cerrada_faltante_por = auth.uid(), motivo_cierre_faltante = v_motivo,
         valor_faltante = (v_calc->>'valor_faltante')::numeric,
         pagos_reducidos = (v_calc->>'pagos_reducidos')::numeric,
         saldo_favor_generado = v_saldo
   where id = p_orden_id;

  -- La orden queda Entregada (lo recibido = lo que queda en la orden); si el
  -- saldo era "al ser entregado", con esto pasa a pago (_oc_entrega_pagos).
  perform public._recalcular_estado_entrega(p_orden_id);

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
  values ('orden_compra', p_orden_id, 'cerrada_con_faltante', auth.uid(), v_motivo,
          jsonb_build_object('valor_faltante', (v_calc->>'valor_faltante')::numeric,
                             'pagos_reducidos', (v_calc->>'pagos_reducidos')::numeric,
                             'saldo_favor', v_saldo, 'saldo_id', v_saldo_id,
                             'total_antes', (v_calc->>'total_actual')::numeric,
                             'total_despues', (v_calc->>'total_nuevo')::numeric));

  return jsonb_build_object('valor_faltante', (v_calc->>'valor_faltante')::numeric,
                            'pagos_reducidos', (v_calc->>'pagos_reducidos')::numeric,
                            'saldo_favor', v_saldo);
end;
$$;
revoke all on function public.cerrar_orden_con_faltante(uuid, text) from public, anon;
grant execute on function public.cerrar_orden_con_faltante(uuid, text) to authenticated;

-- ----------------------------------------------------- consultar saldos
-- Lista para la pantalla "Saldos a favor": Compras (o la pestaña) y A&F.
create or replace function public.listar_saldos_favor(p_solo_disponibles boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.tiene_accion(auth.uid(), 'comprar')
          or public.tiene_pestana(auth.uid(), 'compras.saldos_favor')
          or public.tiene_accion(auth.uid(), 'aprobar_pagos')) then
    raise exception 'No autorizado -- no tienes acceso a los saldos a favor.';
  end if;
  return coalesce((
    select jsonb_agg(x order by x->>'creado_at' desc)
      from (
        select jsonb_build_object(
          'id', s.id,
          'proveedor_id', s.proveedor_id,
          'proveedor', pv.nombre,
          'empresa', e.razon_social,
          'orden_origen_id', s.orden_origen_id,
          'orden_origen', o.codigo,
          'valor', s.valor,
          'disponible', public._saldo_favor_disponible(s.id),
          'creado_at', s.created_at,
          'creado_por', pc.nombre,
          'cerrado_at', s.cerrado_at,
          'cerrado_por', pz.nombre,
          'motivo_cierre', s.motivo_cierre,
          'aplicaciones', coalesce((
            select jsonb_agg(jsonb_build_object('orden_id', oa.id, 'orden', oa.codigo, 'estado', oa.estado,
                                                'valor', a.valor, 'fecha', a.created_at) order by a.created_at)
              from saldo_favor_aplicaciones a join ordenes_compra oa on oa.id = a.orden_compra_id
             where a.saldo_id = s.id), '[]'::jsonb)) as x
          from proveedor_saldos_favor s
          left join proveedores pv on pv.unique_id = s.proveedor_id
          left join empresas e on e.id = s.empresa_id
          left join ordenes_compra o on o.id = s.orden_origen_id
          left join perfiles pc on pc.id = s.creado_por
          left join perfiles pz on pz.id = s.cerrado_por
         where not coalesce(p_solo_disponibles, true) or public._saldo_favor_disponible(s.id) > 0
      ) t), '[]'::jsonb);
end;
$$;
revoke all on function public.listar_saldos_favor(boolean) from public, anon;
grant execute on function public.listar_saldos_favor(boolean) to authenticated;

-- Saldos disponibles de un proveedor en la empresa del proyecto (Generar OC).
create or replace function public.saldos_favor_proveedor(p_proveedor_id uuid, p_proyecto_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
begin
  if not public.tiene_accion(auth.uid(), 'comprar') then
    raise exception 'No autorizado -- solo Compras usa saldos a favor.';
  end if;
  perform public._exigir_proyecto(p_proyecto_id);
  select empresa_id into v_empresa from proyectos where id = p_proyecto_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'disponible', public._saldo_favor_disponible(s.id),
                                        'orden_origen', o.codigo, 'creado_at', s.created_at) order by s.created_at)
      from proveedor_saldos_favor s
      left join ordenes_compra o on o.id = s.orden_origen_id
     where s.proveedor_id = p_proveedor_id
       and s.empresa_id is not distinct from v_empresa
       and s.cerrado_at is null
       and public._saldo_favor_disponible(s.id) > 0), '[]'::jsonb);
end;
$$;
revoke all on function public.saldos_favor_proveedor(uuid, uuid) from public, anon;
grant execute on function public.saldos_favor_proveedor(uuid, uuid) to authenticated;

-- ------------------------------------------------------ cerrar un saldo
create or replace function public.cerrar_saldo_favor(p_saldo_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s record;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_disponible numeric;
begin
  if not public.tiene_accion(auth.uid(), 'comprar') then
    raise exception 'No autorizado -- solo Compras cierra saldos a favor.';
  end if;
  if v_motivo is null or length(v_motivo) < 3 then raise exception 'Escribe el motivo para cerrar el saldo.'; end if;
  select * into v_s from proveedor_saldos_favor where id = p_saldo_id for update;
  if not found then raise exception 'El saldo a favor no existe.'; end if;
  if v_s.cerrado_at is not null then raise exception 'Ese saldo a favor ya estaba cerrado.'; end if;
  v_disponible := public._saldo_favor_disponible(p_saldo_id);

  update proveedor_saldos_favor set cerrado_at = now(), cerrado_por = auth.uid(), motivo_cierre = v_motivo
   where id = p_saldo_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
  values ('orden_compra', v_s.orden_origen_id, 'saldo_favor_cerrado', auth.uid(), v_motivo,
          jsonb_build_object('saldo_id', p_saldo_id, 'valor', v_s.valor, 'disponible', v_disponible));
end;
$$;
revoke all on function public.cerrar_saldo_favor(uuid, text) from public, anon;
grant execute on function public.cerrar_saldo_favor(uuid, text) to authenticated;

-- ------------------------------ pestaña "Saldos a favor" para quien compra
insert into public.rol_permisos (rol_id, permiso)
select distinct rp.rol_id, 'tab.compras.saldos_favor'
  from public.rol_permisos rp
 where rp.permiso = 'accion.comprar'
   and not exists (select 1 from public.rol_permisos x where x.rol_id = rp.rol_id and x.permiso = 'tab.compras.saldos_favor');

-- -------------------------------- una OC cerrada con faltante no se modifica
do $$
declare
  d text := pg_get_functiondef('public._motivo_orden_no_modificable(uuid)'::regprocedure);
  ancla text := '  if v_o.estado_entrega <> ''sin_entregar''';
  nuevo text := '  if exists (select 1 from ordenes_compra c where c.id = p_orden_id and c.cerrada_faltante_at is not null) then
    return ''La orden se cerró con faltante: ya no se modifica.'';
  end if;
';
begin
  if position('c.cerrada_faltante_at is not null' in d) > 0 then
    return;  -- ya aplicado
  end if;
  if position(ancla in d) = 0 then
    raise exception '_motivo_orden_no_modificable no tiene el texto esperado.';
  end if;
  execute replace(d, ancla, nuevo || ancla);
end $$;

commit;
