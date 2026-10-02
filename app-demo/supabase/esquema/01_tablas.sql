-- ---------------------------------------------------------------------------
-- Esquema REAL de la base de producción (proyecto Supabase "App-demo"),
-- sacado con solo lectura el 2026-10-02. Ver supabase/esquema/README.md.
-- Orden: 01_tablas -> 02_funciones_* -> 03_restricciones -> 04_seguridad.
-- No es una migración: no aplicar sobre la base real.
-- ---------------------------------------------------------------------------

create extension if not exists pg_trgm with schema public;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

create sequence if not exists public.maestro_insumos_codigo_seq;
create sequence if not exists public.ordenes_compra_numero_seq;
create sequence if not exists public.pedidos_insumos_codigo_seq;
create sequence if not exists public.requisiciones_numero_seq;

create table public.apu (
  id uuid default gen_random_uuid() not null,
  codigo text,
  descripcion text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  version bigint,
  presupuesto_id uuid
);

create table public.apu_import_revision (
  id uuid default gen_random_uuid() not null,
  lote_import_id uuid not null,
  presupuesto_item_id uuid not null,
  apu_id uuid not null,
  descripcion_original text not null,
  tipo text,
  unidad text,
  cantidad numeric not null,
  candidatos jsonb not null,
  estado text default 'pendiente'::text not null,
  insumo_id_asignado uuid,
  item_apu_id uuid,
  created_at timestamp with time zone default now() not null,
  solicitud_id uuid,
  mano_obra_categoria_id_asignado uuid,
  solicitud_mano_obra_id uuid,
  equipo_categoria_id_asignado uuid,
  solicitud_equipo_id uuid,
  rendimiento numeric
);

create table public.contratista_documentos (
  id uuid default gen_random_uuid() not null,
  contratista_id uuid not null,
  tipo text not null,
  ruta text not null,
  nombre_archivo text not null,
  tamano bigint not null,
  mime text not null,
  subido_por uuid default auth.uid(),
  subido_at timestamp with time zone default now() not null
);

