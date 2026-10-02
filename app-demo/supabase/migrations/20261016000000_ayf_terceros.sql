-- A&F · Migración 1: terceros, cuentas bancarias, bancos, consolidados y
-- cuentas de la empresa (las que se debitan al pagar).
--
-- Todo es NUEVO y aditivo: la única tabla existente que se toca es `empresas`
-- (una columna nueva, opcional). Nada de lo que ya funciona cambia.
--
-- Conceptos:
--   * tercero        = a quien se le paga (persona o empresa), identificado por
--                      su documento. Un tercero puede tener varias cuentas.
--   * tercero_cuenta = una cuenta bancaria del tercero. Nace PENDIENTE y solo
--                      quien tiene la acción `verificar_terceros` la pasa a
--                      ACTIVO. Cambiar banco/tipo/número de una cuenta ACTIVA
--                      la devuelve a PENDIENTE (control contra desvío de pagos).
--   * empresa        = el "grupo empresarial" del consolidado (tabla que ya
--                      existe: los consorcios/razones sociales de los proyectos).
--                      Cada empresa apunta a uno de los 3 consolidados.
--   * cuenta_empresa = cuenta propia de una empresa desde la que se paga.
--
-- Los DATOS (terceros y cuentas reales) NO van en esta migración: se cargan
-- con un archivo aparte, generado con scripts/generar_seed_terceros.py.

-- ------------------------------------------------------------ consolidados
create table if not exists public.consolidados (
  id     uuid primary key default gen_random_uuid(),
  clave  text not null unique,
  nombre text not null,
  orden  integer not null default 0
);

insert into public.consolidados (clave, nombre, orden) values
  ('bogota', 'Consolidado Bogotá', 10),
  ('vanur',  'Consolidado Vanur',  20),
  ('otros',  'Consolidado Otros',  30)
on conflict (clave) do nothing;

-- Cada empresa (grupo empresarial) paga por un consolidado. Opcional hasta que
-- el administrador la asigne.
alter table public.empresas
  add column if not exists consolidado_id uuid references public.consolidados(id) on delete set null;
create index if not exists idx_empresas_consolidado on public.empresas(consolidado_id);

-- ------------------------------------------------------------------ bancos
-- `codigo` es el código de compensación de tres dígitos. NULL = no se puede
-- pagar por archivo de dispersión (ej. PSE). Cómo lo escribe cada banco
-- pagador (Bancolombia 1000+código, Davivienda sin ceros...) lo resuelve el
-- generador de dispersores, no esta tabla.
create table if not exists public.bancos (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null unique check (nombre = upper(btrim(nombre))),
  codigo text check (codigo is null or codigo ~ '^[0-9]{3}$'),
  activo boolean not null default true
);

insert into public.bancos (nombre, codigo) values
  ('BANCO DE BOGOTA', '001'), ('BANCO POPULAR', '002'), ('ITAU CORPBANCA', '006'),
  ('BANCOLOMBIA', '007'), ('SCOTIABANK COLOMBIA', '008'), ('CITIBANK', '009'),
  ('BANCO GNB SUDAMERIS', '012'), ('BBVA', '013'), ('ITAU', '014'),
  ('SCOTIABANK COLPATRIA', '019'), ('BANCO DE OCCIDENTE', '023'), ('BANCOLDEX', '031'),
  ('BANCO CAJA SOCIAL', '032'), ('BANCO AGRARIO', '040'), ('DAVIVIENDA', '051'),
  ('AV VILLAS', '052'), ('BANCO W', '053'), ('BANCO PROCREDIT', '058'),
  ('BANCAMIA', '059'), ('BANCO PICHINCHA', '060'), ('BANCOOMEVA', '061'),
  ('BANCO FALABELLA', '062'), ('BANCO FINANDINA', '063'), ('BANCO MULTIBANK', '064'),
  ('BANCO SANTANDER DE NEGOCIOS', '065'), ('BANCO COOPCENTRAL', '066'),
  ('BANCO COMPARTIR', '067'), ('BANCO SERFINANZA', '069'), ('LULO BANK', '070'),
  ('FINANCIERA JURISCOOP', '121'), ('RAPPIPAY', '151'),
  ('CONFIAR COOPERATIVA FINANCIERA', '292'), ('COLTEFINANCIERA', '370'),
  ('NEQUI', '507'), ('DAVIPLATA', '551'), ('BANCO CREDIFINANCIERA', '558'),
  ('PIBANK', '560'), ('MOVII', '801'), ('DING', '802'), ('POWWI', '803'),
  ('UALA', '804'), ('NU BANK', '809'), ('DALE', '897'),
  ('PSE', null)
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------- terceros
create table if not exists public.terceros (
  id               uuid primary key default gen_random_uuid(),
  tipo_documento   text not null check (tipo_documento in ('CC','NIT','CE','PPT','PA','TI','RC')),
  -- Solo dígitos, SIN dígito de verificación (ese va aparte, en `dv`).
  numero_documento text not null check (numero_documento ~ '^[0-9]+$'),
  dv               text check (dv is null or dv ~ '^[0-9]$'),
  razon_social     text not null check (btrim(razon_social) <> ''),
  -- Nombre que se escribe en el banco (sin tildes ni caracteres raros). Si es
  -- NULL, el generador usa la razón social; cada banco lo recorta a su tope.
  nombre_banco     text,
  nombres          text,
  apellidos        text,
  observaciones    text,
  creado_por       uuid references public.perfiles(id),
  creado_en        timestamptz not null default now()
);

