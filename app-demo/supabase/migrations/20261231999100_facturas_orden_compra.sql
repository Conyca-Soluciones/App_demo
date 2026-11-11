-- Paquete C, entrega 1: facturas de la orden de compra (decisión del usuario,
-- 2026-11-11). Después de aprobada la OC, Compras registra la factura del
-- proveedor: una sola por toda la orden o, marcando "Factura parcial", varias,
-- cada una con los insumos y cantidades de la OC que incluye. Campos: archivo,
-- fecha, subtotal, IVA (el total se calcula), observaciones (opcional). No se
-- borran: se anulan con motivo. Las ve quien ve la orden (Compras, Registro de
-- OC, Control del proyecto y A&F desde el pago: Contabilidad en el Consolidado).
--
-- SOLO AGREGA: dos tablas, tres funciones nuevas y tres ajustes:
--   * el archivo de la factura vive en el bucket `ordenes_compra`: sus
--     políticas de leer y borrar se amplían para las facturas (leer como el
--     soporte; Compras no puede borrar el archivo de una factura registrada);
--   * `_motivo_orden_no_modificable` (parche por texto exacto, falla sin
--     cambiar nada si no lo encuentra): una OC con facturas vigentes no se
--     modifica (Modificar reemplaza sus líneas).
-- No toca ningún dato existente. Se puede correr dos veces. Va después de
-- 20261231998000. Reversa: supabase/reversa/20261231999100_facturas_orden_compra.sql

begin;

-- ------------------------------------------------------------------ tablas
create table if not exists public.orden_compra_facturas (
  id uuid primary key default gen_random_uuid(),
  orden_compra_id uuid not null references public.ordenes_compra(id) on delete cascade,
  parcial boolean not null,
  fecha date not null,
  subtotal numeric(18,2) not null check (subtotal >= 0),
  iva numeric(18,2) not null check (iva >= 0),
  total numeric(18,2) generated always as (subtotal + iva) stored,
  observaciones text,
  ruta text not null unique,
  nombre_archivo text not null,
  tamano bigint,
  mime text,
  subida_por uuid references public.perfiles(id) on delete set null,
  created_at timestamptz not null default now(),
  anulada_at timestamptz,
  anulada_por uuid references public.perfiles(id) on delete set null,
  motivo_anulacion text,
  constraint orden_compra_facturas_total_positivo check (subtotal + iva > 0),
  constraint orden_compra_facturas_anulacion check ((anulada_at is null) = (motivo_anulacion is null))
);
create index if not exists orden_compra_facturas_orden on public.orden_compra_facturas (orden_compra_id);

create table if not exists public.orden_compra_factura_items (
  factura_id uuid not null references public.orden_compra_facturas(id) on delete cascade,
  orden_compra_item_id uuid not null references public.ordenes_compra_items(id),
  -- En la unidad que muestra la orden: la presentación (cajas) si la línea la
  -- tiene, si no la unidad del insumo.
  cantidad numeric(18,2) not null check (cantidad > 0 and cantidad = trunc(cantidad)),
  primary key (factura_id, orden_compra_item_id)
);
create index if not exists orden_compra_factura_items_linea on public.orden_compra_factura_items (orden_compra_item_id);

alter table public.orden_compra_facturas enable row level security;
alter table public.orden_compra_factura_items enable row level security;

-- Leer: quien ve la orden (la subconsulta aplica la RLS de ordenes_compra).
-- Escribir: solo por las funciones de abajo (SECURITY DEFINER).
drop policy if exists orden_compra_facturas_select on public.orden_compra_facturas;
create policy orden_compra_facturas_select on public.orden_compra_facturas for select to authenticated
  using (exists (select 1 from public.ordenes_compra o where o.id = orden_compra_facturas.orden_compra_id));
drop policy if exists orden_compra_factura_items_select on public.orden_compra_factura_items;
create policy orden_compra_factura_items_select on public.orden_compra_factura_items for select to authenticated
  using (exists (select 1 from public.orden_compra_facturas f where f.id = orden_compra_factura_items.factura_id));

revoke all on public.orden_compra_facturas, public.orden_compra_factura_items from anon;
revoke insert, update, delete on public.orden_compra_facturas, public.orden_compra_factura_items from authenticated;
grant select on public.orden_compra_facturas, public.orden_compra_factura_items to authenticated;

-- ---------------------------------------------- archivo en el bucket ordenes_compra
drop policy if exists ordenes_compra_archivos_select on storage.objects;
create policy ordenes_compra_archivos_select on storage.objects for select to authenticated
  using (bucket_id = 'ordenes_compra' and (
    exists (select 1 from public.orden_compra_soportes s where s.ruta = objects.name)
    or exists (select 1 from public.orden_compra_facturas f where f.ruta = objects.name)));

