-- A&F · Migración 2: pagos (núcleo).
--
-- Un PAGO es una obligación de pagarle a un tercero, nacida de un documento
-- de la app (hoy: órdenes de compra; después: solicitudes de pago, actas,
-- nómina, seguridad social). Cada fuente crea sus pagos con su propia
-- función; todo lo demás (aprobación, consolidado semanal, ITEM, liquidación,
-- dispersión) es común.
--
-- Estados:
--   programado     espera una condición (saldo de una OC con anticipo).
--   solicitado     espera la aprobación de Gerencia.
--   aprobado       listo para pago: ya tiene semana e ITEM del consolidado.
--   liquidado      Contabilidad calculó las retenciones (migración futura).
--   en_dispersion  incluido en un lote de dispersión (migración futura).
--   dispersado     el dinero salió.
--   rechazado / anulado   no se paga.
-- La NOVEDAD no es un estado: es un texto que explica qué falta para poder
-- pagarlo (sin tercero, cuenta sin verificar, empresa sin consolidado...).
--
-- Semana: ISO-8601 (lunes a domingo; la semana 1 es la que trae el primer
-- jueves del año), en hora de Colombia. El ITEM es un contador por
-- (consolidado, año, semana).
--
-- Los pagos NO se escriben directo desde la API: solo los crean/mueven las
-- funciones de abajo y los disparadores de cada fuente.

create table if not exists public.pagos (
  id               uuid primary key default gen_random_uuid(),

  fuente           text not null check (fuente in ('orden_compra')),
  orden_compra_id  uuid references public.ordenes_compra(id),
  constraint pagos_fuente_coherente check ((fuente = 'orden_compra') = (orden_compra_id is not null)),
  tipo             text not null check (tipo in ('unico','anticipo','saldo')),

  proyecto_id      uuid references public.proyectos(id),
  -- Quien paga (grupo empresarial) y el consolidado al que le toca.
  empresa_id       uuid references public.empresas(id),
  consolidado_id   uuid references public.consolidados(id),

  tercero_id         uuid references public.terceros(id),
  cuenta_tercero_id  uuid references public.terceros_cuentas(id),

  concepto         text not null,
  numero_factura   text,
  -- Valor aprobado de ESTE pago (en pesos, con IVA, antes de retenciones).
  valor            numeric(18,2) not null check (valor > 0),

  estado           text not null default 'solicitado'
                   check (estado in ('programado','solicitado','aprobado','liquidado',
                                     'en_dispersion','dispersado','rechazado','anulado')),
  novedad          text,
  -- Saldo por fecha: desde cuándo se puede solicitar.
  fecha_programada date,

  anio             smallint,
  semana           smallint,
  item             integer,
  constraint pagos_item_completo check (
    (item is null) = (anio is null) and (item is null) = (semana is null)
  ),

  solicitado_en    timestamptz,
  aprobado_por     uuid references public.perfiles(id),
  aprobado_en      timestamptz,
  rechazado_por    uuid references public.perfiles(id),
  rechazado_en     timestamptz,
  motivo_rechazo   text,
  anulado_en       timestamptz,
  motivo_anulacion text,

  creado_en        timestamptz not null default now()
);

-- Una orden no tiene dos pagos vivos del mismo tipo.
create unique index if not exists pagos_orden_tipo_vivo
  on public.pagos(orden_compra_id, tipo)
  where estado not in ('anulado','rechazado');

-- El ITEM no se repite dentro de un consolidado y semana.
create unique index if not exists pagos_item_unico
  on public.pagos(consolidado_id, anio, semana, item)
  where item is not null;

-- Listados: por aprobar, por vencer (saldos por fecha) y el consolidado.
create index if not exists idx_pagos_solicitados on public.pagos(solicitado_en) where estado = 'solicitado';
create index if not exists idx_pagos_programados_fecha on public.pagos(fecha_programada) where estado = 'programado';
create index if not exists idx_pagos_consolidado on public.pagos(consolidado_id, anio, semana, estado);
create index if not exists idx_pagos_empresa on public.pagos(empresa_id);
create index if not exists idx_pagos_proyecto on public.pagos(proyecto_id);
create index if not exists idx_pagos_tercero on public.pagos(tercero_id);
create index if not exists idx_pagos_cuenta on public.pagos(cuenta_tercero_id);
create index if not exists idx_pagos_aprobado_por on public.pagos(aprobado_por);
create index if not exists idx_pagos_rechazado_por on public.pagos(rechazado_por);