-- Un documento = un tercero.
create unique index if not exists terceros_documento_key on public.terceros(numero_documento);
create index if not exists idx_terceros_creado_por on public.terceros(creado_por);

-- Búsqueda por nombre en listados grandes (índice trigram). Se crea solo si la
-- extensión está disponible; si no, la búsqueda funciona igual, más lenta.
do $$
begin
  create index if not exists idx_terceros_razon_social_trgm
    on public.terceros using gin (razon_social gin_trgm_ops);
exception when others then
  raise notice 'Sin índice trigram en terceros.razon_social (%).', sqlerrm;
end $$;

-- ------------------------------------------------------- cuentas de tercero
create table if not exists public.terceros_cuentas (
  id             uuid primary key default gen_random_uuid(),
  tercero_id     uuid not null references public.terceros(id),
  banco_id       uuid not null references public.bancos(id),
  tipo_cuenta    text not null check (tipo_cuenta in ('AHORROS','CORRIENTE')),
  numero_cuenta  text not null check (numero_cuenta ~ '^[0-9]+$'),
  etiqueta       text,
  estado         text not null default 'PENDIENTE' check (estado in ('ACTIVO','PENDIENTE','INACTIVO')),
  verificada_en  date,
  verificada_por text,
  observaciones  text,
  creado_por     uuid references public.perfiles(id),
  creado_en      timestamptz not null default now()
);

-- La misma cuenta no se repite para el mismo tercero. (Nequi y DaviPlata del
-- mismo tercero comparten el celular, por eso el banco entra en la llave.)
create unique index if not exists terceros_cuentas_unica
  on public.terceros_cuentas(tercero_id, banco_id, numero_cuenta);
create index if not exists idx_terceros_cuentas_banco on public.terceros_cuentas(banco_id);
create index if not exists idx_terceros_cuentas_creado_por on public.terceros_cuentas(creado_por);

-- --------------------------------------------------- cuentas de la empresa
create table if not exists public.cuentas_empresa (
  id            uuid primary key default gen_random_uuid(),
  -- Se cruza por NIT con `empresas` al cargar los datos; puede quedar NULL.
  empresa_id    uuid references public.empresas(id),
  apodo         text not null unique,
  diminutivo    text not null unique check (char_length(diminutivo) between 1 and 4),
  banco_id      uuid not null references public.bancos(id),
  tipo_cuenta   text not null check (tipo_cuenta in ('AHORROS','CORRIENTE')),
  numero_cuenta text not null check (numero_cuenta ~ '^[0-9]+$'),
  nit           text not null check (nit ~ '^[0-9]+$'),
  dv            text check (dv is null or dv ~ '^[0-9]$'),
  razon_social  text not null,
  aplicacion    text check (aplicacion in ('INMEDIATA','MEDIO DIA','NOCHE')),
  correo_itau   text,
  estado        text not null default 'ACTIVA' check (estado in ('ACTIVA','INACTIVA')),
  observaciones text
);
create index if not exists idx_cuentas_empresa_empresa on public.cuentas_empresa(empresa_id);
create index if not exists idx_cuentas_empresa_banco on public.cuentas_empresa(banco_id);