drop policy if exists ordenes_compra_archivos_delete on storage.objects;
create policy ordenes_compra_archivos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ordenes_compra'
         and (select public.tiene_accion((select auth.uid()), 'comprar'))
         and not exists (select 1 from public.orden_compra_soportes s where s.ruta = objects.name)
         and not exists (select 1 from public.orden_compra_facturas f where f.ruta = objects.name));

-- ------------------------------------------------------------ registrar
-- p_datos: {parcial, fecha, subtotal, iva, observaciones, ruta, nombre_archivo,
-- tamano, mime, items: [{orden_compra_item_id, cantidad}]} (items solo si es parcial).
create or replace function public.registrar_factura_orden(p_orden_id uuid, p_datos jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_oc record;
  v_parcial boolean := coalesce((p_datos->>'parcial')::boolean, false);
  v_fecha date := nullif(p_datos->>'fecha', '')::date;
  v_subtotal numeric := nullif(p_datos->>'subtotal', '')::numeric;
  v_iva numeric := nullif(p_datos->>'iva', '')::numeric;
  v_obs text := nullif(trim(coalesce(p_datos->>'observaciones', '')), '');
  v_ruta text := nullif(trim(coalesce(p_datos->>'ruta', '')), '');
  v_items jsonb := coalesce(p_datos->'items', '[]'::jsonb);
  v_id uuid;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_l record;
  v_n int := 0;
begin
  if not public.tiene_accion(auth.uid(), 'comprar') then
    raise exception 'No autorizado -- solo Compras registra facturas de órdenes de compra.';
  end if;
  select id, codigo, estado, proyecto_id into v_oc from ordenes_compra where id = p_orden_id for update;
  if not found then raise exception 'La orden de compra no existe.'; end if;
  perform public._exigir_proyecto(v_oc.proyecto_id);
  if v_oc.estado <> 'aprobada' then
    raise exception 'Solo se registran facturas de órdenes aprobadas.';
  end if;

  if v_fecha is null then raise exception 'Escribe la fecha de la factura.'; end if;
  if v_fecha > v_hoy then raise exception 'La fecha de la factura no puede ser posterior a hoy.'; end if;
  if v_subtotal is null or v_subtotal < 0 then raise exception 'Escribe el subtotal de la factura.'; end if;
  if v_iva is null or v_iva < 0 then raise exception 'Escribe el IVA de la factura (0 si no tiene).'; end if;
  if round(v_subtotal + v_iva, 2) <= 0 then raise exception 'El total de la factura debe ser mayor que cero.'; end if;
  if v_ruta is null then raise exception 'Adjunta el archivo de la factura.'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'ordenes_compra' and o.name = v_ruta) then
    raise exception 'No se encontró el archivo de la factura. Vuelve a adjuntarlo.';
  end if;
  if exists (select 1 from orden_compra_soportes s where s.ruta = v_ruta)
     or exists (select 1 from orden_compra_facturas f where f.ruta = v_ruta) then
    raise exception 'Ese archivo ya está registrado. Vuelve a adjuntarlo.';
  end if;

  -- Una orden lleva una factura total o facturas parciales, no las dos.
  if exists (select 1 from orden_compra_facturas f where f.orden_compra_id = p_orden_id and f.anulada_at is null and not f.parcial) then
    raise exception 'Esta orden ya tiene su factura total. Anúlala si hay que cambiarla.';
  end if;
  if not v_parcial and exists (select 1 from orden_compra_facturas f where f.orden_compra_id = p_orden_id and f.anulada_at is null and f.parcial) then
    raise exception 'Esta orden tiene facturas parciales: agrega otra factura parcial.';
  end if;

  -- Lo facturado no pasa del total de la orden (un peso de tolerancia por redondeo).
  if (select coalesce(sum(f.total), 0) from orden_compra_facturas f where f.orden_compra_id = p_orden_id and f.anulada_at is null)
     + round(v_subtotal + v_iva, 2) > round(public.total_orden_compra(p_orden_id), 0) + 1 then
    raise exception 'Con esta factura se pasaría del total de la orden (% ). Revisa los valores.',
      to_char(round(public.total_orden_compra(p_orden_id), 0), 'FM999G999G999G990');
  end if;

  if v_parcial then
    if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
      raise exception 'Elige los insumos que incluye esta factura parcial.';
    end if;
    for v_l in
      select x.orden_compra_item_id, x.cantidad, i.id as linea, i.orden_compra_id,
             coalesce(case when i.um_compra is not null then i.cantidad_compra end, i.cantidad) as pedida
        from jsonb_to_recordset(v_items) as x(orden_compra_item_id uuid, cantidad numeric)
        left join ordenes_compra_items i on i.id = x.orden_compra_item_id
    loop
      if v_l.linea is null or v_l.orden_compra_id <> p_orden_id then
        raise exception 'Hay un insumo que no es de esta orden.';
      end if;
      if v_l.cantidad is null or v_l.cantidad <= 0 or v_l.cantidad <> trunc(v_l.cantidad) then
        raise exception 'Las cantidades facturadas deben ser números enteros mayores que cero.';
      end if;
      if v_l.cantidad + coalesce((
           select sum(fi.cantidad) from orden_compra_factura_items fi
             join orden_compra_facturas f on f.id = fi.factura_id
            where fi.orden_compra_item_id = v_l.linea and f.anulada_at is null), 0) > v_l.pedida then
        raise exception 'Hay un insumo con más cantidad facturada que la pedida en la orden.';
      end if;
      v_n := v_n + 1;
    end loop;
    if (select count(distinct x.orden_compra_item_id) from jsonb_to_recordset(v_items) as x(orden_compra_item_id uuid)) <> v_n then
      raise exception 'Hay un insumo repetido en la factura.';
    end if;
  end if;

  insert into orden_compra_facturas (orden_compra_id, parcial, fecha, subtotal, iva, observaciones, ruta, nombre_archivo, tamano, mime, subida_por)
  values (p_orden_id, v_parcial, v_fecha, round(v_subtotal, 2), round(v_iva, 2), v_obs, v_ruta,
          coalesce(nullif(trim(p_datos->>'nombre_archivo'), ''), 'factura'),
          nullif(p_datos->>'tamano', '')::bigint, p_datos->>'mime', auth.uid())
  returning id into v_id;

  if v_parcial then
    insert into orden_compra_factura_items (factura_id, orden_compra_item_id, cantidad)
    select v_id, x.orden_compra_item_id, x.cantidad
      from jsonb_to_recordset(v_items) as x(orden_compra_item_id uuid, cantidad numeric);
  end if;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('orden_compra', p_orden_id, 'factura_registrada', auth.uid(),
          jsonb_build_object('factura_id', v_id, 'parcial', v_parcial, 'fecha', v_fecha,
                             'subtotal', round(v_subtotal, 2), 'iva', round(v_iva, 2), 'total', round(v_subtotal + v_iva, 2)));
  return v_id;
