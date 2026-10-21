-- A&F · Liquidación de pagos (pasos 1 y 2 del diseño, decisiones del usuario
-- 2026-10-21). Contabilidad calcula las retenciones de cada pago aprobado y con
-- eso queda el NETO que se dispersa. Sale de la ingeniería inversa de lo que
-- Contabilidad liquidó a mano en las semanas 31 a 42 de 2026 (cuadro de pagos,
-- extracción de 2.005 RUT y las tablas de retención e ICA de Contabilidad).
--
-- Qué crea:
--   1. Catálogos que mantiene Contabilidad (acción gestionar_retenciones):
--      UVT por año, conceptos de retefuente, actividades y tarifas de ICA por
--      municipio, y el municipio de ICA de cada proyecto.
--   2. Qué retiene cada empresa que paga (retefuente, ReteIVA, ICA por
--      municipio). Arrancan "inferido, por confirmar" desde el historial.
--   3. Perfil tributario del tercero (desde el RUT; PENDIENTE hasta que
--      Contabilidad lo verifique) y la extracción de RUT como datos de apoyo:
--      un tercero nuevo con RUT en la extracción recibe su perfil solo.
--   4. Memoria de la liquidación por tercero (liquidacion_preferencias): lo que
--      Contabilidad decidió (historial + cada liquidación nueva). El motor de
--      sugerencias (paso 3) la usa primero.
--   5. Desglose de origen guardado en cada pago (como el cuadro de pagos):
--      valor del documento, base, IVA, anticipos y/o descuentos, retención en
--      garantía y otros descuentos. Lo llena un disparador desde la OC o el
--      acta; quien lo pidió (solicitado_por) también.
--   6. Liquidaciones con versiones y líneas (retefuente, ReteICA, ReteIVA,
--      descuentos; cada línea con base, tarifa, valor, si la empresa la asume y
--      la regla que la sugirió). liquidar_pago / deshacer_liquidacion. Estado
--      'liquidado' con valor_neto.
--   7. Permisos: pestaña ayf.liquidacion, acciones liquidar_pagos y
--      gestionar_retenciones, rol Contabilidad.
--
-- Fórmula (la del cuadro de pagos):
--   valor del pago (aprobado) = valor documento − anticipos − garantía − otros
--   neto = valor del pago − retenciones no asumidas − descuentos de Contabilidad
--
-- Los datos que salen de los RUT y del historial (perfiles, preferencias,
-- empresas) NO van en esta migración: los genera
-- scripts/generar_datos_liquidacion.py en referencias/ (fuera de git) y se
-- corren a mano DESPUÉS de esta.

-- ===================================================================
-- 0. Ayudas
-- ===================================================================