-- ---------------------------------------------------------------- auditoría
-- Quién cambió qué en terceros y sus cuentas bancarias (antes y después). Sin
-- políticas de escritura: solo la llenan los disparadores.
create table if not exists public.terceros_auditoria (
  id          bigint generated always as identity primary key,
  tabla       text not null,
  registro_id uuid not null,
  accion      text not null,
  antes       jsonb,
  despues     jsonb,
  usuario_id  uuid,
  creado_en   timestamptz not null default now()
);
create index if not exists idx_terceros_auditoria_registro
  on public.terceros_auditoria(registro_id, creado_en desc);

create or replace function public._terceros_auditar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.terceros_auditoria (tabla, registro_id, accion, antes, despues, usuario_id)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    auth.uid()
  );
  return null;
end;
$$;
revoke all on function public._terceros_auditar() from public, anon, authenticated;

drop trigger if exists trg_terceros_auditar on public.terceros;
create trigger trg_terceros_auditar
  after insert or update or delete on public.terceros
  for each row execute function public._terceros_auditar();

drop trigger if exists trg_terceros_cuentas_auditar on public.terceros_cuentas;
create trigger trg_terceros_cuentas_auditar
  after insert or update or delete on public.terceros_cuentas
  for each row execute function public._terceros_auditar();

-- ------------------------------------------------- control de verificación
-- Reglas (solo cuando hay sesión de usuario; la carga masiva desde el SQL
-- Editor no tiene sesión y entra como venga):
--   * Una cuenta nueva siempre nace PENDIENTE, salvo que la cree quien tiene
--     `verificar_terceros`.
--   * Pasar una cuenta a ACTIVO exige `verificar_terceros`, y deja constancia
--     (fecha y nombre de quien verificó).
--   * Si alguien SIN ese permiso cambia banco, tipo o número de una cuenta
--     ACTIVA, vuelve a PENDIENTE: la plata no puede desviarse sin una revisión.
--   * Los campos de verificación no se pueden escribir a mano.
create or replace function public._terceros_cuentas_guarda()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_verifica  boolean;
  v_cambio    boolean;
begin
  if v_uid is null then
    return new;
  end if;

  v_verifica := public.tiene_accion(v_uid, 'verificar_terceros');

  if tg_op = 'INSERT' then
    new.creado_por := v_uid;
    if new.estado = 'ACTIVO' and v_verifica then
      new.verificada_en := current_date;
      new.verificada_por := (select nombre from public.perfiles where id = v_uid);
    else
      new.estado := case when new.estado = 'INACTIVO' then 'INACTIVO' else 'PENDIENTE' end;
      new.verificada_en := null;
      new.verificada_por := null;
    end if;
    return new;
  end if;

  -- UPDATE
  new.creado_por := old.creado_por;
  new.creado_en := old.creado_en;
  new.tercero_id := old.tercero_id;
  v_cambio := (new.banco_id, new.tipo_cuenta, new.numero_cuenta)
              is distinct from (old.banco_id, old.tipo_cuenta, old.numero_cuenta);

  if new.estado = 'ACTIVO' then
    if v_verifica then
      if old.estado is distinct from 'ACTIVO' or v_cambio then
        new.verificada_en := current_date;
        new.verificada_por := (select nombre from public.perfiles where id = v_uid);
      else
        new.verificada_en := old.verificada_en;
        new.verificada_por := old.verificada_por;
      end if;
    else
      if old.estado is distinct from 'ACTIVO' then
        raise exception 'Solo quien verifica terceros puede activar una cuenta.';
      end if;
      if v_cambio then
        new.estado := 'PENDIENTE';
        new.verificada_en := null;
        new.verificada_por := null;
      else
        new.verificada_en := old.verificada_en;
        new.verificada_por := old.verificada_por;
      end if;
    end if;
  else
    -- PENDIENTE / INACTIVO: la verificación anterior ya no vale
    if v_verifica then
      if new.estado is distinct from old.estado then
        new.verificada_en := null;
        new.verificada_por := null;
      end if;
    else
      new.verificada_en := old.verificada_en;
      new.verificada_por := old.verificada_por;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._terceros_cuentas_guarda() from public, anon, authenticated;