-- Contador del ITEM: un renglón por (consolidado, año, semana).
create table if not exists public.pagos_contadores (
  consolidado_id uuid not null references public.consolidados(id),
  anio           smallint not null,
  semana         smallint not null,
  ultimo         integer not null default 0,
  primary key (consolidado_id, anio, semana)
);

-- ------------------------------------------------------------------- RLS
alter table public.pagos            enable row level security;
alter table public.pagos_contadores enable row level security;

-- Ver pagos: quien tenga la pestaña de Aprobación de pagos o del Consolidado.
-- Sin políticas de escritura: se escribe solo por las funciones de abajo.
drop policy if exists pagos_select on public.pagos;
create policy pagos_select on public.pagos
  for select to authenticated
  using (
    public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
    or public.tiene_pestana((select auth.uid()), 'ayf.consolidado')
  );

grant select on public.pagos to authenticated;

-- ---------------------------------------------------------- funciones base

-- Año y semana ISO de un instante, en hora de Colombia.
create or replace function public._semana_pago(p_instante timestamptz)
returns table(anio smallint, semana smallint)
language sql
immutable
set search_path = public
as $$
  select extract(isoyear from (p_instante at time zone 'America/Bogota'))::smallint,
         extract(week    from (p_instante at time zone 'America/Bogota'))::smallint
$$;