create table public.contratistas (
  id uuid default gen_random_uuid() not null,
  tipo_persona text not null,
  tipo_documento text not null,
  numero_documento text not null,
  digito_verificacion smallint,
  nombre text not null,
  representante_nombre text,
  representante_tipo_documento text,
  representante_numero_documento text,
  correo text not null,
  telefono text not null,
  direccion text not null,
  ciudad text not null,
  banco text not null,
  tipo_cuenta text not null,
  numero_cuenta text not null,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.contrato_anexo_items (
  id uuid default gen_random_uuid() not null,
  contrato_id uuid not null,
  orden integer not null,
  actividad text not null,
  unidad text not null,
  cantidad numeric(18,4) not null,
  valor_unitario numeric(18,2) not null,
  presupuesto_item_id uuid not null
);

create table public.contrato_documentos (
  id uuid default gen_random_uuid() not null,
  contrato_id uuid not null,
  tipo text not null,
  ruta text not null,
  nombre_archivo text not null,
  tamano bigint not null,
  mime text not null,
  subido_por uuid default auth.uid(),
  subido_at timestamp with time zone default now() not null
);

create table public.contrato_entregables (
  id uuid default gen_random_uuid() not null,
  contrato_id uuid not null,
  orden integer not null,
  texto text not null
);

create table public.contrato_obligaciones (
  id uuid default gen_random_uuid() not null,
  contrato_id uuid not null,
  orden integer not null,
  texto text not null
);

create table public.contratos (
  id uuid default gen_random_uuid() not null,
  numero bigint generated always as identity not null,
  proyecto_id uuid not null,
  contratista_id uuid not null,
  tipo text not null,
  estado text default 'pre_aprobacion'::text not null,
  objeto text not null,
  valor numeric(18,2) not null,
  anexo_tipo text not null,
  tiene_anticipo boolean default false not null,
  anticipo_porcentaje numeric(5,2),
  forma_pago text not null,
  plazo_tipo text not null,
  fecha_inicio date,
  fecha_fin date,
  duracion_cantidad integer,
  duracion_unidad text,
  correo_notificacion text not null,
  observaciones text,
  solicitado_por uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  enviado_at timestamp with time zone default now() not null,
  resuelto_por uuid,
  resuelto_at timestamp with time zone,
  motivo_resolucion text,
  minuta_datos jsonb,
  minuta_actualizada_at timestamp with time zone,
  minuta_actualizada_por uuid,
  valor_mensual numeric(18,2)
);

create table public.empresas (
  id uuid default gen_random_uuid() not null,
  nit text not null,
  razon_social text not null,
  created_at timestamp with time zone default now() not null,
  logo_url text
);

create table public.empresas_cuentas_bancarias (
  id uuid default gen_random_uuid() not null,
  empresa_id uuid not null,
  banco text not null,
  tipo_cuenta text,
  numero_cuenta text not null,
  representante_legal text,
  representante_cedula text,
  preferencial boolean default false not null,
  created_at timestamp with time zone default now() not null
);

create table public.entradas_almacen (
  id uuid default gen_random_uuid() not null,
  numero bigint generated always as identity not null,
  orden_compra_id uuid not null,
  remision text,
  observaciones text,
  recibido_por uuid,
  created_at timestamp with time zone default now() not null,
  anulada_at timestamp with time zone,
  anulada_por uuid,
  motivo_anulacion text,
  editada_at timestamp with time zone,
  editada_por uuid
);

create table public.entradas_almacen_items (
  id uuid default gen_random_uuid() not null,
  entrada_id uuid not null,
  orden_compra_item_id uuid not null,
  cantidad numeric not null,
  cantidad_original numeric
);

create table public.equipo_categorias (
  id uuid default gen_random_uuid() not null,
  grupo text,
  categoria text not null,
  unidad text default 'HORA'::text not null,
  valor_unitario numeric,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.grupo_proyectos (
  grupo_id uuid not null,
  proyecto_id uuid not null,
  puede_editar boolean default false not null
);

create table public.grupos (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  ve_todos_proyectos boolean default false not null,
  puede_editar_todos boolean default false not null,
  created_at timestamp with time zone default now() not null
);

create table public.historial_eventos (
  id uuid default gen_random_uuid() not null,
  entidad_tipo text not null,
  entidad_id uuid not null,
  evento text not null,
  usuario_id uuid,
  motivo text,
  datos jsonb,
  created_at timestamp with time zone default now() not null
);

create table public.historico_precios_compra (
  id uuid default gen_random_uuid() not null,
  insumo_id uuid not null,
  precio_unitario numeric not null,
  porcentaje_descuento numeric default 0 not null,
  fecha_compra date not null,
  proyecto_texto text,
  fuente text default 'migracion_historica'::text not null,
  created_at timestamp with time zone default now() not null,
  iva_monto numeric default 0 not null
);

create table public.informacion_bancaria (
  id uuid default gen_random_uuid() not null,
  id_proveedor uuid default gen_random_uuid(),
  created_at timestamp with time zone default now() not null,
  titular text,
  entidad_bancaria text,
  tipo_cuenta text,
  no_cuenta text
);

create table public.item_apu (
  id uuid default gen_random_uuid() not null,
  apu_id uuid not null,
  insumo_id uuid,
  cantidad numeric(12,4) not null,
  tipo text,
  rendimiento numeric(18,4) default 1 not null,
  mano_obra_categoria_id uuid,
  porcentaje_mano_obra numeric,
  equipo_categoria_id uuid,
  transporte_precio_id uuid,
  precio_unitario_congelado numeric
);

create table public.maestro_insumos (
  id uuid default gen_random_uuid() not null,
  codigo integer default nextval('maestro_insumos_codigo_seq'::regclass) not null,
  descripcion text not null,
  tipo text,
  u_m text,
  agrupacion text,
  vr_unitario numeric(18,2),
  iva_porcentaje integer,
  vr_neto numeric(18,2),
  iva_descontable boolean,
  excluye_iva boolean,
  usuario_modificacion text,
  fecha_modificacion date,
  created_at timestamp with time zone default now() not null
);

create table public.mano_obra_categorias (
  id uuid default gen_random_uuid() not null,
  grupo text,
  categoria text not null,
  unidad text default 'HORA'::text not null,
  valor_unitario numeric,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.notificaciones (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  tipo text not null,
  entidad_tipo text not null,
  entidad_id uuid not null,
  titulo text not null,
  mensaje text not null,
  leida boolean default false not null,
  created_at timestamp with time zone default now() not null
);

create table public.ordenes_compra (
  id uuid default gen_random_uuid() not null,
  numero integer default nextval('ordenes_compra_numero_seq'::regclass) not null,
  proyecto_id uuid not null,
  proveedor_id uuid not null,
  sitio_entrega text,
  fecha_entrega date,
  contacto_nombre text,
  telefono text,
  ciudad text,
  email text,
  enviada boolean default false not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  estado text default 'pendiente_aprobacion'::text not null,
  aprobada_por uuid,
  aprobada_at timestamp with time zone,
  motivo_rechazo text,
  condiciones_pago text,
  observaciones text,
  estado_entrega text default 'sin_entregar'::text not null,
  desaprobada_at timestamp with time zone,
  desaprobada_por uuid,
  motivo_desaprobacion text,
  cancelada_at timestamp with time zone,
  cancelada_por uuid,
  motivo_cancelacion text
);

create table public.ordenes_compra_items (
  id uuid default gen_random_uuid() not null,
  orden_compra_id uuid not null,
  pedido_insumo_id uuid not null,
  cantidad numeric not null,
  created_at timestamp with time zone default now() not null,
  precio_unitario numeric default 0 not null,
  porcentaje_descuento numeric default 0 not null,
  porcentaje_iva numeric default 0 not null
);

create table public.pedidos_insumos (
  id uuid default gen_random_uuid() not null,
  grupo_pedido_id uuid not null,
  presupuesto_item_id uuid not null,
  insumo_id uuid not null,
  item_apu_id uuid,
  cantidad numeric not null,
  fecha_requerida date not null,
  urgente boolean default false not null,
  observaciones text,
  soporte_url text,
  estado text default 'pendiente'::text not null,
  solicitado_por uuid not null,
  created_at timestamp with time zone default now() not null,
  resuelto_por uuid,
  resuelto_at timestamp with time zone,
  comentario_resolucion text,
  codigo_consecutivo integer default nextval('pedidos_insumos_codigo_seq'::regclass) not null,
  proyecto_id uuid,
  cantidad_comprar numeric,
  rechazado_compras_at timestamp with time zone,
  rechazado_compras_por uuid,
  observaciones_compras text,
  orden_compra_id uuid,
  desaprobado_at timestamp with time zone,
  desaprobado_por uuid,
  motivo_desaprobacion text,
  cancelado_at timestamp with time zone,
  cancelado_por uuid,
  motivo_cancelacion text
);

create table public.perfiles (
  id uuid not null,
  nombre text not null,
  es_admin boolean default false not null,
  created_at timestamp with time zone default now() not null,
  admin_insumos boolean default false not null,
  admin_proyectos boolean default false not null,
  admin_usuarios boolean default false not null,
  rol_compras boolean default false not null,
  admin_mano_obra boolean default false not null,
  email text,
  username text not null,
  rol_id uuid,
  todos_los_proyectos boolean default false not null
);

create table public.presupuesto_items (
  id uuid default gen_random_uuid() not null,
  presupuesto_id uuid not null,
  padre_id uuid,
  nivel integer not null,
  codigo text not null,
  descripcion text not null,
  unidad text,
  cantidad numeric(14,4),
  valor_unitario numeric(14,2),
  valor_total numeric(14,2),
  created_at timestamp with time zone default now() not null,
  apu_id uuid,
  version_id uuid,
  precio_original numeric(18,2)
);

create table public.presupuesto_versiones (
  id uuid default gen_random_uuid() not null,
  presupuesto_id uuid not null,
  numero integer not null,
  nombre text not null,
  creado_en timestamp with time zone default now() not null
);

create table public.presupuestos (
  id uuid default gen_random_uuid() not null,
  proyecto_id uuid,
  nombre text not null,
  monto_total numeric,
  estado text default 'Borrador'::text not null,
  created_at timestamp with time zone default now() not null,
  version_actual_id uuid
);

create table public.proveedores (
  unique_id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  nombre text not null,
  id_prov text,
  tipo_documento text,
  numero_documento bigint,
  digito_verificacion bigint,
  nombre_contacto text,
  telefono text,
  correo text,
  ciudad text,
  direccion text,
  estado text,
  tipo_proveedor text
);

create table public.proyectos (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  cliente text,
  created_at timestamp with time zone default now() not null,
  codigo text,
  empresa_id uuid,
  ciudad text
);

create table public.requisiciones (
  id uuid not null,
  numero bigint default nextval('requisiciones_numero_seq'::regclass) not null,
  proyecto_id uuid,
  solicitado_por uuid,
  fecha_requerida date,
  urgente boolean default false not null,
  observaciones text,
  soporte_url text,
  created_at timestamp with time zone default now() not null
);

create table public.rol_permisos (
  rol_id uuid not null,
  permiso text not null
);

create table public.roles (
  id uuid default gen_random_uuid() not null,
  clave text not null,
  nombre text not null,
  es_sistema boolean default false not null,
  orden integer default 100 not null,
  created_at timestamp with time zone default now() not null
);

create table public.salidas_insumos (
  id uuid default gen_random_uuid() not null,
  proyecto_id uuid not null,
  insumo_id uuid not null,
  cantidad numeric not null,
  fecha date default ((now() AT TIME ZONE 'America/Bogota'::text))::date not null,
  registrado_por uuid not null,
  observaciones text,
  created_at timestamp with time zone default now() not null,
  anulada_at timestamp with time zone,
  anulada_por uuid,
  motivo_anulacion text,
  retira text,
  editada_at timestamp with time zone,
  editada_por uuid,
  cantidad_original numeric
);

create table public.solicitudes_equipo (
  id uuid default gen_random_uuid() not null,
  descripcion text not null,
  grupo_sugerido text,
  valor_propuesto numeric,
  solicitado_por uuid,
  presupuesto_item_id uuid,
  estado text default 'pendiente'::text not null,
  categoria_asignada_id uuid,
  motivo_rechazo text,
  created_at timestamp with time zone default now() not null,
  resuelto_at timestamp with time zone,
  resuelto_por uuid
);

create table public.solicitudes_insumos (
  id uuid default gen_random_uuid() not null,
  descripcion text not null,
  tipo text,
  u_m text,
  agrupacion text,
  vr_unitario_propuesto numeric,
  solicitado_por uuid,
  presupuesto_item_id uuid,
  estado text default 'pendiente'::text not null,
  codigo_maestro_asignado integer,
  created_at timestamp with time zone default now() not null,
  resuelto_at timestamp with time zone,
  resuelto_por uuid,
  motivo_rechazo text
);

create table public.solicitudes_mano_obra (
  id uuid default gen_random_uuid() not null,
  descripcion text not null,
  grupo_sugerido text,
  valor_propuesto numeric,
  solicitado_por uuid,
  presupuesto_item_id uuid,
  estado text default 'pendiente'::text not null,
  categoria_asignada_id uuid,
  motivo_rechazo text,
  created_at timestamp with time zone default now() not null,
  resuelto_at timestamp with time zone,
  resuelto_por uuid
);

create table public.transporte_precios (
  id uuid default gen_random_uuid() not null,
  proyecto_id uuid,
  presupuesto_item_id uuid not null,
  apu_import_revision_id uuid not null,
  descripcion_original text not null,
  valor_unitario numeric not null,
  unidad text,
  cargado_por uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.usuario_grupos (
  usuario_id uuid not null,
  grupo_id uuid not null
);

create table public.usuario_proyectos (
  usuario_id uuid not null,
  proyecto_id uuid not null,
  puede_editar boolean default false not null
);