drop trigger if exists trg_terceros_cuentas_guarda on public.terceros_cuentas;
create trigger trg_terceros_cuentas_guarda
  before insert or update on public.terceros_cuentas
  for each row execute function public._terceros_cuentas_guarda();

-- Quién creó el tercero (la sesión de quien lo inserta).
create or replace function public._terceros_creador()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.creado_por := auth.uid();
    else
      new.creado_por := old.creado_por;
      new.creado_en := old.creado_en;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._terceros_creador() from public, anon, authenticated;

drop trigger if exists trg_terceros_creador on public.terceros;
create trigger trg_terceros_creador
  before insert or update on public.terceros
  for each row execute function public._terceros_creador();

-- ------------------------------------------------------------------- RLS
alter table public.consolidados       enable row level security;
alter table public.bancos             enable row level security;
alter table public.terceros           enable row level security;
alter table public.terceros_cuentas   enable row level security;
alter table public.cuentas_empresa    enable row level security;
alter table public.terceros_auditoria enable row level security;

-- Catálogos: los lee cualquier usuario con sesión. Se editan desde el SQL
-- Editor / pantallas de administración (sin políticas de escritura por ahora).
drop policy if exists consolidados_select on public.consolidados;
create policy consolidados_select on public.consolidados
  for select to authenticated using (true);

drop policy if exists bancos_select on public.bancos;
create policy bancos_select on public.bancos
  for select to authenticated using (true);

-- Terceros y sus cuentas: ver = pestaña Terceros; crear/editar = acción
-- editar_terceros. No hay DELETE: una cuenta o tercero se inactiva.
drop policy if exists terceros_select on public.terceros;
create policy terceros_select on public.terceros
  for select to authenticated
  using (public.tiene_pestana((select auth.uid()), 'ayf.terceros'));

drop policy if exists terceros_insert on public.terceros;
create policy terceros_insert on public.terceros
  for insert to authenticated
  with check (public.tiene_accion((select auth.uid()), 'editar_terceros'));

drop policy if exists terceros_update on public.terceros;
create policy terceros_update on public.terceros
  for update to authenticated
  using (public.tiene_accion((select auth.uid()), 'editar_terceros'))
  with check (public.tiene_accion((select auth.uid()), 'editar_terceros'));

drop policy if exists terceros_cuentas_select on public.terceros_cuentas;
create policy terceros_cuentas_select on public.terceros_cuentas
  for select to authenticated
  using (public.tiene_pestana((select auth.uid()), 'ayf.terceros'));

drop policy if exists terceros_cuentas_insert on public.terceros_cuentas;
create policy terceros_cuentas_insert on public.terceros_cuentas
  for insert to authenticated
  with check (public.tiene_accion((select auth.uid()), 'editar_terceros'));

drop policy if exists terceros_cuentas_update on public.terceros_cuentas;
create policy terceros_cuentas_update on public.terceros_cuentas
  for update to authenticated
  using (public.tiene_accion((select auth.uid()), 'editar_terceros'))
  with check (public.tiene_accion((select auth.uid()), 'editar_terceros'));

-- Cuentas de la empresa y auditoría: por ahora solo el Administrador y quien
-- verifica terceros las ve.
drop policy if exists cuentas_empresa_select on public.cuentas_empresa;
create policy cuentas_empresa_select on public.cuentas_empresa
  for select to authenticated
  using (public.es_admin((select auth.uid())));

drop policy if exists terceros_auditoria_select on public.terceros_auditoria;
create policy terceros_auditoria_select on public.terceros_auditoria
  for select to authenticated
  using (public.tiene_accion((select auth.uid()), 'verificar_terceros'));

grant select on public.consolidados, public.bancos, public.cuentas_empresa,
                public.terceros_auditoria to authenticated;
grant select, insert, update on public.terceros, public.terceros_cuentas to authenticated;

-- -------------------------------------------------------------------- rol
-- Financiera (reemplaza a "Tesorería"). Arranca con Terceros; el resto de
-- pestañas y acciones del módulo se le asignan a medida que existan.
insert into public.roles (clave, nombre, es_sistema, orden)
values ('financiera', 'Financiera', true, 55)
on conflict (clave) do nothing;

insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
from public.roles r
cross join (values
  ('tab.ayf.terceros'),
  ('accion.editar_terceros'),
  ('accion.verificar_terceros')
) as p(permiso)
where r.clave = 'financiera'
on conflict do nothing;
