-- Actas sobre el contrato (2026-10-14). Requiere 20261110*_actas y
-- 20261111000000_aprobacion_minutas.sql (minuta aprobada por Subgerencia).
--
-- 1. El acta cobra lo PACTADO, no el APU:
--    - Contrato a valores unitarios: las líneas son las actividades del anexo
--      del contrato (contrato_anexo_items) con su valor unitario pactado; cada
--      actividad tiene tope = cantidad contratada (acumulado de las actas no
--      rechazadas + esta acta <= contratada).
--    - Contrato a valor global: el acta cobra un % de avance (acumulado <= 100 %).
--    El valor bruto de todas las actas sigue sin poder pasar del valor del contrato.
-- 2. Descuentos: amortización del anticipo (% del anticipo del contrato, hasta
--    devolverlo completo; el acta final amortiza lo que falte), retención en
--    garantía (% de la solicitud de obra) y otros descuentos escritos a mano
--    (retefuente, ICA...). Neto a pagar = bruto - amortización - retención - otros.
-- 3. Datos del acta: tipo (parcial / final / liquidación), período, observaciones
--    y soportes (bucket privado `actas`).
-- 4. Acta final: después de una final (por aprobar o aprobada) no hay más actas
--    de avance. Acta de liquidación: sin actividades; devuelve la retención y
--    descuenta el anticipo que falte por amortizar; al aprobarla el contrato
--    queda liquidado (contratos.liquidado_at) y no recibe más actas.
-- 5. Contrato vencido (fecha fin < hoy en Colombia): no recibe actas de avance
--    (solo la de liquidación; para ampliar el plazo hará falta el otrosí).
--    Aviso diario (pg_cron) a quien lo pidió y a Jurídica (Legal / Líder Legal)
--    cuando vence sin liquidar, una sola vez.
-- 6. Al aprobar un acta con neto > 0 se crea su pago en A&F (pagos.fuente =
--    'acta'), igual que una orden de compra: aprobado, con ITEM de la semana.
-- 7. Historial del acta (historial_eventos, entidad 'acta').
-- Se puede correr más de una vez.

-- ---------------------------------------------------------------- columnas
alter table public.contratos add column if not exists liquidado_at timestamptz;
alter table public.contratos add column if not exists aviso_vencido_at timestamptz;

alter table public.actas add column if not exists tipo text not null default 'parcial';
alter table public.actas drop constraint if exists actas_tipo_check;
alter table public.actas add constraint actas_tipo_check check (tipo in ('parcial', 'final', 'liquidacion'));
alter table public.actas add column if not exists periodo_desde date;
alter table public.actas add column if not exists periodo_hasta date;
alter table public.actas add column if not exists observaciones text;
alter table public.actas add column if not exists porcentaje_avance numeric(9, 4);
alter table public.actas add column if not exists valor_bruto numeric(18, 2) not null default 0;
alter table public.actas add column if not exists amortizacion numeric(18, 2) not null default 0;
alter table public.actas add column if not exists retencion numeric(18, 2) not null default 0;
alter table public.actas add column if not exists devolucion_retencion numeric(18, 2) not null default 0;
alter table public.actas add column if not exists otros_descuentos numeric(18, 2) not null default 0;
alter table public.actas add column if not exists neto numeric(18, 2) not null default 0;
alter table public.actas add column if not exists anticipo_porcentaje numeric(7, 4);
alter table public.actas add column if not exists retencion_porcentaje numeric(7, 4);

-- Actas del formato anterior (líneas de APU): su total era el bruto y el neto.
update public.actas set valor_bruto = total, neto = total
 where valor_bruto = 0 and neto = 0 and total <> 0;

-- Actividades del anexo cobradas en el acta (solo las que tienen cantidad).
create table if not exists public.acta_actividades (
  id uuid primary key default gen_random_uuid(),
  acta_id uuid not null references public.actas(id) on delete cascade,
  contrato_anexo_item_id uuid references public.contrato_anexo_items(id) on delete set null,
  orden integer not null,
  actividad text not null,
  unidad text not null,
  cantidad numeric not null check (cantidad > 0),
  valor_unitario numeric(18, 2) not null,
  valor numeric(18, 2) not null
);
create index if not exists idx_acta_actividades_acta on public.acta_actividades (acta_id);
create index if not exists idx_acta_actividades_item on public.acta_actividades (contrato_anexo_item_id);

create table if not exists public.acta_descuentos (
  id uuid primary key default gen_random_uuid(),
  acta_id uuid not null references public.actas(id) on delete cascade,
  orden integer not null,
  concepto text not null check (length(trim(concepto)) > 0),
  valor numeric(18, 2) not null check (valor > 0)
);
create index if not exists idx_acta_descuentos_acta on public.acta_descuentos (acta_id);

create table if not exists public.acta_soportes (
  id uuid primary key default gen_random_uuid(),
  acta_id uuid not null references public.actas(id) on delete cascade,
  tipo text not null check (tipo in ('factura', 'memoria', 'foto', 'otro')),
  ruta text not null unique,
  nombre_archivo text not null,
  tamano bigint,
  mime text,
  subido_por uuid references public.perfiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_acta_soportes_acta on public.acta_soportes (acta_id);
create index if not exists idx_acta_soportes_subido_por on public.acta_soportes (subido_por);

alter table public.acta_actividades enable row level security;
alter table public.acta_descuentos enable row level security;
alter table public.acta_soportes enable row level security;

drop policy if exists acta_actividades_select on public.acta_actividades;
create policy acta_actividades_select on public.acta_actividades for select to authenticated
  using (exists (select 1 from public.actas a where a.id = acta_id));
drop policy if exists acta_descuentos_select on public.acta_descuentos;
create policy acta_descuentos_select on public.acta_descuentos for select to authenticated
  using (exists (select 1 from public.actas a where a.id = acta_id));
drop policy if exists acta_soportes_select on public.acta_soportes;
create policy acta_soportes_select on public.acta_soportes for select to authenticated
  using (exists (select 1 from public.actas a where a.id = acta_id));

-- ---------------------------------------------------------------- soportes en Storage
-- Ruta: <acta_id>/<tipo>-<n>.<ext>. El navegador genera el id del acta, sube
-- los archivos y después crea o edita el acta con ese id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('actas', 'actas', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists actas_archivos_select on storage.objects;
create policy actas_archivos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'actas'
    and exists (
      select 1 from public.actas a join public.contratos c on c.id = a.contrato_id
      where a.id::text = (storage.foldername(name))[1] and public.puede_ver_actas(c.proyecto_id)
    )
  );
drop policy if exists actas_archivos_insert on storage.objects;
create policy actas_archivos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'actas' and (select public.tiene_accion(auth.uid(), 'elaborar_actas')));
-- Borrar: solo archivos que todavía no son soporte de ningún acta (limpieza
-- cuando falla el guardado después de subir).
drop policy if exists actas_archivos_delete on storage.objects;
create policy actas_archivos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'actas'
    and (select public.tiene_accion(auth.uid(), 'elaborar_actas'))
    and not exists (select 1 from public.acta_soportes s where s.ruta = name)
  );