-- Texto de lo que falta para poder pagar el pago (NULL = nada).
create or replace function public._pago_novedad(p_pago_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(btrim(concat_ws(' ',
    case when p.consolidado_id is null
      then 'La empresa no tiene consolidado asignado.' end,
    case when p.tercero_id is null
      then 'No hay un tercero registrado para este pago.'
      when p.cuenta_tercero_id is null
      then 'Falta elegir la cuenta bancaria del tercero.'
      when c.estado is distinct from 'ACTIVO'
      then 'La cuenta bancaria del tercero está pendiente de verificar.' end
  )), '')
  from public.pagos p
  left join public.terceros_cuentas c on c.id = p.cuenta_tercero_id
  where p.id = p_pago_id
$$;
revoke all on function public._pago_novedad(uuid) from public, anon, authenticated;

-- Recalcula y guarda la novedad.
create or replace function public._pago_actualizar_novedad(p_pago_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.pagos set novedad = public._pago_novedad(id) where id = p_pago_id
$$;
revoke all on function public._pago_actualizar_novedad(uuid) from public, anon, authenticated;

-- Le da semana e ITEM a un pago APROBADO que todavía no los tiene. El
-- contador se incrementa con un solo INSERT ... ON CONFLICT DO UPDATE: la
-- fila queda bloqueada hasta el fin de la transacción, así que dos aprobaciones
-- simultáneas nunca reciben el mismo ITEM. Costo constante por pago.
create or replace function public._pago_asignar_item(p_pago_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p     record;
  v_anio  smallint;
  v_sem   smallint;
  v_item  integer;
begin
  select id, estado, consolidado_id, item, aprobado_en into v_p
    from public.pagos where id = p_pago_id for update;
  if not found or v_p.item is not null or v_p.estado <> 'aprobado' then
    return;
  end if;

  if v_p.consolidado_id is not null then
    select s.anio, s.semana into v_anio, v_sem from public._semana_pago(coalesce(v_p.aprobado_en, now())) s;

    insert into public.pagos_contadores as c (consolidado_id, anio, semana, ultimo)
    values (v_p.consolidado_id, v_anio, v_sem, 1)
    on conflict (consolidado_id, anio, semana) do update set ultimo = c.ultimo + 1
    returning c.ultimo into v_item;

    update public.pagos set anio = v_anio, semana = v_sem, item = v_item where id = p_pago_id;
  end if;

  perform public._pago_actualizar_novedad(p_pago_id);
end;
$$;
revoke all on function public._pago_asignar_item(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------- aprobación
-- Gerencia aprueba o rechaza cada pago por separado (los saldos que ya
-- cumplieron su condición). Los pagos únicos y los anticipos quedan aprobados
-- en el momento en que se aprueba su orden de compra.
create or replace function public.aprobar_pago(p_pago_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para aprobar pagos.';
  end if;

  update public.pagos
     set estado = 'aprobado', aprobado_por = auth.uid(), aprobado_en = now()
   where id = p_pago_id and estado = 'solicitado';
  if not found then
    raise exception 'El pago no existe o ya no está pendiente de aprobación.';
  end if;

  perform public._pago_asignar_item(p_pago_id);
end;
$$;
revoke all on function public.aprobar_pago(uuid) from public, anon;
grant execute on function public.aprobar_pago(uuid) to authenticated;

create or replace function public.rechazar_pago(p_pago_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para rechazar pagos.';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo de rechazo es obligatorio.';
  end if;

  update public.pagos
     set estado = 'rechazado', rechazado_por = auth.uid(), rechazado_en = now(),
         motivo_rechazo = btrim(p_motivo)
   where id = p_pago_id and estado = 'solicitado';
  if not found then
    raise exception 'El pago no existe o ya no está pendiente de aprobación.';
  end if;
end;
$$;
revoke all on function public.rechazar_pago(uuid, text) from public, anon;
grant execute on function public.rechazar_pago(uuid, text) to authenticated;

-- Los saldos "por fecha" se vuelven solicitud el día indicado. No hay cron:
-- se liberan al abrir la pantalla de Aprobación de pagos (idempotente, usa el
-- índice parcial por fecha).
create or replace function public.liberar_pagos_programados()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not public.tiene_pestana(auth.uid(), 'ayf.aprobacion_pagos') then
    raise exception 'No tienes permiso para ver los pagos por aprobar.';
  end if;

  update public.pagos
     set estado = 'solicitado', solicitado_en = now()
   where estado = 'programado'
     and fecha_programada is not null
     and fecha_programada <= (now() at time zone 'America/Bogota')::date;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.liberar_pagos_programados() from public, anon;
grant execute on function public.liberar_pagos_programados() to authenticated;

-- ---------------------------------------------------- resolver novedades
-- Financiera elige el tercero y la cuenta de un pago (cuando no se pudieron
-- resolver solos) o corrige la cuenta. Solo mientras el pago no esté en un
-- lote de dispersión.
create or replace function public.asignar_tercero_pago(
  p_pago_id uuid, p_tercero_id uuid, p_cuenta_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para gestionar pagos.';
  end if;

  select estado into v_estado from public.pagos where id = p_pago_id for update;
  if not found then
    raise exception 'El pago no existe.';
  end if;
  if v_estado in ('en_dispersion','dispersado','rechazado','anulado') then
    raise exception 'Este pago ya no se puede modificar (%).', v_estado;
  end if;

  if not exists (select 1 from public.terceros where id = p_tercero_id) then
    raise exception 'El tercero no existe.';
  end if;
  if p_cuenta_id is not null and not exists (
    select 1 from public.terceros_cuentas where id = p_cuenta_id and tercero_id = p_tercero_id
  ) then
    raise exception 'La cuenta no pertenece a ese tercero.';
  end if;

  update public.pagos set tercero_id = p_tercero_id, cuenta_tercero_id = p_cuenta_id where id = p_pago_id;
  perform public._pago_actualizar_novedad(p_pago_id);
end;
$$;
revoke all on function public.asignar_tercero_pago(uuid, uuid, uuid) from public, anon;
grant execute on function public.asignar_tercero_pago(uuid, uuid, uuid) to authenticated;

-- Cuando a una empresa se le asigna consolidado, los pagos aprobados que
-- esperaban eso reciben semana e ITEM, en el orden en que se aprobaron.
create or replace function public._empresa_consolidado_asignado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if new.consolidado_id is null or new.consolidado_id is not distinct from old.consolidado_id then
    return new;
  end if;

  update public.pagos
     set consolidado_id = new.consolidado_id
   where empresa_id = new.id and consolidado_id is null and estado in ('programado','solicitado','aprobado');

  for v_id in
    select id from public.pagos
     where empresa_id = new.id and estado = 'aprobado' and item is null
     order by aprobado_en, id
  loop
    perform public._pago_asignar_item(v_id);
  end loop;
  return new;
end;
$$;
revoke all on function public._empresa_consolidado_asignado() from public, anon, authenticated;

drop trigger if exists trg_empresa_consolidado_asignado on public.empresas;
create trigger trg_empresa_consolidado_asignado
  after update of consolidado_id on public.empresas
  for each row execute function public._empresa_consolidado_asignado();

-- ------------------------------------------------------------ roles
-- Gerencia aprueba pagos; Financiera maneja el consolidado y resuelve
-- novedades. (Editables después en Roles y permisos.)
insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
from public.roles r
join (values
  ('gerencia',   'tab.ayf.aprobacion_pagos'),
  ('gerencia',   'accion.aprobar_pagos'),
  ('financiera', 'tab.ayf.consolidado'),
  ('financiera', 'accion.gestionar_pagos')
) as p(clave, permiso) on p.clave = r.clave
on conflict do nothing;