-- Clave para comparar razones sociales: mayúsculas, sin tildes ni signos, sin
-- SAS / SA / LTDA / ZOMAC / ZESE y sin espacios. "Constructora Lucaso S.A.S."
-- y "CONSTRUCTORA LUCASO" dan lo mismo.
create or replace function public._clave_nombre_empresa(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(
    regexp_replace(
      regexp_replace(
        upper(translate(coalesce(p, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNAEIOUUN')),
        '[^A-Z0-9 ]', '', 'g'),
      '\m(SAS|SA|LTDA|ZOMAC|ZESE|EN REORGANIZACION)\M', '', 'g'),
    ' ', '')
$$;
revoke all on function public._clave_nombre_empresa(text) from public, anon, authenticated;

-- ===================================================================
-- 1. Catálogos
-- ===================================================================

create table if not exists public.uvt (
  anio           smallint primary key check (anio between 2020 and 2100),
  valor          numeric(12, 2) not null check (valor > 0),
  actualizado_por uuid references public.perfiles(id),
  actualizado_en timestamptz not null default now()
);

-- Actividades de ICA (columnas de la tabla de Contabilidad). usa_base dice qué
-- base mínima del municipio aplica.
create table if not exists public.ica_actividades (
  clave    text primary key check (clave ~ '^[a-z0-9_]+$'),
  nombre   text not null,
  usa_base text not null check (usa_base in ('compras', 'servicios', 'profesionales')),
  orden    integer not null default 0
);

create table if not exists public.municipios (
  id                 uuid primary key default gen_random_uuid(),
  departamento       text not null,
  nombre             text not null,
  codigo_dane        text,
  -- Bases mínimas de ReteICA en pesos (null = sin base: se retiene siempre).
  base_compras       numeric(14, 2),
  base_servicios     numeric(14, 2),
  base_profesionales numeric(14, 2),
  -- Complementarios (porcentaje del ICA): no se liquidan todavía, quedan anotados.
  avisos_tableros_pct    numeric(7, 5),
  sobretasa_bomberil_pct numeric(7, 5),
  activo             boolean not null default true,
  actualizado_por    uuid references public.perfiles(id),
  actualizado_en     timestamptz not null default now(),
  unique (departamento, nombre)
);

-- Tarifa como fracción: 0.00966 = 9,66 por mil.
create table if not exists public.ica_tarifas (
  municipio_id    uuid not null references public.municipios(id) on delete cascade,
  actividad_clave text not null references public.ica_actividades(clave),
  tarifa          numeric(7, 5) not null check (tarifa >= 0 and tarifa < 1),
  actualizado_por uuid references public.perfiles(id),
  actualizado_en  timestamptz not null default now(),
  primary key (municipio_id, actividad_clave)
);
create index if not exists idx_ica_tarifas_actividad on public.ica_tarifas(actividad_clave);

-- Conceptos de retención en la fuente. Tarifas como fracción (0.025 = 2,5 %).
--   tarifa_declarante     persona jurídica y persona natural declarante
--   tarifa_no_declarante  persona natural no declarante
--   tarifa_juridica       si la persona jurídica tiene otra (honorarios 11 %)
--   base_uvt              base mínima (0 = sin base)
--   natural_tabla_383     persona natural: rentas de trabajo, sin retención por
--                         debajo de 95 UVT (art. 383 E.T.)
create table if not exists public.retencion_conceptos (
  clave                text primary key check (clave ~ '^[a-z0-9_]+$'),
  nombre               text not null check (btrim(nombre) <> ''),
  tarifa_declarante    numeric(7, 5) not null check (tarifa_declarante >= 0 and tarifa_declarante < 1),
  tarifa_no_declarante numeric(7, 5) not null check (tarifa_no_declarante >= 0 and tarifa_no_declarante < 1),
  tarifa_juridica      numeric(7, 5) check (tarifa_juridica is null or (tarifa_juridica >= 0 and tarifa_juridica < 1)),
  base_uvt             numeric(10, 2) not null default 0 check (base_uvt >= 0),
  natural_tabla_383    boolean not null default false,
  actividad_ica        text references public.ica_actividades(clave),
  activo               boolean not null default true,
  orden                integer not null default 0,
  actualizado_por      uuid references public.perfiles(id),
  actualizado_en       timestamptz not null default now()
);
create index if not exists idx_retencion_conceptos_ica on public.retencion_conceptos(actividad_ica);

-- Municipio donde se liquida el ICA de cada proyecto (el de la obra).
alter table public.proyectos add column if not exists municipio_ica_id uuid references public.municipios(id);
create index if not exists idx_proyectos_municipio_ica on public.proyectos(municipio_ica_id);

-- ===================================================================
-- 2. Qué retiene cada empresa que paga
-- ===================================================================

-- Sin fila = no se sabe: el motor lo trata como agente y lo avisa.
create table if not exists public.empresas_retenciones (
  empresa_id        uuid primary key references public.empresas(id) on delete cascade,
  agente_retefuente boolean not null default true,
  agente_reteiva    boolean not null default true,
  -- false = inferido del historial (por confirmar); true = Contabilidad lo confirmó.
  confirmado        boolean not null default false,
  observaciones     text,
  actualizado_por   uuid references public.perfiles(id),
  actualizado_en    timestamptz not null default now()
);

-- Municipios donde la empresa practica ReteICA.
create table if not exists public.empresas_reteica_municipios (
  empresa_id      uuid not null references public.empresas(id) on delete cascade,
  municipio_id    uuid not null references public.municipios(id) on delete cascade,
  confirmado      boolean not null default false,
  actualizado_por uuid references public.perfiles(id),
  actualizado_en  timestamptz not null default now(),
  primary key (empresa_id, municipio_id)
);
create index if not exists idx_empresas_reteica_municipio on public.empresas_reteica_municipios(municipio_id);

-- ===================================================================
-- 3. Perfil tributario del tercero
-- ===================================================================

-- Extracción de RUT (capa de apoyo, una fila por documento, la más reciente).
-- Solo datos tributarios: sin correo, teléfono ni dirección. Sin acceso por la
-- API: la leen las funciones.
create table if not exists public.rut_extracciones (
  numero_documento    text primary key check (numero_documento ~ '^[0-9]+$'),
  dv                  text,
  dv_cuadra           boolean,
  tipo_persona        text check (tipo_persona in ('natural', 'juridica')),
  nombre              text,
  departamento        text,
  municipio           text,
  ciiu_principal      text,
  ciiu_secundaria     text,
  responsabilidades   text[] not null default '{}',
  fecha_actualizacion date,
  calidad_lectura     text,
  archivo_origen      text,
  cargado_en          timestamptz not null default now()
);

create table if not exists public.terceros_tributario (
  tercero_id         uuid primary key references public.terceros(id) on delete cascade,
  tipo_persona       text not null check (tipo_persona in ('natural', 'juridica')),
  -- Persona jurídica: siempre. Persona natural: responsabilidad 05 en el RUT.
  declarante         boolean not null,
  responsable_iva    boolean not null default false,   -- 48
  regimen_simple     boolean not null default false,   -- 47
  autorretenedor     boolean not null default false,   -- 15
  gran_contribuyente boolean not null default false,   -- 13
  zomac              boolean not null default false,
  responsabilidades  text[] not null default '{}',     -- casilla 53 completa
  ciiu_principal     text,
  ciiu_secundaria    text,
  departamento_rut   text,
  municipio_rut      text,
  fecha_rut          date,
  -- PDF del RUT en Storage (lo sube quien crea el tercero; paso 3).
  rut_ruta           text,
  origen             text not null check (origen in ('extraccion_rut', 'manual')),
  estado             text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'VERIFICADO')),
  -- Lo que hay que revisar (DV que no cuadra, lectura de baja calidad...).
  alerta             text,
  verificado_por     uuid references public.perfiles(id),
  verificado_en      timestamptz,
  actualizado_por    uuid references public.perfiles(id),
  actualizado_en     timestamptz not null default now()
);
create index if not exists idx_terceros_tributario_verificado_por on public.terceros_tributario(verificado_por);
create index if not exists idx_terceros_tributario_actualizado_por on public.terceros_tributario(actualizado_por);

-- Crea el perfil de un tercero desde la extracción de RUT (si hay y si el
-- tercero todavía no tiene perfil). Costo constante.
create or replace function public._perfil_tributario_desde_rut(p_tercero_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.terceros_tributario (
    tercero_id, tipo_persona, declarante, responsable_iva, regimen_simple, autorretenedor,
    gran_contribuyente, zomac, responsabilidades, ciiu_principal, ciiu_secundaria,
    departamento_rut, municipio_rut, fecha_rut, origen, estado, alerta
  )
  select t.id,
         x.tipo,
         x.tipo = 'juridica' or '05' = any (r.responsabilidades),
         '48' = any (r.responsabilidades),
         '47' = any (r.responsabilidades),
         '15' = any (r.responsabilidades),
         '13' = any (r.responsabilidades),
         upper(coalesce(t.razon_social, '') || ' ' || coalesce(r.nombre, '')) like '%ZOMAC%',
         r.responsabilidades, r.ciiu_principal, r.ciiu_secundaria,
         r.departamento, r.municipio, r.fecha_actualizacion, 'extraccion_rut', 'PENDIENTE',
         nullif(concat_ws(' ',
           case when r.dv_cuadra is false then 'El DV del RUT no cuadra con el NIT.' end,
           case when r.calidad_lectura is distinct from 'ALTA' then 'Lectura del RUT de calidad ' || lower(coalesce(r.calidad_lectura, 'desconocida')) || '.' end,
           case when cardinality(r.responsabilidades) = 0 then 'No se leyeron las responsabilidades (casilla 53).' end
         ), '')
    from public.terceros t
    join public.rut_extracciones r on r.numero_documento = t.numero_documento
   cross join lateral (
     select coalesce(r.tipo_persona, case when t.tipo_documento = 'NIT' then 'juridica' else 'natural' end) as tipo
   ) x
   where t.id = p_tercero_id
  on conflict (tercero_id) do nothing
$$;
revoke all on function public._perfil_tributario_desde_rut(uuid) from public, anon, authenticated;

create or replace function public._tercero_perfil_desde_rut()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._perfil_tributario_desde_rut(new.id);
  return null;
end;
$$;
revoke all on function public._tercero_perfil_desde_rut() from public, anon, authenticated;

drop trigger if exists trg_tercero_perfil_desde_rut on public.terceros;
create trigger trg_tercero_perfil_desde_rut
  after insert on public.terceros
  for each row execute function public._tercero_perfil_desde_rut();

-- ===================================================================
-- 4. Memoria de la liquidación por tercero
-- ===================================================================

-- Por DOCUMENTO (no por tercero_id): así sirve también para terceros que se
-- creen después. tarifa 0 / concepto null = no se le practica.
create table if not exists public.liquidacion_preferencias (
  id               uuid primary key default gen_random_uuid(),
  numero_documento text not null check (numero_documento ~ '^[0-9]+$'),
  tipo             text not null check (tipo in ('retefuente', 'reteica', 'reteiva')),
  municipio_id     uuid references public.municipios(id) on delete cascade,
  concepto_clave   text references public.retencion_conceptos(clave),
  actividad_ica    text references public.ica_actividades(clave),
  tarifa           numeric(7, 5) not null check (tarifa >= 0 and tarifa < 1),
  veces            integer not null default 1 check (veces > 0),
  origen           text not null check (origen in ('historial', 'contabilidad')),
  ultima_vez       timestamptz not null default now(),
  actualizado_por  uuid references public.perfiles(id),
  constraint liquidacion_preferencias_municipio check ((tipo = 'reteica') = (municipio_id is not null))
);
create unique index if not exists liquidacion_preferencias_unica
  on public.liquidacion_preferencias(numero_documento, tipo, coalesce(municipio_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_liquidacion_preferencias_municipio on public.liquidacion_preferencias(municipio_id);
create index if not exists idx_liquidacion_preferencias_concepto on public.liquidacion_preferencias(concepto_clave);
create index if not exists idx_liquidacion_preferencias_actividad on public.liquidacion_preferencias(actividad_ica);
create index if not exists idx_liquidacion_preferencias_actualizado_por on public.liquidacion_preferencias(actualizado_por);

-- ===================================================================
-- 5. Desglose de origen y solicitante en cada pago
-- ===================================================================

alter table public.pagos
  add column if not exists solicitado_por      uuid references public.perfiles(id),
  add column if not exists valor_documento     numeric(18, 2),
  add column if not exists base_gravable       numeric(18, 2),
  add column if not exists iva                 numeric(18, 2),
  add column if not exists descuento_anticipos numeric(18, 2) not null default 0,
  add column if not exists retencion_garantia  numeric(18, 2) not null default 0,
  add column if not exists otros_descuentos    numeric(18, 2) not null default 0,
  add column if not exists valor_neto          numeric(18, 2),
  add column if not exists liquidacion_id      uuid;
create index if not exists idx_pagos_solicitado_por on public.pagos(solicitado_por);
create index if not exists idx_pagos_liquidacion on public.pagos(liquidacion_id);
create index if not exists idx_pagos_por_liquidar on public.pagos(aprobado_en) where estado = 'aprobado';

-- Desglose desde el documento de origen (como las columnas del cuadro de pagos):
--   OC, pago total: documento = valor; base = subtotal de las líneas (con
--     descuento, sin IVA); IVA = documento − base.
--   OC, anticipo: documento = valor; base e IVA en la proporción de la OC.
--   OC, saldo: la factura completa. documento = valor + anticipos vivos de la
--     misma OC (anticipos y/o descuentos); base e IVA de toda la OC.
--   Acta: documento = valor + amortización + (retención − devolución de la
--     retención) + otros descuentos del acta (≈ el bruto); sin IVA.
-- Así siempre: valor = documento − anticipos − garantía − otros.
create or replace function public._pago_desglose_origen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub   numeric;
  v_total numeric;
  v_ant   numeric := 0;
  v_a     record;
begin
  if new.fuente = 'orden_compra' and new.orden_compra_id is not null then
    if new.solicitado_por is null then
      select oc.created_by into new.solicitado_por from public.ordenes_compra oc where oc.id = new.orden_compra_id;
      if not exists (select 1 from public.perfiles p where p.id = new.solicitado_por) then
        new.solicitado_por := null;
      end if;
    end if;
    select coalesce(sum(i.cantidad * i.precio_unitario * (1 - i.porcentaje_descuento / 100.0)), 0),
           coalesce(sum(i.cantidad * i.precio_unitario * (1 - i.porcentaje_descuento / 100.0)
                        * (1 + i.porcentaje_iva / 100.0)), 0)
      into v_sub, v_total
      from public.ordenes_compra_items i
     where i.orden_compra_id = new.orden_compra_id;
    if new.tipo = 'saldo' then
      select coalesce(sum(g.valor), 0) into v_ant
        from public.pagos g
       where g.orden_compra_id = new.orden_compra_id and g.tipo = 'anticipo'
         and g.estado not in ('anulado', 'rechazado') and g.id <> new.id;
    end if;
    new.descuento_anticipos := v_ant;
    new.retencion_garantia := 0;
    new.otros_descuentos := 0;
    new.valor_documento := new.valor + v_ant;
    if new.tipo = 'anticipo' then
      new.base_gravable := case when v_total > 0 then round(new.valor * v_sub / v_total, 0) else new.valor end;
    else
      new.base_gravable := least(round(v_sub, 0), new.valor_documento);
    end if;
    new.iva := new.valor_documento - new.base_gravable;
  elsif new.fuente = 'acta' and new.acta_id is not null then
    select a.amortizacion, a.retencion, a.devolucion_retencion, a.otros_descuentos, a.creado_por
      into v_a from public.actas a where a.id = new.acta_id;
    if found then
      new.solicitado_por := coalesce(new.solicitado_por, v_a.creado_por);
      new.descuento_anticipos := coalesce(v_a.amortizacion, 0);
      new.retencion_garantia := coalesce(v_a.retencion, 0) - coalesce(v_a.devolucion_retencion, 0);
      new.otros_descuentos := coalesce(v_a.otros_descuentos, 0);
      new.valor_documento := new.valor + new.descuento_anticipos + new.retencion_garantia + new.otros_descuentos;
      new.base_gravable := new.valor_documento;
      new.iva := 0;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._pago_desglose_origen() from public, anon, authenticated;

drop trigger if exists trg_pago_desglose_origen on public.pagos;
create trigger trg_pago_desglose_origen
  before insert or update of valor, tipo, orden_compra_id, acta_id on public.pagos
  for each row execute function public._pago_desglose_origen();

-- Pagos que ya existían: el disparador corre con un UPDATE que no cambia nada.
update public.pagos set valor = valor where valor_documento is null;

-- ===================================================================
-- 6. Liquidaciones
-- ===================================================================

create table if not exists public.pago_liquidaciones (
  id                  uuid primary key default gen_random_uuid(),
  pago_id             uuid not null constraint pago_liquidaciones_pago_id_fkey references public.pagos(id),
  version             integer not null check (version > 0),
  estado              text not null default 'vigente' check (estado in ('vigente', 'anulada')),
  -- Copia del pago al liquidarlo.
  valor_pago          numeric(18, 2) not null,
  valor_documento     numeric(18, 2),
  base_gravable       numeric(18, 2),
  iva                 numeric(18, 2),
  descuento_anticipos numeric(18, 2) not null default 0,
  retencion_garantia  numeric(18, 2) not null default 0,
  otros_descuentos    numeric(18, 2) not null default 0,
  -- Resultado (totales de las líneas; las retenciones incluyen las asumidas).
  retefuente          numeric(18, 2) not null default 0,
  reteica             numeric(18, 2) not null default 0,
  reteiva             numeric(18, 2) not null default 0,
  asumidas            numeric(18, 2) not null default 0,
  descuentos          numeric(18, 2) not null default 0,
  neto                numeric(18, 2) not null check (neto > 0),
  numero_factura      text,
  observaciones       text,
  -- Lo que sugirió el motor y si Contabilidad lo aceptó tal cual (aprendizaje).
  sugerencia          jsonb,
  sin_cambios         boolean,
  liquidado_por       uuid not null references public.perfiles(id),
  liquidado_en        timestamptz not null default now(),
  anulada_por         uuid references public.perfiles(id),
  anulada_en          timestamptz,
  motivo_anulacion    text,
  unique (pago_id, version),
  constraint pago_liquidaciones_anulada check ((estado = 'anulada') = (anulada_en is not null))
);
create unique index if not exists pago_liquidaciones_una_vigente on public.pago_liquidaciones(pago_id) where estado = 'vigente';
create index if not exists idx_pago_liquidaciones_liquidado_por on public.pago_liquidaciones(liquidado_por);
create index if not exists idx_pago_liquidaciones_anulada_por on public.pago_liquidaciones(anulada_por);
create index if not exists idx_pago_liquidaciones_fecha on public.pago_liquidaciones(liquidado_en);

create table if not exists public.pago_liquidacion_lineas (
  id             uuid primary key default gen_random_uuid(),
  liquidacion_id uuid not null references public.pago_liquidaciones(id) on delete cascade,
  orden          integer not null,
  tipo           text not null check (tipo in ('retefuente', 'reteica', 'reteiva', 'descuento')),
  concepto_clave text references public.retencion_conceptos(clave),
  municipio_id   uuid references public.municipios(id),
  actividad_ica  text references public.ica_actividades(clave),
  descripcion    text,
  base           numeric(18, 2) check (base is null or base >= 0),
  tarifa         numeric(7, 5) check (tarifa is null or (tarifa >= 0 and tarifa < 1)),
  valor          numeric(18, 2) not null check (valor >= 0),
  asumida        boolean not null default false,
  -- De dónde salió la sugerencia ("perfil RUT + catálogo", "lo último que se
  -- le liquidó al tercero"...). Null = la agregó Contabilidad.
  regla          text,
  editada        boolean not null default false,
  unique (liquidacion_id, orden),
  constraint pago_liquidacion_lineas_forma check (
    (tipo = 'descuento' and base is null and tarifa is null and not asumida)
    or (tipo <> 'descuento' and base is not null and tarifa is not null)
  )
);
create index if not exists idx_pago_liquidacion_lineas_concepto on public.pago_liquidacion_lineas(concepto_clave);
create index if not exists idx_pago_liquidacion_lineas_municipio on public.pago_liquidacion_lineas(municipio_id);
create index if not exists idx_pago_liquidacion_lineas_actividad on public.pago_liquidacion_lineas(actividad_ica);

alter table public.pagos drop constraint if exists pagos_liquidacion_id_fkey;
alter table public.pagos add constraint pagos_liquidacion_id_fkey
  foreign key (liquidacion_id) references public.pago_liquidaciones(id);
alter table public.pagos drop constraint if exists pagos_liquidado_con_neto;
alter table public.pagos add constraint pagos_liquidado_con_neto check (
  estado <> 'liquidado' or (valor_neto is not null and liquidacion_id is not null)
);

-- Recuerda lo que Contabilidad decidió para el documento del tercero.
create or replace function public._recordar_preferencia(
  p_documento text, p_tipo text, p_municipio uuid, p_concepto text, p_actividad text, p_tarifa numeric
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.liquidacion_preferencias as lp
    (numero_documento, tipo, municipio_id, concepto_clave, actividad_ica, tarifa, veces, origen, ultima_vez, actualizado_por)
  values (p_documento, p_tipo, p_municipio, p_concepto, p_actividad, p_tarifa, 1, 'contabilidad', now(), auth.uid())
  on conflict (numero_documento, tipo, coalesce(municipio_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update
     set veces = case when lp.tarifa = excluded.tarifa and lp.concepto_clave is not distinct from excluded.concepto_clave
                      then lp.veces + 1 else 1 end,
         concepto_clave = excluded.concepto_clave,
         actividad_ica = excluded.actividad_ica,
         tarifa = excluded.tarifa,
         origen = 'contabilidad',
         ultima_vez = now(),
         actualizado_por = excluded.actualizado_por
$$;
revoke all on function public._recordar_preferencia(text, text, uuid, text, text, numeric) from public, anon, authenticated;

-- Liquidar (o volver a liquidar) un pago. p_datos:
--   { lineas: [{ tipo, concepto, municipio_id, actividad, descripcion, base,
--                tarifa, valor (solo descuentos), asumida, regla, editada }],
--     numero_factura, observaciones, sugerencia (jsonb), sin_cambios }
-- La base vuelve a calcular cada retención (base × tarifa, al peso) y el neto.
-- Costo lineal en el número de líneas (máximo 40).
create or replace function public.liquidar_pago(p_pago_id uuid, p_datos jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_p       record;
  v_doc     text;
  v_lineas  jsonb := coalesce(p_datos->'lineas', '[]'::jsonb);
  v_l       jsonb;
  v_n       integer := 0;
  v_tipo    text;
  v_base    numeric;
  v_tarifa  numeric;
  v_valor   numeric;
  v_asumida boolean;
  v_rf      numeric := 0;
  v_ri      numeric := 0;
  v_rv      numeric := 0;
  v_asum    numeric := 0;
  v_desc    numeric := 0;
  v_neto    numeric;
  v_version integer;
  v_id      uuid;
  v_previa  uuid;
begin
  if not public.tiene_accion(v_uid, 'liquidar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para liquidar pagos.';
  end if;
  if jsonb_typeof(v_lineas) <> 'array' or jsonb_array_length(v_lineas) > 40 then
    raise exception 'La liquidación admite como mucho 40 líneas.';
  end if;

  select g.* into v_p from public.pagos g where g.id = p_pago_id for update;
  if not found then
    raise exception 'El pago no existe.';
  end if;
  if v_p.estado not in ('aprobado', 'liquidado') then
    raise exception 'Solo se liquidan pagos aprobados (este está %).', v_p.estado;
  end if;
  if v_p.tercero_id is null then
    raise exception 'El pago no tiene tercero: asígnalo antes de liquidar (las retenciones dependen de él).';
  end if;
  select t.numero_documento into v_doc from public.terceros t where t.id = v_p.tercero_id;

  v_previa := case when v_p.estado = 'liquidado' then v_p.liquidacion_id end;
  if v_previa is not null then
    update public.pago_liquidaciones
       set estado = 'anulada', anulada_por = v_uid, anulada_en = now(), motivo_anulacion = 'Se volvió a liquidar.'
     where id = v_previa and estado = 'vigente';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.pago_liquidaciones where pago_id = p_pago_id;

  insert into public.pago_liquidaciones (
    pago_id, version, valor_pago, valor_documento, base_gravable, iva, descuento_anticipos,
    retencion_garantia, otros_descuentos, neto, numero_factura, observaciones, sugerencia, sin_cambios, liquidado_por
  ) values (
    p_pago_id, v_version, v_p.valor, v_p.valor_documento, v_p.base_gravable, v_p.iva, v_p.descuento_anticipos,
    v_p.retencion_garantia, v_p.otros_descuentos, v_p.valor,
    nullif(btrim(coalesce(p_datos->>'numero_factura', v_p.numero_factura, '')), ''),
    nullif(btrim(p_datos->>'observaciones'), ''),
    p_datos->'sugerencia', (p_datos->>'sin_cambios')::boolean, v_uid
  ) returning id into v_id;

  for v_l in select value from jsonb_array_elements(v_lineas) loop
    v_n := v_n + 1;
    v_tipo := v_l->>'tipo';
    v_asumida := coalesce((v_l->>'asumida')::boolean, false);
    if v_tipo = 'descuento' then
      v_valor := round(coalesce((v_l->>'valor')::numeric, 0), 0);
      if v_valor <= 0 then
        raise exception 'Línea %: el descuento debe ser mayor que cero.', v_n;
      end if;
      if nullif(btrim(v_l->>'descripcion'), '') is null then
        raise exception 'Línea %: escribe qué se descuenta.', v_n;
      end if;
      v_base := null;
      v_tarifa := null;
      v_asumida := false;
      v_desc := v_desc + v_valor;
    elsif v_tipo in ('retefuente', 'reteica', 'reteiva') then
      v_base := round(coalesce((v_l->>'base')::numeric, -1), 2);
      v_tarifa := coalesce((v_l->>'tarifa')::numeric, -1);
      if v_base < 0 then
        raise exception 'Línea %: la base no es válida.', v_n;
      end if;
      if v_tarifa < 0 or v_tarifa >= 1 then
        raise exception 'Línea %: la tarifa no es válida.', v_n;
      end if;
      if v_p.valor_documento is not null and v_base > v_p.valor_documento then
        raise exception 'Línea %: la base no puede pasar del valor del documento.', v_n;
      end if;
      if v_tipo = 'retefuente' and not exists (select 1 from public.retencion_conceptos c where c.clave = v_l->>'concepto') then
        raise exception 'Línea %: escoge el concepto de retención en la fuente.', v_n;
      end if;
      if v_tipo = 'reteica' and not exists (select 1 from public.municipios m where m.id = (v_l->>'municipio_id')::uuid) then
        raise exception 'Línea %: escoge el municipio del ICA.', v_n;
      end if;
      v_valor := round(v_base * v_tarifa, 0);
      if v_tipo = 'retefuente' then v_rf := v_rf + v_valor;
      elsif v_tipo = 'reteica' then v_ri := v_ri + v_valor;
      else v_rv := v_rv + v_valor; end if;
      if v_asumida then v_asum := v_asum + v_valor; end if;
    else
      raise exception 'Línea %: tipo de línea no válido.', v_n;
    end if;

    insert into public.pago_liquidacion_lineas (
      liquidacion_id, orden, tipo, concepto_clave, municipio_id, actividad_ica, descripcion,
      base, tarifa, valor, asumida, regla, editada
    ) values (
      v_id, v_n, v_tipo,
      case when v_tipo = 'retefuente' then v_l->>'concepto' end,
      case when v_tipo = 'reteica' then (v_l->>'municipio_id')::uuid end,
      case when v_tipo = 'reteica' then nullif(v_l->>'actividad', '') end,
      nullif(btrim(v_l->>'descripcion'), ''),
      v_base, v_tarifa, v_valor, v_asumida,
      nullif(btrim(v_l->>'regla'), ''), coalesce((v_l->>'editada')::boolean, false)
    );

    -- Memoria por tercero: lo que Contabilidad confirmó.
    if v_tipo <> 'descuento' and v_doc is not null then
      perform public._recordar_preferencia(
        v_doc, v_tipo,
        case when v_tipo = 'reteica' then (v_l->>'municipio_id')::uuid end,
        case when v_tipo = 'retefuente' then v_l->>'concepto' end,
        case when v_tipo = 'reteica' then nullif(v_l->>'actividad', '') end,
        v_tarifa);
    end if;
  end loop;

  -- Si el motor sugirió retefuente / ReteIVA y Contabilidad la quitó, también
  -- se recuerda (tarifa 0: a este tercero no se le practica).
  if v_doc is not null and jsonb_typeof(p_datos->'sugerencia'->'lineas') = 'array' then
    if exists (select 1 from jsonb_array_elements(p_datos->'sugerencia'->'lineas') s where s.value->>'tipo' = 'retefuente')
       and not exists (select 1 from jsonb_array_elements(v_lineas) s where s.value->>'tipo' = 'retefuente') then
      perform public._recordar_preferencia(v_doc, 'retefuente', null, null, null, 0);
    end if;
    if exists (select 1 from jsonb_array_elements(p_datos->'sugerencia'->'lineas') s where s.value->>'tipo' = 'reteiva')
       and not exists (select 1 from jsonb_array_elements(v_lineas) s where s.value->>'tipo' = 'reteiva') then
      perform public._recordar_preferencia(v_doc, 'reteiva', null, null, null, 0);
    end if;
  end if;

  v_neto := v_p.valor - (v_rf + v_ri + v_rv - v_asum) - v_desc;
  if v_neto <= 0 then
    raise exception 'El neto a pagar queda en % : revisa las retenciones y los descuentos.', v_neto;
  end if;

  update public.pago_liquidaciones
     set retefuente = v_rf, reteica = v_ri, reteiva = v_rv, asumidas = v_asum, descuentos = v_desc, neto = v_neto
   where id = v_id;

  update public.pagos
     set estado = 'liquidado', valor_neto = v_neto, liquidacion_id = v_id,
         numero_factura = coalesce(nullif(btrim(p_datos->>'numero_factura'), ''), numero_factura)
   where id = p_pago_id;

  if v_previa is not null then
    insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('pago', p_pago_id, 'reliquidado', v_uid, jsonb_build_object('version', v_version, 'neto', v_neto));
  end if;
  return v_id;
end;
$$;
revoke all on function public.liquidar_pago(uuid, jsonb) from public, anon;
grant execute on function public.liquidar_pago(uuid, jsonb) to authenticated;

-- Deshacer la liquidación: el pago vuelve a "Aprobado" (sin neto) y la
-- liquidación queda anulada con su motivo. Solo antes de la dispersión.
create or replace function public.deshacer_liquidacion(p_pago_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_p   record;
begin
  if not public.tiene_accion(v_uid, 'liquidar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para liquidar pagos.';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo es obligatorio.';
  end if;
  select id, estado, liquidacion_id into v_p from public.pagos where id = p_pago_id for update;
  if not found or v_p.estado <> 'liquidado' then
    raise exception 'El pago no existe o no está liquidado.';
  end if;

  update public.pago_liquidaciones
     set estado = 'anulada', anulada_por = v_uid, anulada_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = v_p.liquidacion_id and estado = 'vigente';
  insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo)
  values ('pago', p_pago_id, 'liquidacion_anulada', v_uid, btrim(p_motivo));
  update public.pagos set estado = 'aprobado', valor_neto = null, liquidacion_id = null where id = p_pago_id;
end;
$$;
revoke all on function public.deshacer_liquidacion(uuid, text) from public, anon;
grant execute on function public.deshacer_liquidacion(uuid, text) to authenticated;

-- Un pago liquidado que se anula o rechaza deja su liquidación anulada (queda
-- de registro). Si le cambian el tercero, la liquidación ya no vale: vuelve a
-- "Aprobado" para liquidarlo otra vez.
create or replace function public._pago_liquidacion_sigue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.estado <> 'liquidado' or old.liquidacion_id is null then
    return new;
  end if;
  if new.estado in ('anulado', 'rechazado') then
    update public.pago_liquidaciones
       set estado = 'anulada', anulada_por = auth.uid(), anulada_en = now(),
           motivo_anulacion = coalesce(new.motivo_anulacion, new.motivo_rechazo, 'El pago fue anulado.')
     where id = old.liquidacion_id and estado = 'vigente';
  elsif new.estado = 'liquidado' and new.tercero_id is distinct from old.tercero_id then
    update public.pago_liquidaciones
       set estado = 'anulada', anulada_por = auth.uid(), anulada_en = now(),
           motivo_anulacion = 'Cambió el tercero del pago: hay que liquidarlo otra vez.'
     where id = old.liquidacion_id and estado = 'vigente';
    new.estado := 'aprobado';
    new.valor_neto := null;
    new.liquidacion_id := null;
  end if;
  return new;
end;
$$;
revoke all on function public._pago_liquidacion_sigue() from public, anon, authenticated;

drop trigger if exists trg_pago_liquidacion_sigue on public.pagos;
create trigger trg_pago_liquidacion_sigue
  before update of estado, tercero_id on public.pagos
  for each row execute function public._pago_liquidacion_sigue();

-- ===================================================================
-- 7. Seguridad
-- ===================================================================

alter table public.uvt                         enable row level security;
alter table public.ica_actividades             enable row level security;
alter table public.municipios                  enable row level security;
alter table public.ica_tarifas                 enable row level security;
alter table public.retencion_conceptos         enable row level security;
alter table public.empresas_retenciones        enable row level security;
alter table public.empresas_reteica_municipios enable row level security;
alter table public.rut_extracciones            enable row level security;
alter table public.terceros_tributario         enable row level security;
alter table public.liquidacion_preferencias    enable row level security;
alter table public.pago_liquidaciones          enable row level security;
alter table public.pago_liquidacion_lineas     enable row level security;

-- Catálogos y retenciones de las empresas: leen Liquidación y quien los
-- mantiene; escribe gestionar_retenciones. Sin borrar (se desactivan), salvo
-- las tarifas de ICA y los municipios de ICA de una empresa.
do $$
declare
  t text;
begin
  foreach t in array array['uvt', 'ica_actividades', 'municipios', 'ica_tarifas', 'retencion_conceptos',
                           'empresas_retenciones', 'empresas_reteica_municipios'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$create policy %I on public.%I for select to authenticated using ((select
        public.tiene_pestana((select auth.uid()), 'ayf.liquidacion')
        or public.tiene_accion((select auth.uid()), 'gestionar_retenciones')
        or public.es_admin((select auth.uid()))))$p$, t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
        with check ((select public.tiene_accion((select auth.uid()), 'gestionar_retenciones')))$p$, t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($p$create policy %I on public.%I for update to authenticated
        using ((select public.tiene_accion((select auth.uid()), 'gestionar_retenciones')))
        with check ((select public.tiene_accion((select auth.uid()), 'gestionar_retenciones')))$p$, t || '_update', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
  foreach t in array array['ica_tarifas', 'empresas_reteica_municipios'] loop
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
        using ((select public.tiene_accion((select auth.uid()), 'gestionar_retenciones')))$p$, t || '_delete', t);
    execute format('grant delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Perfil tributario: lo leen Terceros y Liquidación. Se escribe por funciones
-- (paso 3: guardar y verificar desde la ficha del tercero).
drop policy if exists terceros_tributario_select on public.terceros_tributario;
create policy terceros_tributario_select on public.terceros_tributario
  for select to authenticated
  using ((select
    public.tiene_pestana((select auth.uid()), 'ayf.terceros')
    or public.tiene_pestana((select auth.uid()), 'ayf.liquidacion')
  ));
revoke all on public.terceros_tributario from anon;
grant select on public.terceros_tributario to authenticated;

-- Extracción de RUT y memoria por tercero: sin acceso por la API.
revoke all on public.rut_extracciones, public.liquidacion_preferencias from anon, authenticated;

-- Liquidaciones: las ven quienes ven los pagos. Se escriben solo por las
-- funciones de arriba.
drop policy if exists pago_liquidaciones_select on public.pago_liquidaciones;
create policy pago_liquidaciones_select on public.pago_liquidaciones
  for select to authenticated
  using ((select
    public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
    or public.tiene_pestana((select auth.uid()), 'ayf.consolidado')
    or public.tiene_pestana((select auth.uid()), 'ayf.liquidacion')
  ));
drop policy if exists pago_liquidacion_lineas_select on public.pago_liquidacion_lineas;
create policy pago_liquidacion_lineas_select on public.pago_liquidacion_lineas
  for select to authenticated
  using (exists (select 1 from public.pago_liquidaciones l where l.id = liquidacion_id));
revoke all on public.pago_liquidaciones, public.pago_liquidacion_lineas from anon;
grant select on public.pago_liquidaciones, public.pago_liquidacion_lineas to authenticated;

-- Pagos, terceros y cuentas: también los lee Liquidación (mismas reglas que
-- 20261023000000_ayf_rls_initplan.sql, más esa pestaña).
drop policy if exists pagos_select on public.pagos;
create policy pagos_select on public.pagos
  for select to authenticated
  using ((select
    public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
    or public.tiene_pestana((select auth.uid()), 'ayf.consolidado')
    or public.tiene_pestana((select auth.uid()), 'ayf.liquidacion')
  ));

drop policy if exists terceros_select on public.terceros;
create policy terceros_select on public.terceros
  for select to authenticated
  using ((select
    public.tiene_pestana((select auth.uid()), 'ayf.terceros')
    or public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
    or public.tiene_pestana((select auth.uid()), 'ayf.consolidado')
    or public.tiene_pestana((select auth.uid()), 'ayf.liquidacion')
  ));

drop policy if exists terceros_cuentas_select on public.terceros_cuentas;
create policy terceros_cuentas_select on public.terceros_cuentas
  for select to authenticated
  using ((select
    public.tiene_pestana((select auth.uid()), 'ayf.terceros')
    or public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
    or public.tiene_pestana((select auth.uid()), 'ayf.consolidado')
    or public.tiene_pestana((select auth.uid()), 'ayf.liquidacion')
  ));

-- ===================================================================
-- 8. Rol y permisos
-- ===================================================================

insert into public.roles (clave, nombre, es_sistema, orden)
values ('contabilidad', 'Contabilidad', true, 56)
on conflict (clave) do nothing;

insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
from public.roles r
cross join (values
  ('tab.ayf.liquidacion'),
  ('tab.ayf.consolidado'),
  ('tab.ayf.terceros'),
  ('accion.liquidar_pagos'),
  ('accion.gestionar_retenciones')
) as p(permiso)
where r.clave = 'contabilidad'
on conflict do nothing;

-- ===================================================================
-- 9. Catálogos iniciales (tablas de Contabilidad, 2026)
-- ===================================================================

-- UVT 2026 (Resolución DIAN 000238 de 2025). Contabilidad la confirma.
insert into public.uvt (anio, valor) values (2026, 52374) on conflict (anio) do nothing;

insert into public.ica_actividades (clave, nombre, usa_base, orden) values
  ('compras',                 'Compras (de construcción)',          'compras',       10),
  ('industrial',              'Industrial',                         'compras',       20),
  ('construccion',            'Construcción',                       'servicios',     30),
  ('transporte',              'Transporte de carga',                'servicios',     40),
  ('mantenimiento',           'Servicios y mantenimientos generales','servicios',    50),
  ('mantenimiento_vehiculos', 'Mantenimiento de vehículos',         'servicios',     60),
  ('servicios_profesionales', 'Servicios profesionales',            'profesionales', 70),
  ('consultoria',             'Consultoría y arquitectura',         'profesionales', 80),
  ('arriendo_inmuebles',      'Arriendo de inmuebles',              'servicios',     90),
  ('arriendo_maquinaria',     'Arriendo de maquinaria',             'servicios',    100),
  ('hotel',                   'Hotel',                              'servicios',    110),
  ('restaurantes',            'Restaurantes',                       'servicios',    120),
  ('manipulacion_carga',      'Manipulación de carga',              'servicios',    130),
  ('laboratorio',             'Laboratorio y diagnóstico médico',   'servicios',    140)
on conflict (clave) do nothing;

-- Tarifas de la tabla "Retención en la fuente" de Contabilidad; bases según
-- lo que se practicó en las semanas 31 a 42 (compras 10 UVT, servicios 2 UVT).
insert into public.retencion_conceptos
  (clave, nombre, tarifa_declarante, tarifa_no_declarante, tarifa_juridica, base_uvt, natural_tabla_383, actividad_ica, orden) values
  ('compras',                'Compras en general',                                0.025, 0.035, null, 10, false, 'compras',                 10),
  ('servicios',              'Servicios en general',                              0.04,  0.06,  null,  2, false, 'mantenimiento',           20),
  ('transporte_carga',       'Transporte nacional de carga',                      0.01,  0.01,  null,  2, false, 'transporte',              30),
  ('transporte_pasajeros',   'Transporte nacional de pasajeros (terrestre)',      0.035, 0.035, null, 10, false, 'transporte',              40),
  ('construccion',           'Contratos de construcción y obra material',         0.02,  0.02,  null, 10, false, 'construccion',            50),
  ('arrendamiento_inmuebles','Arrendamiento de bienes inmuebles',                 0.035, 0.035, null, 10, false, 'arriendo_inmuebles',      60),
  ('arrendamiento_muebles',  'Arrendamiento de bienes muebles (equipos, maquinaria)', 0.04, 0.04, null, 0, false, 'arriendo_maquinaria',    70),
  ('honorarios',             'Honorarios y comisiones',                           0.10,  0.10,  0.11,  0, true,  'servicios_profesionales', 80),
  ('consultoria_obra',       'Consultoría en ingeniería de infraestructura y edificaciones', 0.06, 0.10, null, 0, false, 'consultoria', 90),
  ('hoteles_restaurantes',   'Hoteles, restaurantes y hospedajes',                0.035, 0.035, null,  2, false, 'hotel',                  100),
  ('combustibles',           'Combustibles derivados del petróleo',               0.001, 0.001, null,  0, false, 'compras',                110)
on conflict (clave) do nothing;

-- Municipios y tarifas de ReteICA (hoja "RETENCIÓN DE ICA" de Contabilidad).
insert into public.municipios (departamento, nombre, base_compras, base_servicios, base_profesionales, avisos_tableros_pct, sobretasa_bomberil_pct) values
  ('ARAUCA', 'ARAUCA', 1414000, 209000, null, null, null),
  ('ARAUCA', 'ARAUQUITA', 398000, 199000, null, null, null),
  ('ARAUCA', 'SARAVENA', 1414000, 209000, null, null, null),
  ('ARAUCA', 'FORTUL', null, null, null, null, null),
  ('ATLANTICO', 'BARRANQUILLA', 1414000, 209000, 209000, null, null),
  ('ATLANTICO', 'USIACURI', 1414000, 209000, null, null, null),
  ('ATLANTICO', 'BARANOA', 1414000, 209000, null, null, null),
  ('ATLANTICO', 'PIOJO', 1414000, 209000, null, 0.15, 0.07),
  ('ATLANTICO', 'JUAN DE ACOSTA', 1345000, 199000, null, null, null),
  ('BOGOTA', 'BOGOTA', 1414000, 209000, null, null, null),
  ('BOLIVAR', 'CARTAGENA', 367000, 367000, 6808620, null, 0.07),
  ('CESAR', 'SAN DIEGO', 1414000, 209000, null, null, null),
  ('CESAR', 'CHIRIGUANA', 1414000, 209000, null, null, null),
  ('CESAR', 'GONZALEZ', 1345000, 199000, null, null, null),
  ('CESAR', 'LA GLORIA', 52000, 52000, null, null, null),
  ('CESAR', 'LA PAZ', 1414000, 209000, null, null, null),
  ('CESAR', 'LA JAGUA', 1414000, 209000, null, null, null),
  ('CESAR', 'ASTREA', 524000, 105000, null, null, null),
  ('CESAR', 'EL COPEY', 786000, 786000, null, null, null),
  ('CESAR', 'CURUMANI', 2000000, 2000000, null, null, null),
  ('CESAR', 'CHIMICHAGUA', 524000, 105000, null, null, null),
  ('CORDOBA', 'PUERTO LIBERTADOR', 786000, 209000, null, null, null),
  ('CORDOBA', 'MONTELIBANO', 1423500, 1423500, null, null, null),
  ('CORDOBA', 'TIERRALTA', 1309000, 1309000, null, null, null),
  ('GUAJIRA', 'SAN JUAN DEL CESAR', 2000000, 2000000, null, null, null),
  ('GUAJIRA', 'FONSECA', 524000, 105000, null, null, null),
  ('GUAVIARE', 'SAN JOSE DEL GUAVIARE', 498000, 100000, null, null, null),
  ('META', 'PUERTO RICO', 1414000, 209000, null, null, null),
  ('META', 'VISTA HERMOSA', 1414000, 209000, null, null, null),
  ('META', 'PUERTO LLERAS', 524000, 105000, null, null, null),
  ('SAN ANDRES', 'PROVIDENCIA', 786000, 209000, null, 0.15, null)
on conflict (departamento, nombre) do nothing;

-- Columnas de la hoja: consultoría, industrial, servicios profesionales,
-- transporte de carga, construcción, compras de construcción, arriendo de
-- inmuebles, arriendo de maquinaria, hotel, manipulación de carga,
-- restaurantes, mantenimientos generales, mantenimiento de vehículos,
-- laboratorio. Las celdas vacías, "NA" o "CONDICIÓN" no se cargan.
insert into public.ica_tarifas (municipio_id, actividad_clave, tarifa)
select m.id, v.actividad, v.tarifa
from (values
  ('ARAUCA','ARAUCA','consultoria',0.01),('ARAUCA','ARAUCA','servicios_profesionales',0.008),('ARAUCA','ARAUCA','transporte',0.008),('ARAUCA','ARAUCA','construccion',0.01),('ARAUCA','ARAUCA','compras',0.006),('ARAUCA','ARAUCA','arriendo_inmuebles',0.008),('ARAUCA','ARAUCA','arriendo_maquinaria',0.01),('ARAUCA','ARAUCA','hotel',0.0085),('ARAUCA','ARAUCA','manipulacion_carga',0.008),('ARAUCA','ARAUCA','restaurantes',0.007),('ARAUCA','ARAUCA','mantenimiento',0.005),('ARAUCA','ARAUCA','mantenimiento_vehiculos',0.005),('ARAUCA','ARAUCA','laboratorio',0.006),
  ('ARAUCA','ARAUQUITA','consultoria',0.01),('ARAUCA','ARAUQUITA','servicios_profesionales',0.01),('ARAUCA','ARAUQUITA','transporte',0.005),('ARAUCA','ARAUQUITA','construccion',0.01),('ARAUCA','ARAUQUITA','compras',0.005),('ARAUCA','ARAUQUITA','arriendo_inmuebles',0.005),('ARAUCA','ARAUQUITA','arriendo_maquinaria',0.005),('ARAUCA','ARAUQUITA','hotel',0.008),('ARAUCA','ARAUQUITA','manipulacion_carga',0.01),('ARAUCA','ARAUQUITA','restaurantes',0.005),('ARAUCA','ARAUQUITA','mantenimiento',0.01),('ARAUCA','ARAUQUITA','mantenimiento_vehiculos',0.005),('ARAUCA','ARAUQUITA','laboratorio',0.008),
  ('ARAUCA','SARAVENA','consultoria',0.01),('ARAUCA','SARAVENA','servicios_profesionales',0.007),('ARAUCA','SARAVENA','transporte',0.006),('ARAUCA','SARAVENA','construccion',0.007),('ARAUCA','SARAVENA','compras',0.005),('ARAUCA','SARAVENA','arriendo_inmuebles',0.008),('ARAUCA','SARAVENA','arriendo_maquinaria',0.007),('ARAUCA','SARAVENA','hotel',0.006),('ARAUCA','SARAVENA','manipulacion_carga',0.007),('ARAUCA','SARAVENA','restaurantes',0.005),('ARAUCA','SARAVENA','mantenimiento',0.007),('ARAUCA','SARAVENA','mantenimiento_vehiculos',0.005),('ARAUCA','SARAVENA','laboratorio',0.007),
  ('ARAUCA','FORTUL','consultoria',0.01),('ARAUCA','FORTUL','servicios_profesionales',0.008),('ARAUCA','FORTUL','transporte',0.008),('ARAUCA','FORTUL','construccion',0.01),('ARAUCA','FORTUL','compras',0.007),('ARAUCA','FORTUL','arriendo_inmuebles',0.008),('ARAUCA','FORTUL','arriendo_maquinaria',0.01),('ARAUCA','FORTUL','hotel',0.01),('ARAUCA','FORTUL','manipulacion_carga',0.008),('ARAUCA','FORTUL','restaurantes',0.008),('ARAUCA','FORTUL','mantenimiento',0.008),('ARAUCA','FORTUL','mantenimiento_vehiculos',0.008),('ARAUCA','FORTUL','laboratorio',0.008),
  ('ATLANTICO','BARRANQUILLA','consultoria',0.0125),('ATLANTICO','BARRANQUILLA','servicios_profesionales',0.0125),('ATLANTICO','BARRANQUILLA','transporte',0.008),('ATLANTICO','BARRANQUILLA','construccion',0.0125),('ATLANTICO','BARRANQUILLA','compras',0.01),('ATLANTICO','BARRANQUILLA','arriendo_inmuebles',0.0125),('ATLANTICO','BARRANQUILLA','arriendo_maquinaria',0.01),('ATLANTICO','BARRANQUILLA','hotel',0.01),('ATLANTICO','BARRANQUILLA','manipulacion_carga',0.0125),('ATLANTICO','BARRANQUILLA','restaurantes',0.01),('ATLANTICO','BARRANQUILLA','mantenimiento',0.0125),('ATLANTICO','BARRANQUILLA','mantenimiento_vehiculos',0.0125),('ATLANTICO','BARRANQUILLA','laboratorio',0.008),
  ('ATLANTICO','USIACURI','consultoria',0.01),('ATLANTICO','USIACURI','servicios_profesionales',0),('ATLANTICO','USIACURI','transporte',0.009),('ATLANTICO','USIACURI','construccion',0.009),('ATLANTICO','USIACURI','compras',0.005),('ATLANTICO','USIACURI','arriendo_inmuebles',0.009),('ATLANTICO','USIACURI','arriendo_maquinaria',0.01),('ATLANTICO','USIACURI','hotel',0.01),('ATLANTICO','USIACURI','manipulacion_carga',0.01),('ATLANTICO','USIACURI','restaurantes',0.01),('ATLANTICO','USIACURI','mantenimiento',0.01),('ATLANTICO','USIACURI','mantenimiento_vehiculos',0.01),('ATLANTICO','USIACURI','laboratorio',0.01),
  ('ATLANTICO','BARANOA','consultoria',0.009),('ATLANTICO','BARANOA','servicios_profesionales',0.01),('ATLANTICO','BARANOA','transporte',0.01),('ATLANTICO','BARANOA','construccion',0.009),('ATLANTICO','BARANOA','compras',0.0055),('ATLANTICO','BARANOA','arriendo_inmuebles',0.01),('ATLANTICO','BARANOA','arriendo_maquinaria',0.01),('ATLANTICO','BARANOA','hotel',0.01),('ATLANTICO','BARANOA','manipulacion_carga',0.009),('ATLANTICO','BARANOA','restaurantes',0.01),('ATLANTICO','BARANOA','mantenimiento',0.008),('ATLANTICO','BARANOA','mantenimiento_vehiculos',0.01),('ATLANTICO','BARANOA','laboratorio',0.009),
  ('ATLANTICO','PIOJO','consultoria',0.0085),('ATLANTICO','PIOJO','servicios_profesionales',0.009),('ATLANTICO','PIOJO','transporte',0.005),('ATLANTICO','PIOJO','construccion',0.0085),('ATLANTICO','PIOJO','compras',0.006),('ATLANTICO','PIOJO','arriendo_inmuebles',0.009),('ATLANTICO','PIOJO','arriendo_maquinaria',0.005),('ATLANTICO','PIOJO','hotel',0.01),('ATLANTICO','PIOJO','manipulacion_carga',0.009),('ATLANTICO','PIOJO','restaurantes',0.005),('ATLANTICO','PIOJO','mantenimiento',0.006),('ATLANTICO','PIOJO','mantenimiento_vehiculos',0.006),('ATLANTICO','PIOJO','laboratorio',0.004),
  ('ATLANTICO','JUAN DE ACOSTA','consultoria',0.01),('ATLANTICO','JUAN DE ACOSTA','transporte',0.009),('ATLANTICO','JUAN DE ACOSTA','construccion',0.009),('ATLANTICO','JUAN DE ACOSTA','compras',0.007),('ATLANTICO','JUAN DE ACOSTA','arriendo_inmuebles',0.01),('ATLANTICO','JUAN DE ACOSTA','arriendo_maquinaria',0.01),('ATLANTICO','JUAN DE ACOSTA','hotel',0.01),('ATLANTICO','JUAN DE ACOSTA','manipulacion_carga',0.008),('ATLANTICO','JUAN DE ACOSTA','restaurantes',0.01),('ATLANTICO','JUAN DE ACOSTA','mantenimiento',0.008),('ATLANTICO','JUAN DE ACOSTA','mantenimiento_vehiculos',0.008),('ATLANTICO','JUAN DE ACOSTA','laboratorio',0.01),
  ('BOGOTA','BOGOTA','consultoria',0.00866),('BOGOTA','BOGOTA','servicios_profesionales',0.00766),('BOGOTA','BOGOTA','transporte',0.00414),('BOGOTA','BOGOTA','construccion',0.0076),('BOGOTA','BOGOTA','compras',0.0069),('BOGOTA','BOGOTA','arriendo_inmuebles',0.00966),('BOGOTA','BOGOTA','arriendo_maquinaria',0.00966),('BOGOTA','BOGOTA','hotel',0.0138),('BOGOTA','BOGOTA','manipulacion_carga',0.00966),('BOGOTA','BOGOTA','restaurantes',0.0138),('BOGOTA','BOGOTA','mantenimiento',0.00966),('BOGOTA','BOGOTA','mantenimiento_vehiculos',0.00966),('BOGOTA','BOGOTA','laboratorio',0.00966),
  ('BOLIVAR','CARTAGENA','consultoria',0.00321),('BOLIVAR','CARTAGENA','servicios_profesionales',0.00321),('BOLIVAR','CARTAGENA','transporte',0.00856),('BOLIVAR','CARTAGENA','construccion',0.00856),('BOLIVAR','CARTAGENA','compras',0.00749),('BOLIVAR','CARTAGENA','arriendo_inmuebles',0.00856),('BOLIVAR','CARTAGENA','arriendo_maquinaria',0.00856),('BOLIVAR','CARTAGENA','hotel',0.00642),('BOLIVAR','CARTAGENA','manipulacion_carga',0.00856),('BOLIVAR','CARTAGENA','restaurantes',0.00749),('BOLIVAR','CARTAGENA','mantenimiento',0.00856),('BOLIVAR','CARTAGENA','mantenimiento_vehiculos',0.00856),('BOLIVAR','CARTAGENA','laboratorio',0.00856),
  ('CESAR','SAN DIEGO','consultoria',0.007),('CESAR','SAN DIEGO','servicios_profesionales',0.01),('CESAR','SAN DIEGO','transporte',0.005),('CESAR','SAN DIEGO','construccion',0.007),('CESAR','SAN DIEGO','compras',0.007),('CESAR','SAN DIEGO','arriendo_inmuebles',0.01),('CESAR','SAN DIEGO','arriendo_maquinaria',0.01),('CESAR','SAN DIEGO','hotel',0.01),('CESAR','SAN DIEGO','manipulacion_carga',0.01),('CESAR','SAN DIEGO','restaurantes',0.01),('CESAR','SAN DIEGO','mantenimiento',0.01),('CESAR','SAN DIEGO','mantenimiento_vehiculos',0.007),('CESAR','SAN DIEGO','laboratorio',0.01),
  ('CESAR','CHIRIGUANA','consultoria',0.01),('CESAR','CHIRIGUANA','transporte',0.01),('CESAR','CHIRIGUANA','construccion',0.01),('CESAR','CHIRIGUANA','compras',0.007),('CESAR','CHIRIGUANA','arriendo_inmuebles',0.009),('CESAR','CHIRIGUANA','arriendo_maquinaria',0.01),('CESAR','CHIRIGUANA','hotel',0.01),('CESAR','CHIRIGUANA','manipulacion_carga',0.01),('CESAR','CHIRIGUANA','restaurantes',0.008),('CESAR','CHIRIGUANA','mantenimiento',0.008),('CESAR','CHIRIGUANA','mantenimiento_vehiculos',0.008),('CESAR','CHIRIGUANA','laboratorio',0.005),
  ('CESAR','GONZALEZ','consultoria',0.01),('CESAR','GONZALEZ','servicios_profesionales',0.01),('CESAR','GONZALEZ','transporte',0.01),('CESAR','GONZALEZ','construccion',0.01),('CESAR','GONZALEZ','compras',0.01),('CESAR','GONZALEZ','arriendo_inmuebles',0.01),('CESAR','GONZALEZ','arriendo_maquinaria',0.01),('CESAR','GONZALEZ','hotel',0.01),('CESAR','GONZALEZ','manipulacion_carga',0.01),('CESAR','GONZALEZ','restaurantes',0.005),('CESAR','GONZALEZ','mantenimiento',0.01),('CESAR','GONZALEZ','mantenimiento_vehiculos',0.005),('CESAR','GONZALEZ','laboratorio',0.01),
  ('CESAR','LA GLORIA','consultoria',0.01),('CESAR','LA GLORIA','servicios_profesionales',0.01),('CESAR','LA GLORIA','transporte',0.01),('CESAR','LA GLORIA','construccion',0.01),('CESAR','LA GLORIA','compras',0.01),('CESAR','LA GLORIA','arriendo_inmuebles',0.01),('CESAR','LA GLORIA','arriendo_maquinaria',0.01),('CESAR','LA GLORIA','hotel',0.01),('CESAR','LA GLORIA','manipulacion_carga',0.01),('CESAR','LA GLORIA','restaurantes',0.008),('CESAR','LA GLORIA','mantenimiento',0.006),('CESAR','LA GLORIA','mantenimiento_vehiculos',0.006),('CESAR','LA GLORIA','laboratorio',0.01),
  ('CESAR','LA PAZ','consultoria',0.01),('CESAR','LA PAZ','servicios_profesionales',0.007),('CESAR','LA PAZ','transporte',0.01),('CESAR','LA PAZ','construccion',0.007),('CESAR','LA PAZ','compras',0.008),('CESAR','LA PAZ','arriendo_inmuebles',0.007),('CESAR','LA PAZ','arriendo_maquinaria',0.01),('CESAR','LA PAZ','hotel',0.007),('CESAR','LA PAZ','manipulacion_carga',0.01),('CESAR','LA PAZ','restaurantes',0.005),('CESAR','LA PAZ','mantenimiento',0.007),('CESAR','LA PAZ','mantenimiento_vehiculos',0.007),('CESAR','LA PAZ','laboratorio',0.01),
  ('CESAR','LA JAGUA','servicios_profesionales',0.01),('CESAR','LA JAGUA','transporte',0.007),('CESAR','LA JAGUA','construccion',0.01),('CESAR','LA JAGUA','compras',0.01),('CESAR','LA JAGUA','arriendo_inmuebles',0.007),('CESAR','LA JAGUA','arriendo_maquinaria',0.007),('CESAR','LA JAGUA','hotel',0.01),('CESAR','LA JAGUA','manipulacion_carga',0.01),('CESAR','LA JAGUA','restaurantes',0.006),('CESAR','LA JAGUA','mantenimiento',0.01),('CESAR','LA JAGUA','mantenimiento_vehiculos',0.01),('CESAR','LA JAGUA','laboratorio',0.007),
  ('CESAR','ASTREA','consultoria',0.005),('CESAR','ASTREA','industrial',0.007),('CESAR','ASTREA','servicios_profesionales',0.004),('CESAR','ASTREA','transporte',0.01),('CESAR','ASTREA','construccion',0.005),('CESAR','ASTREA','compras',0.006),('CESAR','ASTREA','arriendo_inmuebles',0.006),('CESAR','ASTREA','arriendo_maquinaria',0.006),('CESAR','ASTREA','hotel',0.005),('CESAR','ASTREA','manipulacion_carga',0.006),('CESAR','ASTREA','restaurantes',0.005),('CESAR','ASTREA','mantenimiento',0.006),('CESAR','ASTREA','mantenimiento_vehiculos',0.006),('CESAR','ASTREA','laboratorio',0.006),
  ('CESAR','EL COPEY','consultoria',0.01),('CESAR','EL COPEY','servicios_profesionales',0.01),('CESAR','EL COPEY','transporte',0.01),('CESAR','EL COPEY','construccion',0.01),('CESAR','EL COPEY','compras',0.007),('CESAR','EL COPEY','arriendo_maquinaria',0.01),('CESAR','EL COPEY','hotel',0.01),('CESAR','EL COPEY','manipulacion_carga',0.01),('CESAR','EL COPEY','restaurantes',0.007),('CESAR','EL COPEY','mantenimiento',0.007),('CESAR','EL COPEY','mantenimiento_vehiculos',0.01),('CESAR','EL COPEY','laboratorio',0.008),
  ('CESAR','CURUMANI','consultoria',0.007),('CESAR','CURUMANI','servicios_profesionales',0.01),('CESAR','CURUMANI','transporte',0.01),('CESAR','CURUMANI','construccion',0.01),('CESAR','CURUMANI','compras',0.01),('CESAR','CURUMANI','arriendo_inmuebles',0.01),('CESAR','CURUMANI','arriendo_maquinaria',0.01),('CESAR','CURUMANI','hotel',0.01),('CESAR','CURUMANI','manipulacion_carga',0.01),('CESAR','CURUMANI','restaurantes',0.01),('CESAR','CURUMANI','mantenimiento',0.01),('CESAR','CURUMANI','mantenimiento_vehiculos',0.01),('CESAR','CURUMANI','laboratorio',0.01),
  ('CESAR','CHIMICHAGUA','consultoria',0.0042),('CESAR','CHIMICHAGUA','servicios_profesionales',0.0042),('CESAR','CHIMICHAGUA','transporte',0.0042),('CESAR','CHIMICHAGUA','construccion',0.0042),('CESAR','CHIMICHAGUA','compras',0.0042),('CESAR','CHIMICHAGUA','arriendo_inmuebles',0.0042),('CESAR','CHIMICHAGUA','arriendo_maquinaria',0.0042),('CESAR','CHIMICHAGUA','hotel',0.0042),('CESAR','CHIMICHAGUA','manipulacion_carga',0.0042),('CESAR','CHIMICHAGUA','restaurantes',0.0042),('CESAR','CHIMICHAGUA','mantenimiento',0.0042),('CESAR','CHIMICHAGUA','mantenimiento_vehiculos',0.0042),('CESAR','CHIMICHAGUA','laboratorio',0.0042),
  ('CORDOBA','PUERTO LIBERTADOR','consultoria',0.01),('CORDOBA','PUERTO LIBERTADOR','servicios_profesionales',0.01),('CORDOBA','PUERTO LIBERTADOR','transporte',0.01),('CORDOBA','PUERTO LIBERTADOR','construccion',0.01),('CORDOBA','PUERTO LIBERTADOR','compras',0.01),('CORDOBA','PUERTO LIBERTADOR','arriendo_inmuebles',0.01),('CORDOBA','PUERTO LIBERTADOR','arriendo_maquinaria',0.01),('CORDOBA','PUERTO LIBERTADOR','hotel',0.01),('CORDOBA','PUERTO LIBERTADOR','manipulacion_carga',0.01),('CORDOBA','PUERTO LIBERTADOR','restaurantes',0.01),('CORDOBA','PUERTO LIBERTADOR','mantenimiento',0.01),('CORDOBA','PUERTO LIBERTADOR','mantenimiento_vehiculos',0.01),('CORDOBA','PUERTO LIBERTADOR','laboratorio',0.005),
  ('CORDOBA','MONTELIBANO','consultoria',0.0085),('CORDOBA','MONTELIBANO','servicios_profesionales',0.0085),('CORDOBA','MONTELIBANO','transporte',0.0075),('CORDOBA','MONTELIBANO','construccion',0.0085),('CORDOBA','MONTELIBANO','compras',0.006),('CORDOBA','MONTELIBANO','arriendo_inmuebles',0.0055),('CORDOBA','MONTELIBANO','arriendo_maquinaria',0.0055),('CORDOBA','MONTELIBANO','hotel',0.01),('CORDOBA','MONTELIBANO','manipulacion_carga',0.009),('CORDOBA','MONTELIBANO','restaurantes',0.0045),('CORDOBA','MONTELIBANO','mantenimiento',0.0075),('CORDOBA','MONTELIBANO','mantenimiento_vehiculos',0.006),('CORDOBA','MONTELIBANO','laboratorio',0.004),
  ('CORDOBA','TIERRALTA','consultoria',0.008),('CORDOBA','TIERRALTA','servicios_profesionales',0.007),('CORDOBA','TIERRALTA','transporte',0.008),('CORDOBA','TIERRALTA','construccion',0.008),('CORDOBA','TIERRALTA','compras',0.007),('CORDOBA','TIERRALTA','arriendo_inmuebles',0.007),('CORDOBA','TIERRALTA','arriendo_maquinaria',0.008),('CORDOBA','TIERRALTA','hotel',0.01),('CORDOBA','TIERRALTA','manipulacion_carga',0.008),('CORDOBA','TIERRALTA','restaurantes',0.01),('CORDOBA','TIERRALTA','mantenimiento',0.008),('CORDOBA','TIERRALTA','mantenimiento_vehiculos',0.008),('CORDOBA','TIERRALTA','laboratorio',0.008),
  ('GUAJIRA','SAN JUAN DEL CESAR','servicios_profesionales',0.01),('GUAJIRA','SAN JUAN DEL CESAR','transporte',0.01),('GUAJIRA','SAN JUAN DEL CESAR','construccion',0.01),('GUAJIRA','SAN JUAN DEL CESAR','compras',0.01),('GUAJIRA','SAN JUAN DEL CESAR','arriendo_inmuebles',0.009),('GUAJIRA','SAN JUAN DEL CESAR','arriendo_maquinaria',0.01),('GUAJIRA','SAN JUAN DEL CESAR','hotel',0.007),('GUAJIRA','SAN JUAN DEL CESAR','manipulacion_carga',0.01),('GUAJIRA','SAN JUAN DEL CESAR','restaurantes',0.007),('GUAJIRA','SAN JUAN DEL CESAR','mantenimiento',0.01),('GUAJIRA','SAN JUAN DEL CESAR','mantenimiento_vehiculos',0.01),('GUAJIRA','SAN JUAN DEL CESAR','laboratorio',0.01),
  ('GUAJIRA','FONSECA','servicios_profesionales',0.01),('GUAJIRA','FONSECA','transporte',0.008),('GUAJIRA','FONSECA','construccion',0.01),('GUAJIRA','FONSECA','compras',0.007),('GUAJIRA','FONSECA','arriendo_inmuebles',0.008),('GUAJIRA','FONSECA','arriendo_maquinaria',0.01),('GUAJIRA','FONSECA','hotel',0.01),('GUAJIRA','FONSECA','manipulacion_carga',0.01),('GUAJIRA','FONSECA','restaurantes',0.008),('GUAJIRA','FONSECA','mantenimiento',0.008),('GUAJIRA','FONSECA','mantenimiento_vehiculos',0.008),('GUAJIRA','FONSECA','laboratorio',0.01),
  ('GUAVIARE','SAN JOSE DEL GUAVIARE','transporte',0.007),('GUAVIARE','SAN JOSE DEL GUAVIARE','construccion',0.008),('GUAVIARE','SAN JOSE DEL GUAVIARE','compras',0.008),('GUAVIARE','SAN JOSE DEL GUAVIARE','arriendo_inmuebles',0.005),('GUAVIARE','SAN JOSE DEL GUAVIARE','arriendo_maquinaria',0.008),('GUAVIARE','SAN JOSE DEL GUAVIARE','hotel',0.005),('GUAVIARE','SAN JOSE DEL GUAVIARE','manipulacion_carga',0.007),('GUAVIARE','SAN JOSE DEL GUAVIARE','restaurantes',0.007),('GUAVIARE','SAN JOSE DEL GUAVIARE','mantenimiento',0.008),('GUAVIARE','SAN JOSE DEL GUAVIARE','mantenimiento_vehiculos',0.007),('GUAVIARE','SAN JOSE DEL GUAVIARE','laboratorio',0.01),
  ('META','PUERTO RICO','servicios_profesionales',0.006),('META','PUERTO RICO','transporte',0.005),('META','PUERTO RICO','construccion',0.01),('META','PUERTO RICO','compras',0.006),('META','PUERTO RICO','arriendo_inmuebles',0.006),('META','PUERTO RICO','arriendo_maquinaria',0.005),('META','PUERTO RICO','hotel',0.005),('META','PUERTO RICO','manipulacion_carga',0.01),('META','PUERTO RICO','restaurantes',0.01),('META','PUERTO RICO','mantenimiento',0.007),('META','PUERTO RICO','mantenimiento_vehiculos',0.005),('META','PUERTO RICO','laboratorio',0.005),
  ('META','VISTA HERMOSA','servicios_profesionales',0.01),('META','VISTA HERMOSA','transporte',0.006),('META','VISTA HERMOSA','construccion',0.01),('META','VISTA HERMOSA','compras',0.006),('META','VISTA HERMOSA','arriendo_inmuebles',0.006),('META','VISTA HERMOSA','arriendo_maquinaria',0.006),('META','VISTA HERMOSA','hotel',0.006),('META','VISTA HERMOSA','manipulacion_carga',0.006),('META','VISTA HERMOSA','restaurantes',0.006),('META','VISTA HERMOSA','mantenimiento',0.01),('META','VISTA HERMOSA','mantenimiento_vehiculos',0.006),('META','VISTA HERMOSA','laboratorio',0.006),
  ('META','PUERTO LLERAS','servicios_profesionales',0.01),('META','PUERTO LLERAS','transporte',0.007),('META','PUERTO LLERAS','construccion',0.01),('META','PUERTO LLERAS','compras',0.007),('META','PUERTO LLERAS','arriendo_inmuebles',0.008),('META','PUERTO LLERAS','arriendo_maquinaria',0.009),('META','PUERTO LLERAS','hotel',0.01),('META','PUERTO LLERAS','manipulacion_carga',0.007),('META','PUERTO LLERAS','restaurantes',0.006),('META','PUERTO LLERAS','mantenimiento',0.007),('META','PUERTO LLERAS','mantenimiento_vehiculos',0.007),('META','PUERTO LLERAS','laboratorio',0.009),
  ('SAN ANDRES','PROVIDENCIA','consultoria',0.01),('SAN ANDRES','PROVIDENCIA','industrial',0.01),('SAN ANDRES','PROVIDENCIA','servicios_profesionales',0.01),('SAN ANDRES','PROVIDENCIA','transporte',0.01),('SAN ANDRES','PROVIDENCIA','construccion',0.01),('SAN ANDRES','PROVIDENCIA','compras',0.01),('SAN ANDRES','PROVIDENCIA','arriendo_inmuebles',0.01),('SAN ANDRES','PROVIDENCIA','arriendo_maquinaria',0.01),('SAN ANDRES','PROVIDENCIA','hotel',0.01),('SAN ANDRES','PROVIDENCIA','manipulacion_carga',0.01),('SAN ANDRES','PROVIDENCIA','restaurantes',0.01),('SAN ANDRES','PROVIDENCIA','mantenimiento',0.01),('SAN ANDRES','PROVIDENCIA','mantenimiento_vehiculos',0.01),('SAN ANDRES','PROVIDENCIA','laboratorio',0.01)
) as v(departamento, municipio, actividad, tarifa)
join public.municipios m on m.departamento = v.departamento and m.nombre = v.municipio
on conflict (municipio_id, actividad_clave) do nothing;

-- Municipio de ICA de los proyectos: por la ciudad del proyecto y, si no,
-- por el código (100-PP-CTG-..., 900-CS-ARA-...). Los que no cuadren se
-- asignan a mano.
update public.proyectos p
   set municipio_ica_id = m.id
  from public.municipios m
 where p.municipio_ica_id is null
   and public._clave_nombre_empresa(p.ciudad) = public._clave_nombre_empresa(m.nombre);

update public.proyectos p
   set municipio_ica_id = m.id
  from (values ('CTG', 'BOLIVAR', 'CARTAGENA'), ('BAQ', 'ATLANTICO', 'BARRANQUILLA'),
               ('ARA', 'ARAUCA', 'ARAUCA'), ('AQT', 'ARAUCA', 'ARAUQUITA'),
               ('SAR', 'ARAUCA', 'SARAVENA'), ('BOG', 'BOGOTA', 'BOGOTA')) as c(codigo, departamento, municipio)
  join public.municipios m on m.departamento = c.departamento and m.nombre = c.municipio
 where p.municipio_ica_id is null
   and upper(coalesce(p.codigo, '')) ~ ('(^|-)' || c.codigo || '(-|$| )');