-- ---------------------------------------------------------------- pagos desde actas
alter table public.pagos add column if not exists acta_id uuid references public.actas(id);
create index if not exists idx_pagos_acta on public.pagos (acta_id);
alter table public.pagos drop constraint if exists pagos_fuente_check;
alter table public.pagos add constraint pagos_fuente_check check (fuente in ('orden_compra', 'acta'));
alter table public.pagos drop constraint if exists pagos_fuente_coherente;
alter table public.pagos add constraint pagos_fuente_coherente check (
  ((fuente = 'orden_compra') = (orden_compra_id is not null))
  and ((fuente = 'acta') = (acta_id is not null))
);

-- ---------------------------------------------------------------- historial y avisos
alter table public.historial_eventos drop constraint if exists historial_eventos_entidad_tipo_check;
alter table public.historial_eventos add constraint historial_eventos_entidad_tipo_check
  check (entidad_tipo in ('orden_compra', 'pedido', 'requisicion', 'contrato', 'acta'));

alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check
  check (tipo = any (array['pedido_rechazado', 'pedido_aprobado', 'orden_compra_rechazada', 'orden_compra_aprobada',
                           'insumo_sobre_presupuesto', 'orden_compra_precio_sobre_efectivo', 'contrato_por_revisar',
                           'contrato_aprobado', 'contrato_devuelto', 'contrato_rechazado',
                           'acta_aprobada', 'acta_rechazada',
                           'minuta_por_revisar', 'minuta_aprobada', 'minuta_devuelta',
                           'contrato_vencido', 'contrato_vencido_juridica'])) not valid;

-- historial_entidad: igual que antes + las actas (quien ve actas del proyecto).
create or replace function public.historial_entidad(p_tipo text, p_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_ok boolean;
begin
  if p_tipo = 'orden_compra' then
    select (public.rol_compras(auth.uid()) or public.usuario_puede_ver_proyecto(auth.uid(), o.proyecto_id))
      into v_ok from public.ordenes_compra o where o.id = p_id;
  elsif p_tipo = 'pedido' then
    select (public.usuario_tiene_acceso_a_item(p.presupuesto_item_id) or public.rol_compras(auth.uid()))
      into v_ok from public.pedidos_insumos p where p.id = p_id;
  elsif p_tipo = 'requisicion' then
    select exists (
      select 1 from public.pedidos_insumos p
      where p.grupo_pedido_id = p_id
        and (public.usuario_tiene_acceso_a_item(p.presupuesto_item_id)
             or public.rol_compras(auth.uid())
             or public.tiene_accion(auth.uid(), 'aprobar_pedidos'))
    ) into v_ok;
  elsif p_tipo = 'contrato' then
    select (
      public.tiene_pestana(auth.uid(), 'contratos.solicitar')
      or public.tiene_pestana(auth.uid(), 'contratos.preaprobacion')
      or public.tiene_pestana(auth.uid(), 'contratos.contratos')
      or public.tiene_pestana(auth.uid(), 'contratos.aprobar_minutas')
    ) and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
      into v_ok from public.contratos c where c.id = p_id;
  elsif p_tipo = 'acta' then
    select public.puede_ver_actas(c.proyecto_id)
      into v_ok from public.actas a join public.contratos c on c.id = a.contrato_id where a.id = p_id;
  else
    raise exception 'Tipo de historial desconocido.';
  end if;

  if not coalesce(v_ok, false) then
    raise exception 'No tienes permiso para ver este historial.';
  end if;

  if p_tipo = 'requisicion' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre,
               'motivo', h.motivo,
               'datos', case when h.entidad_tipo = 'pedido'
                             then coalesce(h.datos, '{}'::jsonb) || jsonb_build_object('insumo', mi.descripcion)
                             else h.datos end,
               'created_at', h.created_at
             ) order by h.created_at, h.id)
        from public.historial_eventos h
        left join public.perfiles pf on pf.id = h.usuario_id
        left join public.pedidos_insumos pe on h.entidad_tipo = 'pedido' and pe.id = h.entidad_id
        left join public.maestro_insumos mi on mi.id = pe.insumo_id
       where (h.entidad_tipo = 'requisicion' and h.entidad_id = p_id)
          or (h.entidad_tipo = 'pedido' and h.evento = 'rechazado_por_compras'
              and pe.grupo_pedido_id = p_id)
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre,
             'motivo', h.motivo, 'datos', h.datos, 'created_at', h.created_at
           ) order by h.created_at, h.id)
      from public.historial_eventos h
      left join public.perfiles pf on pf.id = h.usuario_id
     where h.entidad_tipo = p_tipo and h.entidad_id = p_id
  ), '[]'::jsonb);
end;
$function$;

