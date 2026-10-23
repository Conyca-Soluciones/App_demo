-- Proveedores enlazados al tercero (decisión del usuario, 2026-10-23; paso 3 de
-- "Terceros: el centro de a quién se le paga", ver CLAUDE.md).
--
-- - proveedores.tercero_id (único): 393 de 394 coinciden por documento; EQUINORTE
--   (PV0318) no tiene documento y queda sin tercero hasta que lo completen. Un
--   proveedor NUEVO exige tercero (se busca por documento o se crea con el
--   formulario de A&F).
-- - Terceros manda en el NÚMERO de documento y el NOMBRE (decisión del usuario):
--   la copia de proveedores se llena sola desde el tercero
--   (_proveedor_desde_tercero) y se actualiza cuando A&F lo corrige. Los nombres
--   pasan al formato de Terceros ("S.A.S" -> "SAS").
-- - El tipo que muestra la OC lo decide el proveedor (decisión del usuario): una
--   persona natural que en Terceros es CC puede salir como NIT en la orden (mismo
--   número). Si el tercero es NIT, el proveedor también. El DV ya no se escribe:
--   se calcula (dv_nit) cuando el proveedor es NIT.
-- - La cuenta bancaria vive solo en Terceros: se borra informacion_bancaria (que
--   el pago nunca usó; sus 31 cuentas propias ya pasaron a Terceros como
--   PENDIENTE en 20261219000000), con copia en respaldo_informacion_bancaria_20261023,
--   y crear_terceros_desde_proveedores (carga inicial, ya no sirve).
-- - Las funciones de OC buscan el tercero por proveedores.tercero_id, no por
--   documento como texto.

-- 1. tercero_id ----------------------------------------------------------------

alter table public.proveedores add column if not exists tercero_id uuid references public.terceros(id);
create unique index if not exists proveedores_tercero_unico on public.proveedores (tercero_id);

-- Un proveedor por tercero. Dos documentos estaban repetidos sin órdenes de
-- compra (PV034/PV0235 JUAN PABLO CAMARGO ROJANO; PV021/PV0266 ARGEMIRO ALVAREZ
-- RUEDA, "CRA 19" / "CRA 21"): se enlaza el que tiene más datos (dirección) o el
-- de ID más bajo; el otro queda INACTIVO y sin tercero.
with candidatos as (
  select p.unique_id, t.id as tercero_id,
         row_number() over (partition by t.id
                            order by (p.direccion is not null) desc,
                                     nullif(regexp_replace(coalesce(p.id_prov, ''), '\D', '', 'g'), '')::int nulls last,
                                     p.unique_id) as n
    from public.proveedores p
    join public.terceros t on t.numero_documento = p.numero_documento::text
   where p.tercero_id is null
     and not exists (select 1 from public.proveedores x where x.tercero_id = t.id)
)
update public.proveedores p
   set tercero_id = c.tercero_id
  from candidatos c
 where c.unique_id = p.unique_id and c.n = 1;

update public.proveedores p
   set estado = 'INACTIVO'
 where p.tercero_id is null and p.numero_documento is not null
   and exists (select 1 from public.proveedores x where x.tercero_id is not null
                                                    and x.numero_documento = p.numero_documento);

-- 2. Nombre y documento copiados del tercero --------------------------------------

create or replace function public._proveedor_desde_tercero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
begin
  if new.tercero_id is null then
    if tg_op = 'INSERT' then
      raise exception 'Busca el tercero por su documento (o créalo) antes de crear el proveedor.';
    end if;
    return new;  -- proveedor viejo sin tercero (sin documento): se puede seguir editando
  end if;
  select tipo_documento, numero_documento, razon_social into t from public.terceros where id = new.tercero_id;
  if not found then
    raise exception 'El tercero del proveedor no existe.';
  end if;
  new.nombre := t.razon_social;
  new.numero_documento := t.numero_documento::bigint;
  -- NIT si el tercero lo es o si el proveedor factura como NIT (mismo número).
  new.tipo_documento := case when t.tipo_documento = 'NIT' or new.tipo_documento = 'NIT' then 'NIT' else t.tipo_documento end;
  new.digito_verificacion := case when new.tipo_documento = 'NIT' then public.dv_nit(t.numero_documento) end;
  return new;