end;
$$;
revoke all on function public.registrar_factura_orden(uuid, jsonb) from public, anon;
grant execute on function public.registrar_factura_orden(uuid, jsonb) to authenticated;

-- --------------------------------------------------------------- anular
create or replace function public.anular_factura_orden(p_factura_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f record;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if not public.tiene_accion(auth.uid(), 'comprar') then
    raise exception 'No autorizado -- solo Compras anula facturas de órdenes de compra.';
  end if;
  if v_motivo is null then raise exception 'Escribe el motivo de la anulación.'; end if;
  select f.id, f.orden_compra_id, f.anulada_at, f.parcial, f.total, o.proyecto_id
    into v_f
    from orden_compra_facturas f join ordenes_compra o on o.id = f.orden_compra_id
   where f.id = p_factura_id
   for update of f;
  if not found then raise exception 'La factura no existe.'; end if;
  perform public._exigir_proyecto(v_f.proyecto_id);
  if v_f.anulada_at is not null then raise exception 'Esa factura ya estaba anulada.'; end if;

  update orden_compra_facturas
     set anulada_at = now(), anulada_por = auth.uid(), motivo_anulacion = v_motivo
   where id = p_factura_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
  values ('orden_compra', v_f.orden_compra_id, 'factura_anulada', auth.uid(), v_motivo,
          jsonb_build_object('factura_id', p_factura_id, 'parcial', v_f.parcial, 'total', v_f.total));
end;
$$;
revoke all on function public.anular_factura_orden(uuid, text) from public, anon;
grant execute on function public.anular_factura_orden(uuid, text) to authenticated;

-- ---------------------------------- una OC con facturas no se modifica
do $$
declare
  d text := pg_get_functiondef('public._motivo_orden_no_modificable(uuid)'::regprocedure);
  ancla text := '  if v_o.estado_entrega <> ''sin_entregar''';
  nuevo text := '  if exists (select 1 from orden_compra_facturas f where f.orden_compra_id = p_orden_id and f.anulada_at is null) then
    return ''La orden ya tiene facturas registradas: anúlalas antes de modificarla.'';
  end if;
';
begin
  if position('from orden_compra_facturas f where f.orden_compra_id = p_orden_id' in d) > 0 then
    return;  -- ya aplicado
  end if;
  if position(ancla in d) = 0 then
    raise exception '_motivo_orden_no_modificable no tiene el texto esperado.';
  end if;
  execute replace(d, ancla, nuevo || ancla);
end $$;

commit;