-- ---------------------------------------------------------------- reglas del contrato
-- Fecha fin: la de la solicitud (por fechas) o inicio + duración. Sin inicio
-- (duración sin fecha estimada) no vence.
create or replace function public._fecha_fin_contrato(p_contrato_id uuid)
 returns date
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when c.plazo_tipo = 'fechas' then c.fecha_fin
    when c.plazo_tipo = 'duracion' and c.fecha_inicio is not null and c.duracion_cantidad is not null then
      (c.fecha_inicio + case when c.duracion_unidad = 'meses'
                             then make_interval(months => c.duracion_cantidad)
                             else make_interval(days => c.duracion_cantidad) end)::date
  end
  from contratos c where c.id = p_contrato_id
$function$;
revoke all on function public._fecha_fin_contrato(uuid) from public, anon, authenticated;

-- % de retención en garantía del contrato (hoy solo lo pide la solicitud de obra).
create or replace function public._retencion_porcentaje_contrato(p_contrato_id uuid)
 returns numeric
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case when coalesce((c.datos_tipo->>'retencion_garantia')::boolean, false)
              then nullif(c.datos_tipo->>'retencion_porcentaje', '')::numeric end
  from contratos c where c.id = p_contrato_id
$function$;
revoke all on function public._retencion_porcentaje_contrato(uuid) from public, anon, authenticated;