end;
$$;

drop trigger if exists proveedores_desde_tercero on public.proveedores;
create trigger proveedores_desde_tercero
  before insert or update on public.proveedores
  for each row execute function public._proveedor_desde_tercero();

create or replace function public._tercero_a_proveedor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.tipo_documento, new.numero_documento, new.razon_social)
     is distinct from (old.tipo_documento, old.numero_documento, old.razon_social) then
    update public.proveedores set tercero_id = tercero_id where tercero_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_tercero_a_proveedor on public.terceros;
create trigger trg_tercero_a_proveedor
  after update on public.terceros
  for each row execute function public._tercero_a_proveedor();

revoke all on function public._proveedor_desde_tercero() from public, anon, authenticated;
revoke all on function public._tercero_a_proveedor() from public, anon, authenticated;

-- Los que ya existían quedan iguales a su tercero (nombre en formato de Terceros,
-- DV calculado).
update public.proveedores p
   set tercero_id = p.tercero_id
  from public.terceros t
 where t.id = p.tercero_id
   and (p.nombre, p.numero_documento, p.digito_verificacion)
       is distinct from (t.razon_social, t.numero_documento::bigint,
                         case when p.tipo_documento = 'NIT' or t.tipo_documento = 'NIT' then public.dv_nit(t.numero_documento)::bigint end);

-- 3. Sin informacion_bancaria -------------------------------------------------------

do $$
begin
  if to_regclass('public.informacion_bancaria') is not null then
    if to_regclass('public.respaldo_informacion_bancaria_20261023') is null then
      create table public.respaldo_informacion_bancaria_20261023 as select * from public.informacion_bancaria;
      revoke all on public.respaldo_informacion_bancaria_20261023 from public, anon, authenticated;
    end if;
    drop table public.informacion_bancaria;
  end if;
end $$;
drop function if exists public.crear_terceros_desde_proveedores();

-- 4. Funciones de OC: el tercero por tercero_id ------------------------------------

do $$
declare
  -- función, texto a buscar, reemplazo, veces que debe aparecer
  v_cambios constant text[][] := array[
    ['_crear_pagos_orden',
     'pr.numero_documento::text as proveedor_documento',
     'pr.numero_documento::text as proveedor_documento, pr.tercero_id as proveedor_tercero_id',
     '1'],
    ['_crear_pagos_orden',
     '   where t.numero_documento = v_oc.proveedor_documento;',
     '   where t.id = v_oc.proveedor_tercero_id;  -- proveedores.tercero_id (20261223000000)',
     '1'],
    ['cuentas_proveedor_oc',
     't.numero_documento = pr.numero_documento::text',
     't.id = pr.tercero_id',
     '1'],
    ['_fijar_pago_orden',
     't.numero_documento = pr.numero_documento::text',
     't.id = pr.tercero_id',
     '1'],
    ['_fijar_titular_orden',
     't.numero_documento = pr.numero_documento::text',
     't.id = pr.tercero_id',
     '1'],
    ['_enlazar_pagos_tercero',
     'where o.id = pg.orden_compra_id and pr.numero_documento::text = v_documento)',
     'where o.id = pg.orden_compra_id and pr.tercero_id = p_tercero_id)',
     '1']
  ];
  v_def text;
  v_n int;
  i int;
begin
  for i in 1 .. array_length(v_cambios, 1) loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_cambios[i][1];
    if v_def is null then
      raise exception 'No existe la función %.', v_cambios[i][1];
    end if;
    if position(v_cambios[i][3] in v_def) > 0 then
      continue;  -- ya aplicado
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_cambios[i][2], ''))) / length(v_cambios[i][2]);
    if v_n <> v_cambios[i][4]::int then
      raise exception 'En % se esperaba encontrar % veces el texto % (veces: %): ¿cambió la función?',
        v_cambios[i][1], v_cambios[i][4], v_cambios[i][2], v_n;
    end if;
    execute replace(v_def, v_cambios[i][2], v_cambios[i][3]);
  end loop;
end $$;
