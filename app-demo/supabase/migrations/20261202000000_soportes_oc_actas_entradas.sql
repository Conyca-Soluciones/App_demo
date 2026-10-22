-- T4 (revisión por roles): soportes. Decisiones del usuario 2026-10-21:
--   1. Generar OC: soporte OBLIGATORIO (cotización, cuenta de cobro o factura).
--   2. Actas: soporte de pago (factura o cuenta de cobro) aparte de los demás
--      (memoria de cantidades, registro fotográfico, otros); el de pago es
--      obligatorio (si el acta tiene pago; la liquidación con neto $ 0 no
--      tiene pago).
--   3. Entradas: soporte de la remisión (opcional).
--
-- Número después de las migraciones de la rama de spr (pólizas, firmas y
-- representantes, hasta 20261201000000), que también tocan acta_soportes.
-- Mismo esquema que los soportes de actas y contratistas: el navegador sube
-- el archivo a un bucket privado con la sesión del usuario y después una
-- función lo registra (revisa que exista); el archivo que no quedó registrado
-- se puede borrar.

-- =============================================================== 1. OC
create table if not exists public.orden_compra_soportes (
  id uuid primary key default gen_random_uuid(),
  orden_compra_id uuid not null references public.ordenes_compra(id) on delete cascade,
  tipo text not null check (tipo in ('cotizacion', 'cuenta_cobro', 'factura')),
  ruta text not null unique,
  nombre_archivo text not null,
  tamano bigint,
  mime text,
  subido_por uuid references public.perfiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_orden_compra_soportes_orden on public.orden_compra_soportes (orden_compra_id);
create index if not exists idx_orden_compra_soportes_subido_por on public.orden_compra_soportes (subido_por);

alter table public.orden_compra_soportes enable row level security;
revoke all on public.orden_compra_soportes from anon;
revoke insert, update, delete on public.orden_compra_soportes from authenticated;
grant select on public.orden_compra_soportes to authenticated;

-- Ve el soporte quien ve la orden (la subconsulta aplica la RLS de ordenes_compra).
drop policy if exists orden_compra_soportes_select on public.orden_compra_soportes;
create policy orden_compra_soportes_select on public.orden_compra_soportes for select to authenticated
  using (exists (select 1 from public.ordenes_compra o where o.id = orden_compra_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ordenes_compra', 'ordenes_compra', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists ordenes_compra_archivos_select on storage.objects;
create policy ordenes_compra_archivos_select on storage.objects for select to authenticated
  using (bucket_id = 'ordenes_compra'
         and exists (select 1 from public.orden_compra_soportes s where s.ruta = name));

drop policy if exists ordenes_compra_archivos_insert on storage.objects;
create policy ordenes_compra_archivos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ordenes_compra' and (select public.tiene_accion((select auth.uid()), 'comprar')));

-- Solo lo que todavía no es soporte de ninguna orden (lo que quedó de un intento fallido).
drop policy if exists ordenes_compra_archivos_delete on storage.objects;
create policy ordenes_compra_archivos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ordenes_compra'
         and (select public.tiene_accion((select auth.uid()), 'comprar'))
         and not exists (select 1 from public.orden_compra_soportes s where s.ruta = name));

-- Crear la OC CON su soporte, en una transacción. crear_orden_compra (que
-- revisa el permiso y el proyecto) deja de estar disponible para los usuarios:
-- ya no se puede crear una orden sin soporte.
create or replace function public.crear_orden_compra_con_soporte(
  p_proyecto_id uuid, p_proveedor_id uuid, p_sitio_entrega text, p_fecha_entrega date,
  p_contacto_nombre text, p_telefono text, p_ciudad text, p_email text,
  p_condiciones_pago text, p_observaciones text, p_lineas jsonb, p_soporte jsonb,
  p_anticipo_porcentaje numeric default null, p_saldo_modo text default null, p_saldo_fecha date default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_ruta text := nullif(trim(coalesce(p_soporte->>'ruta', '')), '');
  v_tipo text := p_soporte->>'tipo';
begin
  if p_soporte is null or v_ruta is null then
    raise exception 'Adjunta el soporte de la orden (cotización, cuenta de cobro o factura).';
  end if;
  if v_tipo is null or v_tipo not in ('cotizacion', 'cuenta_cobro', 'factura') then
    raise exception 'El soporte debe ser una cotización, una cuenta de cobro o una factura.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'ordenes_compra' and o.name = v_ruta) then
    raise exception 'No se encontró el archivo del soporte. Vuelve a adjuntarlo.';
  end if;
  if exists (select 1 from orden_compra_soportes s where s.ruta = v_ruta) then
    raise exception 'Ese archivo ya es soporte de otra orden. Vuelve a adjuntarlo.';
  end if;

  v_id := public.crear_orden_compra(
    p_proyecto_id => p_proyecto_id, p_proveedor_id => p_proveedor_id, p_sitio_entrega => p_sitio_entrega,
    p_fecha_entrega => p_fecha_entrega, p_contacto_nombre => p_contacto_nombre, p_telefono => p_telefono,
    p_ciudad => p_ciudad, p_email => p_email, p_condiciones_pago => p_condiciones_pago,
    p_observaciones => p_observaciones, p_lineas => p_lineas, p_anticipo_porcentaje => p_anticipo_porcentaje,
    p_saldo_modo => p_saldo_modo, p_saldo_fecha => p_saldo_fecha);

  insert into orden_compra_soportes (orden_compra_id, tipo, ruta, nombre_archivo, tamano, mime, subido_por)
  values (v_id, v_tipo, v_ruta, coalesce(nullif(trim(p_soporte->>'nombre_archivo'), ''), 'soporte'),
          nullif(p_soporte->>'tamano', '')::bigint, p_soporte->>'mime', auth.uid());
  return v_id;
end;
$function$;

revoke all on function public.crear_orden_compra_con_soporte(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, numeric, text, date) from public, anon;
grant execute on function public.crear_orden_compra_con_soporte(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, numeric, text, date) to authenticated;
revoke execute on function public.crear_orden_compra(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, numeric, text, date) from public, anon, authenticated;

-- =============================================================== 2. Actas
-- Cuenta de cobro como soporte de pago (además de la factura). Se conserva
-- 'firmada_contratista' (firmas electrónicas, rama de spr).
alter table public.acta_soportes drop constraint if exists acta_soportes_tipo_check;
alter table public.acta_soportes add constraint acta_soportes_tipo_check
  check (tipo in ('factura', 'cuenta_cobro', 'memoria', 'foto', 'otro', 'firmada_contratista'));

-- Igual a la versión viva, salvo el soporte de pago: factura O cuenta de cobro.
create or replace function public._pago_de_acta(p_acta_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v record;
  v_valor numeric;
  v_tercero uuid;
  v_cuenta uuid;
  v_concepto text;
  v_pago uuid;
begin
  select a.id, a.numero, a.tipo, a.estado, a.neto, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero) as numero_contrato,
         k.numero_documento, k.nombre as contratista_nombre, py.empresa_id, e.consolidado_id
    into v
  from actas a
  join contratos c on c.id = a.contrato_id
  join contratistas k on k.id = c.contratista_id
  left join proyectos py on py.id = c.proyecto_id
  left join empresas e on e.id = py.empresa_id
  where a.id = p_acta_id;
  if not found or v.estado <> 'pendiente' then
    return;
  end if;

  select g.id into v_pago from pagos g where g.acta_id = p_acta_id and g.estado = 'solicitado'
   order by g.creado_en desc limit 1;
  v_valor := round(v.neto, 0);

  if v_valor <= 0 then
    if v_pago is not null then
      update pagos set estado = 'anulado', anulado_en = now(),
                       motivo_anulacion = 'El neto del acta quedó en cero o negativo.'
       where id = v_pago;
    end if;
    perform public._aprobar_acta(p_acta_id, auth.uid(), null);
    return;
  end if;

  if not exists (select 1 from acta_soportes s where s.acta_id = p_acta_id and s.tipo in ('factura', 'cuenta_cobro')) then
    raise exception 'Adjunta el soporte de pago (factura o cuenta de cobro del contratista): el acta con pago lo exige.';
  end if;

  -- Tercero = documento del contratista; la cuenta se elige sola si tiene UNA verificada.
  select t.id into v_tercero from terceros t where t.numero_documento = v.numero_documento limit 1;
  if v_tercero is not null then
    select tc.id into v_cuenta from terceros_cuentas tc
     where tc.tercero_id = v_tercero and tc.estado = 'ACTIVO'
       and (select count(*) from terceros_cuentas x where x.tercero_id = v_tercero and x.estado = 'ACTIVO') = 1;
  end if;
  v_concepto := upper(case v.tipo when 'final' then 'Acta final' when 'liquidacion' then 'Acta de liquidación' else 'Acta' end)
                || ' N° ' || v.numero || ' - CONTRATO ' || v.numero_contrato || ' - ' || upper(v.contratista_nombre);

  if v_pago is not null then
    update pagos set valor = v_valor, concepto = v_concepto, solicitado_en = now(),
                     tercero_id = coalesce(tercero_id, v_tercero),
                     cuenta_tercero_id = coalesce(cuenta_tercero_id, v_cuenta)
     where id = v_pago;
  else
    insert into pagos (fuente, acta_id, tipo, proyecto_id, empresa_id, consolidado_id, tercero_id,
                       cuenta_tercero_id, concepto, valor, estado, solicitado_en)
    values ('acta', p_acta_id, 'unico', v.proyecto_id, v.empresa_id, v.consolidado_id, v_tercero, v_cuenta,
            v_concepto, v_valor, 'solicitado', now())
    returning id into v_pago;
  end if;
  perform public._pago_actualizar_novedad(v_pago);
end;
$function$;

-- =============================================================== 3. Entradas
create table if not exists public.entrada_soportes (
  id uuid primary key default gen_random_uuid(),
  entrada_id uuid not null references public.entradas_almacen(id) on delete cascade,
  tipo text not null default 'remision' check (tipo in ('remision')),
  ruta text not null unique,
  nombre_archivo text not null,
  tamano bigint,
  mime text,
  subido_por uuid references public.perfiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_entrada_soportes_entrada on public.entrada_soportes (entrada_id);
create index if not exists idx_entrada_soportes_subido_por on public.entrada_soportes (subido_por);

alter table public.entrada_soportes enable row level security;
revoke all on public.entrada_soportes from anon;
revoke insert, update, delete on public.entrada_soportes from authenticated;
grant select on public.entrada_soportes to authenticated;

-- Ve la remisión quien ve la entrada (RLS de entradas_almacen).
drop policy if exists entrada_soportes_select on public.entrada_soportes;
create policy entrada_soportes_select on public.entrada_soportes for select to authenticated
  using (exists (select 1 from public.entradas_almacen e where e.id = entrada_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('entradas', 'entradas', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists entradas_archivos_select on storage.objects;
create policy entradas_archivos_select on storage.objects for select to authenticated
  using (bucket_id = 'entradas' and exists (select 1 from public.entrada_soportes s where s.ruta = name));

drop policy if exists entradas_archivos_insert on storage.objects;
create policy entradas_archivos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'entradas' and (select public.tiene_accion((select auth.uid()), 'gestionar_almacen')));

drop policy if exists entradas_archivos_delete on storage.objects;
create policy entradas_archivos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'entradas'
         and (select public.tiene_accion((select auth.uid()), 'gestionar_almacen'))
         and not exists (select 1 from public.entrada_soportes s where s.ruta = name));

-- Pone (o cambia) la remisión de una entrada. Devuelve las rutas que dejó de
-- usar, para borrarlas del bucket. Misma regla que registrar o editar la
-- entrada: Gestionar bodega y el proyecto de la orden.
create or replace function public.guardar_remision_entrada(p_entrada_id uuid, p_soporte jsonb)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_proyecto uuid;
  v_ruta text := nullif(trim(coalesce(p_soporte->>'ruta', '')), '');
  v_viejas text[];
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_almacen') then
    raise exception 'No tienes permiso para registrar entradas.';
  end if;
  select o.proyecto_id into v_proyecto
    from entradas_almacen e join ordenes_compra o on o.id = e.orden_compra_id
   where e.id = p_entrada_id and e.anulada_at is null;
  if not found then
    raise exception 'La entrada no existe o está anulada.';
  end if;
  perform public._exigir_proyecto_almacen(v_proyecto);
  if v_ruta is null then
    raise exception 'Adjunta el archivo de la remisión.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'entradas' and o.name = v_ruta) then
    raise exception 'No se encontró el archivo de la remisión. Vuelve a adjuntarlo.';
  end if;

  select coalesce(array_agg(s.ruta), '{}') into v_viejas from entrada_soportes s where s.entrada_id = p_entrada_id;
  delete from entrada_soportes s where s.entrada_id = p_entrada_id;
  insert into entrada_soportes (entrada_id, tipo, ruta, nombre_archivo, tamano, mime, subido_por)
  values (p_entrada_id, 'remision', v_ruta, coalesce(nullif(trim(p_soporte->>'nombre_archivo'), ''), 'remision'),
          nullif(p_soporte->>'tamano', '')::bigint, p_soporte->>'mime', auth.uid());
  return array(select x from unnest(v_viejas) x where x <> v_ruta);
end;
$function$;

revoke all on function public.guardar_remision_entrada(uuid, jsonb) from public, anon;
grant execute on function public.guardar_remision_entrada(uuid, jsonb) to authenticated;