-- Todo lo que la pantalla necesita para hacer (o editar) un acta: el contrato,
-- sus actividades con lo ya cobrado y los acumulados de anticipo y retención.
-- p_excluir_acta: el acta que se está editando (no cuenta contra sí misma).
create or replace function public.contrato_para_acta(p_contrato_id uuid, p_excluir_acta uuid default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v record;
  v_fin date;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_ret numeric;
begin
  select c.* into v from contratos c where c.id = p_contrato_id;
  if not found or not public.puede_ver_actas(v.proyecto_id) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  v_fin := public._fecha_fin_contrato(p_contrato_id);
  v_ret := public._retencion_porcentaje_contrato(p_contrato_id);

  return jsonb_build_object(
    'valor', v.valor,
    'anexo_tipo', v.anexo_tipo,
    'anticipo_porcentaje', case when v.tiene_anticipo then v.anticipo_porcentaje end,
    'retencion_porcentaje', v_ret,
    'fecha_fin', v_fin,
    'vencido', v_fin is not null and v_fin < v_hoy,
    'liquidado', v.liquidado_at is not null,
    'listo_para_actas', v.estado = 'aprobada' and v.minuta_estado = 'aprobada',
    -- Ya hay un acta final (por aprobar o aprobada) distinta de la que se edita.
    'tiene_final', exists (select 1 from actas a where a.contrato_id = v.id and a.tipo = 'final'
                             and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    'tiene_liquidacion', exists (select 1 from actas a where a.contrato_id = v.id and a.tipo = 'liquidacion'
                                   and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    'actas_por_aprobar', (select count(*) from actas a where a.contrato_id = v.id and a.estado = 'pendiente'
                            and a.tipo <> 'liquidacion' and a.id is distinct from p_excluir_acta),
    'bruto_otras', (select coalesce(sum(a.valor_bruto), 0) from actas a where a.contrato_id = v.id
                      and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    'avance_otras', (select coalesce(sum(a.porcentaje_avance), 0) from actas a where a.contrato_id = v.id
                       and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    'amortizado_otras', (select coalesce(sum(a.amortizacion), 0) from actas a where a.contrato_id = v.id
                           and a.tipo <> 'liquidacion' and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    -- Para la liquidación: solo lo APROBADO.
    'amortizado_aprobado', (select coalesce(sum(a.amortizacion), 0) from actas a where a.contrato_id = v.id
                              and a.tipo <> 'liquidacion' and a.estado = 'aprobada'),
    'retenido_aprobado', (select coalesce(sum(a.retencion), 0) from actas a where a.contrato_id = v.id
                            and a.tipo <> 'liquidacion' and a.estado = 'aprobada'),
    'actividades', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'orden', i.orden, 'actividad', i.actividad, 'unidad', i.unidad,
               'cantidad', i.cantidad, 'valor_unitario', i.valor_unitario,
               'acumulado', coalesce((
                 select sum(x.cantidad) from acta_actividades x join actas a on a.id = x.acta_id
                 where x.contrato_anexo_item_id = i.id and a.estado <> 'rechazada'
                   and a.id is distinct from p_excluir_acta), 0)
             ) order by i.orden, i.id)
      from contrato_anexo_items i where i.contrato_id = v.id), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.contrato_para_acta(uuid, uuid) from public, anon;
grant execute on function public.contrato_para_acta(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- guardar (común a crear y editar)
-- p_datos: { tipo, periodo_desde, periodo_hasta, observaciones,
--   actividades: [{ anexo_item_id, cantidad }], porcentaje_avance,
--   descuentos: [{ concepto, valor }] }
-- El acta ya existe (sin hijos). El contrato ya está bloqueado por el llamador.
create or replace function public._guardar_acta(p_acta_id uuid, p_contrato_id uuid, p_datos jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c record;
  v_info jsonb;
  v_tipo text := coalesce(p_datos->>'tipo', 'parcial');
  v_desde date;
  v_hasta date;
  v_bruto numeric := 0;
  v_avance numeric;
  v_amort numeric := 0;
  v_ret numeric := 0;
  v_dev numeric := 0;
  v_otros numeric := 0;
  v_anticipo_pct numeric;
  v_ret_pct numeric;
  v_anticipo_total numeric := 0;
  v_orden integer := 0;
  v_item record;
  v_cant numeric;
  v_valor numeric;
  d jsonb;
begin
  select * into c from contratos where id = p_contrato_id;
  v_info := public.contrato_para_acta(p_contrato_id, p_acta_id);

  if v_tipo not in ('parcial', 'final', 'liquidacion') then
    raise exception 'Tipo de acta no válido.';
  end if;
  if not (v_info->>'listo_para_actas')::boolean then
    raise exception 'Solo se hacen actas de contratos con la minuta aprobada por Subgerencia.';
  end if;
  if (v_info->>'liquidado')::boolean then
    raise exception 'El contrato ya está liquidado: no recibe más actas.';
  end if;

  begin
    v_desde := nullif(p_datos->>'periodo_desde', '')::date;
    v_hasta := nullif(p_datos->>'periodo_hasta', '')::date;
  exception when others then
    raise exception 'Las fechas del período no son válidas.';
  end;
  if v_desde is not null and v_hasta is not null and v_hasta < v_desde then
    raise exception 'El período termina antes de empezar.';
  end if;

  v_anticipo_pct := nullif(v_info->>'anticipo_porcentaje', '')::numeric;
  v_ret_pct := nullif(v_info->>'retencion_porcentaje', '')::numeric;
  if v_anticipo_pct is not null then
    v_anticipo_total := round(c.valor * v_anticipo_pct / 100, 2);
  end if;

  if v_tipo = 'liquidacion' then
    if (v_info->>'tiene_liquidacion')::boolean then
      raise exception 'Este contrato ya tiene un acta de liquidación.';
    end if;
    if (v_info->>'actas_por_aprobar')::int > 0 then
      raise exception 'Hay actas por aprobar: apruébalas o recházalas antes de liquidar.';
    end if;
    -- Devuelve la retención y descuenta el anticipo que falte por amortizar.
    v_dev := (v_info->>'retenido_aprobado')::numeric;
    v_amort := greatest(v_anticipo_total - (v_info->>'amortizado_aprobado')::numeric, 0);
  else
    if (v_info->>'vencido')::boolean then
      raise exception 'El contrato venció el %: no recibe actas de avance (solo la de liquidación).',
        to_char((v_info->>'fecha_fin')::date, 'DD/MM/YYYY');
    end if;
    if (v_info->>'tiene_final')::boolean then
      raise exception 'El contrato ya tiene acta final: no recibe más actas de avance (sigue la de liquidación).';
    end if;

    if c.anexo_tipo = 'valores_unitarios' then
      if jsonb_typeof(coalesce(p_datos->'actividades', 'null')) is distinct from 'array' then
        raise exception 'Escribe la cantidad ejecutada de al menos una actividad.';
      end if;
      if (select count(distinct e->>'anexo_item_id') from jsonb_array_elements(p_datos->'actividades') e)
         <> jsonb_array_length(p_datos->'actividades') then
        raise exception 'Hay una actividad repetida.';
      end if;
      for d in select * from jsonb_array_elements(p_datos->'actividades') loop
        begin
          v_cant := (d->>'cantidad')::numeric;
        exception when others then
          raise exception 'Una cantidad no es un número.';
        end;
        continue when v_cant is null or v_cant = 0;
        if v_cant < 0 then
          raise exception 'Las cantidades no pueden ser negativas.';
        end if;
        select i.id, i.orden, i.actividad, i.unidad, i.cantidad, i.valor_unitario into v_item
          from contrato_anexo_items i
         where i.id = (d->>'anexo_item_id')::uuid and i.contrato_id = p_contrato_id;
        if not found then
          raise exception 'Una actividad no es de este contrato.';
        end if;
        -- Acumulado de la actividad en las demás actas no rechazadas (índice por actividad).
        if (select coalesce(sum(x.cantidad), 0) from acta_actividades x join actas o on o.id = x.acta_id
             where x.contrato_anexo_item_id = v_item.id and o.estado <> 'rechazada' and o.id <> p_acta_id)
           + v_cant > v_item.cantidad then
          raise exception 'La actividad "%" pasa de la cantidad contratada (% %).',
            v_item.actividad, trim(to_char(v_item.cantidad, 'FM999999999990.####')), v_item.unidad;
        end if;
        v_orden := v_orden + 1;
        v_valor := round(v_cant * v_item.valor_unitario, 2);
        v_bruto := v_bruto + v_valor;
        insert into acta_actividades (acta_id, contrato_anexo_item_id, orden, actividad, unidad, cantidad, valor_unitario, valor)
        values (p_acta_id, v_item.id, v_item.orden, v_item.actividad, v_item.unidad, v_cant, v_item.valor_unitario, v_valor);
      end loop;
      if v_orden = 0 then
        raise exception 'Escribe la cantidad ejecutada de al menos una actividad.';
      end if;
    else
      -- Valor global: % de avance de esta acta.
      begin
        v_avance := (p_datos->>'porcentaje_avance')::numeric;
      exception when others then
        raise exception 'El porcentaje de avance no es un número.';
      end;
      if v_avance is null or v_avance <= 0 then
        raise exception 'Escribe el porcentaje de avance de esta acta.';
      end if;
      if (v_info->>'avance_otras')::numeric + v_avance > 100 then
        raise exception 'El avance acumulado pasaría del 100 %% (ya va en % %%).',
          trim(to_char((v_info->>'avance_otras')::numeric, 'FM990.##'));
      end if;
      v_bruto := round(c.valor * v_avance / 100, 2);
    end if;

    if v_bruto > c.valor - (v_info->>'bruto_otras')::numeric then
      raise exception 'El acta suma % y el saldo del contrato es %. Las actas no pueden superar el valor del contrato.',
        public._pesos_texto(v_bruto), public._pesos_texto(greatest(c.valor - (v_info->>'bruto_otras')::numeric, 0));
    end if;

    -- Amortización: % del anticipo sobre el bruto, sin pasar de lo que falte;
    -- la final amortiza todo lo que falte (sin pasar del bruto).
    if v_anticipo_total > 0 then
      v_amort := least(
        case when v_tipo = 'final' then v_anticipo_total else round(v_bruto * v_anticipo_pct / 100, 2) end,
        greatest(v_anticipo_total - (v_info->>'amortizado_otras')::numeric, 0),
        v_bruto);
    end if;
    if v_ret_pct is not null then
      v_ret := round(v_bruto * v_ret_pct / 100, 2);
    end if;
  end if;

  -- Otros descuentos (retefuente, ICA...).
  v_orden := 0;
  if jsonb_typeof(coalesce(p_datos->'descuentos', '[]')) = 'array' then
    for d in select * from jsonb_array_elements(coalesce(p_datos->'descuentos', '[]')) loop
      continue when nullif(trim(coalesce(d->>'concepto', '')), '') is null and coalesce((d->>'valor')::numeric, 0) = 0;
      if nullif(trim(coalesce(d->>'concepto', '')), '') is null then
        raise exception 'Escribe el concepto de cada descuento.';
      end if;
      begin
        v_valor := round((d->>'valor')::numeric, 2);
      exception when others then
        raise exception 'El valor del descuento "%" no es un número.', d->>'concepto';
      end;
      if v_valor is null or v_valor <= 0 then
        raise exception 'El descuento "%" debe ser mayor que cero.', d->>'concepto';
      end if;
      v_orden := v_orden + 1;
      v_otros := v_otros + v_valor;
      insert into acta_descuentos (acta_id, orden, concepto, valor) values (p_acta_id, v_orden, trim(d->>'concepto'), v_valor);
    end loop;
  end if;

  if v_tipo <> 'liquidacion' and v_bruto - v_amort - v_ret - v_otros < 0 then
    raise exception 'Los descuentos (%) pasan del valor del acta (%).',
      public._pesos_texto(v_amort + v_ret + v_otros), public._pesos_texto(v_bruto);
  end if;

  update actas set
    tipo = v_tipo,
    periodo_desde = v_desde,
    periodo_hasta = v_hasta,
    observaciones = nullif(trim(coalesce(p_datos->>'observaciones', '')), ''),
    porcentaje_avance = case when v_tipo <> 'liquidacion' and c.anexo_tipo <> 'valores_unitarios' then v_avance end,
    valor_bruto = v_bruto,
    total = v_bruto,
    amortizacion = v_amort,
    retencion = v_ret,
    devolucion_retencion = v_dev,
    otros_descuentos = v_otros,
    neto = v_bruto + v_dev - v_amort - v_ret - v_otros,
    anticipo_porcentaje = v_anticipo_pct,
    retencion_porcentaje = v_ret_pct
  where id = p_acta_id;
end;
$function$;
revoke all on function public._guardar_acta(uuid, uuid, jsonb) from public, anon, authenticated;

-- Soportes nuevos: [{ tipo, ruta, nombre_archivo, tamano, mime }].
create or replace function public._agregar_soportes_acta(p_acta_id uuid, p_soportes jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  d jsonb;
begin
  if jsonb_typeof(coalesce(p_soportes, '[]')) is distinct from 'array' then
    raise exception 'Los soportes no son válidos.';
  end if;
  for d in select * from jsonb_array_elements(coalesce(p_soportes, '[]')) loop
    if left(d->>'ruta', 37) is distinct from p_acta_id::text || '/' then
      raise exception 'La ruta de un soporte no corresponde a esta acta.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'actas' and o.name = d->>'ruta') then
      raise exception 'No se encontró el archivo "%". Vuelve a adjuntarlo.', d->>'nombre_archivo';
    end if;
    insert into acta_soportes (acta_id, tipo, ruta, nombre_archivo, tamano, mime, subido_por)
    values (p_acta_id, coalesce(d->>'tipo', 'otro'), d->>'ruta', d->>'nombre_archivo',
            nullif(d->>'tamano', '')::bigint, d->>'mime', auth.uid());
  end loop;
end;
$function$;
revoke all on function public._agregar_soportes_acta(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- crear / editar
drop function if exists public.crear_acta(uuid, jsonb);
create or replace function public.crear_acta(p_acta_id uuid, p_contrato_id uuid, p_datos jsonb, p_soportes jsonb default '[]')
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_contrato record;
  v_numero integer;
begin
  if not public.tiene_accion(auth.uid(), 'elaborar_actas') then
    raise exception 'No tienes permiso para elaborar actas.';
  end if;
  -- Bloquea el contrato: dos actas a la vez no sacan el mismo número ni se
  -- pasan juntas de los topes.
  select c.id, c.proyecto_id into v_contrato from contratos c where c.id = p_contrato_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v_contrato.proyecto_id) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;

  select coalesce(max(a.numero), 0) + 1 into v_numero from actas a where a.contrato_id = p_contrato_id;
  insert into actas (id, contrato_id, numero, total, creado_por)
  values (coalesce(p_acta_id, gen_random_uuid()), p_contrato_id, v_numero, 0, auth.uid())
  returning id into p_acta_id;

  perform public._guardar_acta(p_acta_id, p_contrato_id, p_datos);
  perform public._agregar_soportes_acta(p_acta_id, p_soportes);

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  select 'acta', a.id, 'creada', auth.uid(), jsonb_build_object('tipo', a.tipo, 'neto', a.neto, 'valor_bruto', a.valor_bruto)
    from actas a where a.id = p_acta_id;
  return jsonb_build_object('id', p_acta_id, 'numero', v_numero);
end;
$function$;
revoke all on function public.crear_acta(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.crear_acta(uuid, uuid, jsonb, jsonb) to authenticated;

-- Solo quien la creó, y si no está aprobada. Vuelve a "por aprobar" con el
-- mismo número. Devuelve las rutas de los soportes quitados (el navegador las borra).
drop function if exists public.editar_acta(uuid, jsonb);
create or replace function public.editar_acta(p_acta_id uuid, p_datos jsonb, p_soportes_nuevos jsonb default '[]',
                                              p_soportes_quitar uuid[] default '{}')
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_contrato_id uuid;
  v_contrato record;
  v_acta record;
  v_quitadas text[];
begin
  if not public.tiene_accion(auth.uid(), 'elaborar_actas') then
    raise exception 'No tienes permiso para elaborar actas.';
  end if;
  -- Mismo orden de bloqueo que crear_acta: primero el contrato, luego el acta.
  select a.contrato_id into v_contrato_id from actas a where a.id = p_acta_id;
  if v_contrato_id is null then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;
  select c.id, c.proyecto_id into v_contrato from contratos c where c.id = v_contrato_id for update;
  if not public.usuario_puede_ver_proyecto(auth.uid(), v_contrato.proyecto_id) then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;
  select a.id, a.numero, a.estado, a.creado_por into v_acta from actas a where a.id = p_acta_id for update;
  if v_acta.creado_por is distinct from auth.uid() then
    raise exception 'Solo quien hizo el acta % puede editarla.', v_acta.numero;
  end if;
  if v_acta.estado = 'aprobada' then
    raise exception 'El acta % ya está aprobada y no se puede editar (actualiza la página).', v_acta.numero;
  end if;

  delete from acta_actividades where acta_id = p_acta_id;
  delete from acta_descuentos where acta_id = p_acta_id;
  delete from acta_lineas where acta_id = p_acta_id;
  perform public._guardar_acta(p_acta_id, v_contrato_id, p_datos);

  with q as (
    delete from acta_soportes s where s.acta_id = p_acta_id and s.id = any (coalesce(p_soportes_quitar, '{}'))
    returning s.ruta
  )
  select coalesce(array_agg(ruta), '{}') into v_quitadas from q;
  perform public._agregar_soportes_acta(p_acta_id, p_soportes_nuevos);

  update actas
     set estado = 'pendiente', resuelto_por = null, resuelto_at = null, motivo_resolucion = null,
         editada_at = now(), editada_por = auth.uid()
   where id = p_acta_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  select 'acta', a.id, case when v_acta.estado = 'rechazada' then 'reenviada' else 'editada' end, auth.uid(),
         jsonb_build_object('neto', a.neto, 'valor_bruto', a.valor_bruto)
    from actas a where a.id = p_acta_id;
  return jsonb_build_object('id', p_acta_id, 'numero', v_acta.numero, 'rutas_quitadas', to_jsonb(v_quitadas));
end;
$function$;
revoke all on function public.editar_acta(uuid, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.editar_acta(uuid, jsonb, jsonb, uuid[]) to authenticated;

-- ---------------------------------------------------------------- aprobar / rechazar
-- Aprobar con neto > 0 crea el pago en A&F (aprobado, con su ITEM); aprobar la
-- liquidación deja el contrato liquidado. Aviso a quien la creó, e historial.
create or replace function public.resolver_acta(p_acta_id uuid, p_accion text, p_motivo text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v record;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_tercero uuid;
  v_cuenta uuid;
  v_pago uuid;
  v_nombre_tipo text;
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_actas') then
    raise exception 'No tienes permiso para aprobar actas.';
  end if;
  select a.id, a.numero, a.estado, a.tipo, a.neto, a.creado_por, a.contrato_id,
         c.proyecto_id, coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero) as numero_contrato,
         k.numero_documento, k.nombre as contratista_nombre, py.empresa_id, e.consolidado_id
    into v
  from actas a
  join contratos c on c.id = a.contrato_id
  join contratistas k on k.id = c.contratista_id
  left join proyectos py on py.id = c.proyecto_id
  left join empresas e on e.id = py.empresa_id
  where a.id = p_acta_id
  for update of a;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v.proyecto_id) then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;
  if v.estado <> 'pendiente' then
    raise exception 'Esta acta ya no está por aprobar (actualiza la página).';
  end if;
  if p_accion not in ('aprobar', 'rechazar') then
    raise exception 'Acción no válida.';
  end if;
  if p_accion = 'rechazar' and v_motivo is null then
    raise exception 'Escribe el motivo.';
  end if;

  update actas
     set estado = case when p_accion = 'aprobar' then 'aprobada' else 'rechazada' end,
         resuelto_por = auth.uid(), resuelto_at = now(),
         motivo_resolucion = case when p_accion = 'rechazar' then v_motivo end
   where id = p_acta_id;

  v_nombre_tipo := case v.tipo when 'final' then 'Acta final' when 'liquidacion' then 'Acta de liquidación' else 'Acta' end;

  if p_accion = 'aprobar' then
    if v.tipo = 'liquidacion' then
      update contratos set liquidado_at = now() where id = v.contrato_id;
    end if;
    -- Un pago en pesos enteros mayor que cero (pagos.valor > 0).
    if round(v.neto, 0) > 0 then
      -- Tercero = documento del contratista; la cuenta se elige sola si tiene UNA verificada.
      select t.id into v_tercero from terceros t where t.numero_documento = v.numero_documento limit 1;
      if v_tercero is not null then
        select tc.id into v_cuenta from terceros_cuentas tc
         where tc.tercero_id = v_tercero and tc.estado = 'ACTIVO'
           and (select count(*) from terceros_cuentas x where x.tercero_id = v_tercero and x.estado = 'ACTIVO') = 1;
      end if;
      insert into pagos (fuente, acta_id, tipo, proyecto_id, empresa_id, consolidado_id, tercero_id,
                         cuenta_tercero_id, concepto, valor, estado, solicitado_en, aprobado_por, aprobado_en)
      values ('acta', p_acta_id, 'unico', v.proyecto_id, v.empresa_id, v.consolidado_id, v_tercero, v_cuenta,
              upper(v_nombre_tipo) || ' N° ' || v.numero || ' - CONTRATO ' || v.numero_contrato || ' - ' || upper(v.contratista_nombre),
              round(v.neto, 0), 'aprobado', now(), auth.uid(), now())
      returning id into v_pago;
      perform public._pago_asignar_item(v_pago);
      perform public._pago_actualizar_novedad(v_pago);
    end if;
  end if;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
  values ('acta', p_acta_id, case when p_accion = 'aprobar' then 'aprobada' else 'rechazada' end, auth.uid(), v_motivo,
          case when v_pago is not null then jsonb_build_object('pago_id', v_pago, 'neto', v.neto) end);

  if v.creado_por is not null and v.creado_por is distinct from auth.uid() then
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    values (v.creado_por,
            case when p_accion = 'aprobar' then 'acta_aprobada' else 'acta_rechazada' end,
            'acta', p_acta_id,
            case when p_accion = 'aprobar' then v_nombre_tipo || ' aprobada' else v_nombre_tipo || ' rechazada' end,
            v_nombre_tipo || ' ' || v.numero || ' del contrato ' || v.numero_contrato
              || case when p_accion = 'aprobar' then ' aprobada.'
                      else ' rechazada. Motivo: ' || v_motivo || ' Puedes corregirla y enviarla otra vez.' end);
  end if;
end;
$function$;
revoke all on function public.resolver_acta(uuid, text, text) from public, anon;
grant execute on function public.resolver_acta(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- lecturas
drop function if exists public.actas_de_contrato(uuid);
create or replace function public.actas_de_contrato(p_contrato_id uuid)
 returns table(acta_id uuid, numero integer, tipo text, estado text, valor_bruto numeric, neto numeric,
               periodo_desde date, periodo_hasta date, created_at timestamptz, creado_por_nombre text, es_mio boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_proyecto uuid;
begin
  select c.proyecto_id into v_proyecto from contratos c where c.id = p_contrato_id;
  if v_proyecto is null or not public.puede_ver_actas(v_proyecto) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  return query
  select a.id, a.numero, a.tipo, a.estado, a.valor_bruto, a.neto, a.periodo_desde, a.periodo_hasta,
         a.created_at, pf.nombre, a.creado_por is not distinct from auth.uid()
  from actas a
  left join perfiles pf on pf.id = a.creado_por
  where a.contrato_id = p_contrato_id
  order by a.numero;
end;
$function$;
revoke all on function public.actas_de_contrato(uuid) from public, anon;
grant execute on function public.actas_de_contrato(uuid) to authenticated;

drop function if exists public.listar_actas_aprobacion(text, uuid);
create or replace function public.listar_actas_aprobacion(p_estado text default null, p_proyecto_id uuid default null)
 returns table(acta_id uuid, numero integer, tipo text, estado text, valor_bruto numeric, neto numeric, created_at timestamptz,
               creado_por_nombre text, contrato_id uuid, numero_contrato text, contrato_valor numeric,
               proyecto_codigo text, proyecto_nombre text, contratista_nombre text,
               resuelto_por_nombre text, resuelto_at timestamptz)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if not public.tiene_pestana(auth.uid(), 'contratos.aprobar_actas') then
    raise exception 'No tienes permiso para ver la aprobación de actas.';
  end if;
  return query
  select a.id, a.numero, a.tipo, a.estado, a.valor_bruto, a.neto, a.created_at, pc.nombre,
         c.id, c.numero_contrato, c.valor, p.codigo, p.nombre, k.nombre,
         pr.nombre, a.resuelto_at
  from actas a
  join contratos c on c.id = a.contrato_id
  join proyectos p on p.id = c.proyecto_id
  join contratistas k on k.id = c.contratista_id
  left join perfiles pc on pc.id = a.creado_por
  left join perfiles pr on pr.id = a.resuelto_por
  where public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
    and (p_estado is null or a.estado = p_estado)
    and (p_proyecto_id is null or c.proyecto_id = p_proyecto_id)
  order by a.created_at, a.id
  limit 1000;
end;
$function$;
revoke all on function public.listar_actas_aprobacion(text, uuid) from public, anon;
grant execute on function public.listar_actas_aprobacion(text, uuid) to authenticated;

-- Detalle: el acta, su contrato, actividades con acumulados, descuentos,
-- soportes, el pago y las líneas del formato anterior (actas viejas).
create or replace function public.detalle_acta(p_acta_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v record;
begin
  select a.*, c.proyecto_id, c.numero_contrato, c.numero as contrato_numero, c.valor as contrato_valor,
         c.objeto, c.tipo as contrato_tipo, c.anexo_tipo, c.contratista_id,
         p.codigo as proyecto_codigo, p.nombre as proyecto_nombre, p.ciudad as proyecto_ciudad,
         emp.razon_social as empresa_nombre, emp.nit as empresa_nit,
         k.nombre as contratista_nombre, k.tipo_persona as contratista_tipo_persona,
         k.tipo_documento || ' ' || k.numero_documento || coalesce('-' || k.digito_verificacion, '') as contratista_documento,
         k.representante_nombre as contratista_representante,
         pc.nombre as creado_por_nombre, pr.nombre as resuelto_por_nombre, pe.nombre as editada_por_nombre
    into v
  from actas a
  join contratos c on c.id = a.contrato_id
  join proyectos p on p.id = c.proyecto_id
  left join empresas emp on emp.id = p.empresa_id
  join contratistas k on k.id = c.contratista_id
  left join perfiles pc on pc.id = a.creado_por
  left join perfiles pr on pr.id = a.resuelto_por
  left join perfiles pe on pe.id = a.editada_por
  where a.id = p_acta_id;
  if not found or not public.puede_ver_actas(v.proyecto_id) then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;

  return jsonb_build_object(
    'id', v.id, 'numero', v.numero, 'tipo', v.tipo, 'estado', v.estado,
    'periodo_desde', v.periodo_desde, 'periodo_hasta', v.periodo_hasta, 'observaciones', v.observaciones,
    'porcentaje_avance', v.porcentaje_avance, 'valor_bruto', v.valor_bruto, 'amortizacion', v.amortizacion,
    'retencion', v.retencion, 'devolucion_retencion', v.devolucion_retencion, 'otros_descuentos', v.otros_descuentos,
    'neto', v.neto, 'anticipo_porcentaje', v.anticipo_porcentaje, 'retencion_porcentaje', v.retencion_porcentaje,
    'created_at', v.created_at, 'creado_por_nombre', v.creado_por_nombre,
    'resuelto_at', v.resuelto_at, 'resuelto_por_nombre', v.resuelto_por_nombre,
    'motivo_resolucion', v.motivo_resolucion,
    'editada_at', v.editada_at, 'editada_por_nombre', v.editada_por_nombre,
    'es_mio', v.creado_por is not distinct from auth.uid(),
    'contrato_id', v.contrato_id, 'numero_contrato', coalesce(v.numero_contrato, 'Solicitud N° ' || v.contrato_numero),
    'contrato_valor', v.contrato_valor, 'objeto', v.objeto, 'tipo_contrato', v.contrato_tipo, 'anexo_tipo', v.anexo_tipo,
    'proyecto_codigo', v.proyecto_codigo, 'proyecto_nombre', v.proyecto_nombre, 'proyecto_ciudad', v.proyecto_ciudad,
    'empresa_nombre', v.empresa_nombre, 'empresa_nit', v.empresa_nit,
    'contratista_id', v.contratista_id, 'contratista_nombre', v.contratista_nombre,
    'contratista_tipo_persona', v.contratista_tipo_persona,
    'contratista_documento', v.contratista_documento, 'contratista_representante', v.contratista_representante,
    -- Lo que usan las DEMÁS actas del contrato (por aprobar + aprobadas).
    'otras_actas', (select coalesce(sum(o.valor_bruto), 0) from actas o
                     where o.contrato_id = v.contrato_id and o.id <> v.id and o.estado <> 'rechazada'),
    -- Avance acumulado ANTES de esta acta (actas anteriores no rechazadas).
    'avance_anterior', (select coalesce(sum(o.porcentaje_avance), 0) from actas o
                         where o.contrato_id = v.contrato_id and o.numero < v.numero and o.estado <> 'rechazada'),
    'actividades', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'orden', i.orden, 'actividad', i.actividad, 'unidad', i.unidad,
               'cantidad_contratada', i.cantidad, 'valor_unitario', i.valor_unitario,
               'acumulado_anterior', coalesce((
                 select sum(x.cantidad) from acta_actividades x join actas o on o.id = x.acta_id
                 where x.contrato_anexo_item_id = i.id and o.estado <> 'rechazada' and o.numero < v.numero), 0),
               'cantidad', aa.cantidad, 'valor', aa.valor
             ) order by i.orden, i.id)
      from contrato_anexo_items i
      left join acta_actividades aa on aa.acta_id = v.id and aa.contrato_anexo_item_id = i.id
      where i.contrato_id = v.contrato_id), '[]'::jsonb),
    'descuentos', coalesce((
      select jsonb_agg(jsonb_build_object('concepto', d.concepto, 'valor', d.valor) order by d.orden)
      from acta_descuentos d where d.acta_id = v.id), '[]'::jsonb),
    'soportes', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'tipo', s.tipo, 'ruta', s.ruta, 'nombre_archivo', s.nombre_archivo,
                                          'tamano', s.tamano, 'mime', s.mime) order by s.created_at, s.id)
      from acta_soportes s where s.acta_id = v.id), '[]'::jsonb),
    'pago', (select jsonb_build_object('id', g.id, 'estado', g.estado, 'valor', g.valor, 'anio', g.anio,
                                       'semana', g.semana, 'item', g.item, 'novedad', g.novedad)
               from pagos g where g.acta_id = v.id and g.estado not in ('anulado', 'rechazado')
              order by g.creado_en desc limit 1),
    'lineas_anteriores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'orden', l.orden, 'item_codigo', l.item_codigo, 'item_descripcion', l.item_descripcion,
               'insumo_descripcion', l.insumo_descripcion, 'unidad', l.unidad, 'cantidad', l.cantidad,
               'precio', l.precio, 'total', l.total) order by l.orden)
      from acta_lineas l where l.acta_id = v.id), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.detalle_acta(uuid) from public, anon;
grant execute on function public.detalle_acta(uuid) to authenticated;

-- Las funciones del formato anterior (líneas de APU) ya no se usan.
drop function if exists public._llenar_acta(uuid, uuid, jsonb);
drop function if exists public.items_para_acta(uuid, text);
drop function if exists public.insumos_item_para_acta(uuid, uuid);
drop function if exists public._lineas_apu_para_acta(uuid);

-- ---------------------------------------------------------------- aviso de contrato vencido
-- Una vez por contrato: a quien lo pidió y a Jurídica (Legal / Líder Legal que
-- vean el proyecto). Contratos con la minuta aprobada, sin liquidar.
create or replace function public._avisar_contratos_vencidos()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_n integer := 0;
  c record;
  v_fin date;
  v_msg text;
begin
  for c in
    select x.id, x.numero, x.numero_contrato, x.proyecto_id, x.solicitado_por, k.nombre as contratista
      from contratos x join contratistas k on k.id = x.contratista_id
     where x.estado = 'aprobada' and x.minuta_estado = 'aprobada'
       and x.liquidado_at is null and x.aviso_vencido_at is null
  loop
    v_fin := public._fecha_fin_contrato(c.id);
    continue when v_fin is null or v_fin >= v_hoy;
    v_msg := 'El contrato ' || coalesce(c.numero_contrato, 'N° ' || c.numero) || ' (' || c.contratista
             || ') venció el ' || to_char(v_fin, 'DD/MM/YYYY') || ' y no tiene acta de liquidación. '
             || 'Ya no recibe actas de avance.';
    if c.solicitado_por is not null then
      insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
      values (c.solicitado_por, 'contrato_vencido', 'contrato', c.id, 'Contrato vencido sin liquidar', v_msg);
    end if;
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    select pf.id, 'contrato_vencido_juridica', 'contrato', c.id, 'Contrato vencido sin liquidar', v_msg
      from perfiles pf join roles r on r.id = pf.rol_id
     where r.clave in ('legal', 'lider_legal')
       and pf.id is distinct from c.solicitado_por
       and public.usuario_puede_ver_proyecto(pf.id, c.proyecto_id);
    update contratos set aviso_vencido_at = now() where id = c.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;
revoke all on function public._avisar_contratos_vencidos() from public, anon, authenticated;

-- Todos los días a las 6:10 a. m. de Colombia (11:10 UTC).
select cron.schedule('avisar-contratos-vencidos', '10 11 * * *', $$select public._avisar_contratos_vencidos()$$);
