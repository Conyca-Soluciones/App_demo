-- Órdenes de compra: método de pago Transferencia o PSE (decisión del usuario,
-- 2026-10-23; como en las requisiciones administrativas).
--
-- Transferencia: la cuenta sale de Terceros (la que verifica Financiera), ya no
-- de proveedores / informacion_bancaria (que el pago nunca usó). Generar OC
-- muestra las cuentas del proveedor en Terceros: con una se elige sola, con
-- varias se escoge, y sin ninguna no deja generar la orden por transferencia
-- (se puede pagar por PSE o pedir a A&F que registre la cuenta). La cuenta de
-- un titular aparte (20261214000000) sigue igual.
-- PSE: sin cuenta bancaria. Observaciones para A&F y, si el titular no es el
-- proveedor, su nombre, tipo (CC, NIT, PPT, CE) y número de documento. El pago
-- queda a nombre del proveedor, sin cuenta y sin la novedad "falta cuenta".
--
-- Además: las cuentas que estaban solo en informacion_bancaria se pasan a
-- Terceros como PENDIENTE para que Financiera las verifique.
--
-- Funciones vivas parchadas (texto exacto; falla si no lo encuentra el número
-- de veces esperado): _crear_pagos_orden, _pago_novedad, _enlazar_pagos_tercero
-- y crear_orden_compra_con_soporte (+ parámetro p_pago).

-- 1. Columnas -----------------------------------------------------------------

alter table public.ordenes_compra
  add column if not exists metodo_pago text not null default 'transferencia',
  add column if not exists pago_observaciones text,
  add column if not exists pse_titular_nombre text,
  add column if not exists pse_titular_tipo_documento text,
  add column if not exists pse_titular_documento text;

alter table public.ordenes_compra drop constraint if exists ordenes_compra_metodo_pago_check;
alter table public.ordenes_compra add constraint ordenes_compra_metodo_pago_check
  check (metodo_pago in ('transferencia', 'pse'));

-- Titular de PSE: los tres datos o ninguno (ninguno = el proveedor), solo en PSE.
alter table public.ordenes_compra drop constraint if exists ordenes_compra_pse_titular_check;
alter table public.ordenes_compra add constraint ordenes_compra_pse_titular_check
  check (
    (pse_titular_nombre is null and pse_titular_tipo_documento is null and pse_titular_documento is null)
    or (metodo_pago = 'pse' and pse_titular_nombre is not null
        and pse_titular_tipo_documento in ('CC', 'NIT', 'PPT', 'CE') and pse_titular_documento ~ '^[0-9]+$')
  );

-- La cuenta elegida ahora también puede ser del propio proveedor (sin titular
-- aparte). Un titular aparte sigue exigiendo su cuenta.
alter table public.ordenes_compra drop constraint if exists ordenes_compra_titular_cuenta_check;
alter table public.ordenes_compra add constraint ordenes_compra_titular_cuenta_check
  check (titular_tercero_id is null or cuenta_tercero_id is not null);

-- 2. Cuentas del proveedor en Terceros (para Generar OC) ----------------------

-- Compras no lee Terceros por RLS: esta función le da solo lo que necesita
-- (número enmascarado, como cuentas_tercero_requisicion_admin).
create or replace function public.cuentas_proveedor_oc(p_proveedor_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tercero record;
begin
  if not public.tiene_accion(auth.uid(), 'comprar') then
    raise exception 'No tienes permiso para generar órdenes de compra.';
  end if;
  select t.id, t.razon_social into v_tercero
    from public.proveedores pr
    join public.terceros t on t.numero_documento = pr.numero_documento::text
   where pr.unique_id = p_proveedor_id
   limit 1;
  if v_tercero.id is null then
    return jsonb_build_object('tercero_id', null, 'razon_social', null, 'cuentas', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'tercero_id', v_tercero.id,
    'razon_social', v_tercero.razon_social,
    'cuentas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'banco', b.nombre, 'tipo_cuenta', c.tipo_cuenta,
               'numero', repeat('•', greatest(length(c.numero_cuenta) - 4, 0)) || right(c.numero_cuenta, 4),
               'verificada', c.estado = 'ACTIVO')
             order by (c.estado = 'ACTIVO') desc, b.nombre, c.creado_en)
        from public.terceros_cuentas c
        join public.bancos b on b.id = c.banco_id
       where c.tercero_id = v_tercero.id and c.estado <> 'INACTIVO'), '[]'::jsonb));
end;
$$;
revoke all on function public.cuentas_proveedor_oc(uuid) from public, anon;
grant execute on function public.cuentas_proveedor_oc(uuid) to authenticated;

-- 3. Guardar el método de pago de la orden -----------------------------------

-- p_pago = {"metodo": "transferencia" | "pse", "cuenta_id": ..., "observaciones": ...,
--           "titular_distinto": bool, "titular_nombre", "titular_tipo_documento",
--           "titular_documento"}. Null = código anterior: no cambia nada.
-- Va después de _fijar_titular_orden (la cuenta de un titular aparte ya quedó).
create or replace function public._fijar_pago_orden(p_orden_id uuid, p_pago jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metodo text := coalesce(nullif(p_pago ->> 'metodo', ''), 'transferencia');
  v_obs text := nullif(btrim(coalesce(p_pago ->> 'observaciones', '')), '');
  v_oc record;
  v_cuenta uuid;
  v_estado text;
  v_n int;
  v_nombre text;
  v_tipo text;
  v_doc text;
begin
  if p_pago is null then
    return;
  end if;
  if v_metodo not in ('transferencia', 'pse') then
    raise exception 'El método de pago debe ser Transferencia o PSE.';
  end if;

  select oc.titular_tercero_id, t.id as tercero_id
    into v_oc
    from public.ordenes_compra oc
    join public.proveedores pr on pr.unique_id = oc.proveedor_id
    left join public.terceros t on t.numero_documento = pr.numero_documento::text
   where oc.id = p_orden_id
   limit 1;

  if v_metodo = 'pse' then
    if v_oc.titular_tercero_id is not null then
      raise exception 'Con PSE no se elige la cuenta de otro tercero: quita la casilla del titular de la cuenta.';
    end if;
    if coalesce((p_pago ->> 'titular_distinto')::boolean, false) then
      v_nombre := nullif(btrim(coalesce(p_pago ->> 'titular_nombre', '')), '');
      v_tipo := p_pago ->> 'titular_tipo_documento';
      v_doc := nullif(regexp_replace(coalesce(p_pago ->> 'titular_documento', ''), '\D', '', 'g'), '');
      if v_nombre is null then
        raise exception 'Escribe el titular del pago PSE.';
      end if;
      if v_tipo is null or v_tipo not in ('CC', 'NIT', 'PPT', 'CE') then
        raise exception 'Elige el tipo de documento del titular: CC, NIT, PPT o CE.';
      end if;
      if v_doc is null then
        raise exception 'Escribe el NIT o CC del titular.';
      end if;
    end if;
    update public.ordenes_compra
       set metodo_pago = 'pse', pago_observaciones = v_obs, cuenta_tercero_id = null,
           pse_titular_nombre = v_nombre, pse_titular_tipo_documento = v_tipo, pse_titular_documento = v_doc
     where id = p_orden_id;
    return;
  end if;

  -- Transferencia
  update public.ordenes_compra
     set metodo_pago = 'transferencia', pago_observaciones = v_obs,
         pse_titular_nombre = null, pse_titular_tipo_documento = null, pse_titular_documento = null
   where id = p_orden_id;
  if v_oc.titular_tercero_id is not null then
    return;  -- se paga en la cuenta del titular aparte, ya validada
  end if;
  if v_oc.tercero_id is null then
    raise exception 'El proveedor no está inscrito en Terceros: pídele a A&F que lo inscriba con su cuenta, o paga por PSE.';
  end if;

  v_cuenta := nullif(p_pago ->> 'cuenta_id', '')::uuid;
  if v_cuenta is not null then
    select c.estado into v_estado from public.terceros_cuentas c
     where c.id = v_cuenta and c.tercero_id = v_oc.tercero_id;
    if not found then
      raise exception 'La cuenta elegida no es del proveedor.';
    end if;
    if v_estado = 'INACTIVO' then
      raise exception 'La cuenta elegida está inactiva: elige otra.';
    end if;
  else
    select count(*) into v_n from public.terceros_cuentas c
     where c.tercero_id = v_oc.tercero_id and c.estado <> 'INACTIVO';
    if v_n = 0 then
      raise exception 'El proveedor no tiene cuenta bancaria en Terceros: pídele a A&F que la registre, o paga por PSE.';
    end if;
    if v_n > 1 then
      raise exception 'El proveedor tiene varias cuentas en Terceros: elige en cuál se paga.';
    end if;
    select c.id into v_cuenta from public.terceros_cuentas c
     where c.tercero_id = v_oc.tercero_id and c.estado <> 'INACTIVO';
  end if;
  update public.ordenes_compra set cuenta_tercero_id = v_cuenta where id = p_orden_id;
end;
$$;
revoke all on function public._fijar_pago_orden(uuid, jsonb) from public, anon, authenticated;

-- 4. Funciones vivas, parchadas ------------------------------------------------

do $$
declare
  -- función, texto a buscar, reemplazo, veces que debe aparecer
  v_cambios constant text[][] := array[
    ['_crear_pagos_orden',
     'oc.titular_tercero_id, oc.cuenta_tercero_id as titular_cuenta_id,',
     'oc.titular_tercero_id, oc.cuenta_tercero_id as titular_cuenta_id, oc.metodo_pago,',
     '1'],
    -- La cuenta elegida en Generar OC (del proveedor o del titular aparte) gana;
    -- con PSE no hay cuenta.
    ['_crear_pagos_orden',
     '  if v_oc.titular_tercero_id is not null then',
     E'  if v_oc.metodo_pago = ''pse'' then\n    v_cuenta := null;\n  elsif v_oc.titular_cuenta_id is not null then',
     '1'],
    ['_pago_novedad',
     'left join public.requisiciones_admin r on r.id = p.requisicion_admin_id',
     E'left join public.requisiciones_admin r on r.id = p.requisicion_admin_id\n  left join public.ordenes_compra oc on oc.id = p.orden_compra_id',
     '1'],
    ['_pago_novedad',
     'case when r.metodo = ''pse'' then null',
     'case when r.metodo = ''pse'' or oc.metodo_pago = ''pse'' then null',
     '1'],
    -- Un pago PSE no recibe cuenta cuando el proveedor registra una después.
    ['_enlazar_pagos_tercero',
     '         and pg.titular_tercero_id is null',
     E'         and pg.titular_tercero_id is null\n'
       || E'         and not exists (select 1 from public.ordenes_compra o\n'
       || E'                          where o.id = pg.orden_compra_id and o.metodo_pago = ''pse'')',
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
    -- Ya aplicado (la migración se corre por segunda vez).
    if position(v_cambios[i][3] in v_def) > 0 then
      continue;
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_cambios[i][2], ''))) / length(v_cambios[i][2]);
    if v_n <> v_cambios[i][4]::int then
      raise exception 'En % se esperaba encontrar % veces el texto % (veces: %): ¿cambió la función?',
        v_cambios[i][1], v_cambios[i][4], v_cambios[i][2], v_n;
    end if;
    execute replace(v_def, v_cambios[i][2], v_cambios[i][3]);
  end loop;
end $$;

-- crear_orden_compra_con_soporte: parámetro nuevo p_pago (cambia la firma: se
-- borra la anterior para que PostgREST no tenga dos candidatas).
do $$
declare
  v_def text;
  v_viejo constant text := 'p_titular jsonb DEFAULT NULL::jsonb)';
  v_perform constant text := '  perform public._crear_pagos_orden(v_id);';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'crear_orden_compra_con_soporte'
     and pg_get_function_identity_arguments(p.oid) not like '%p_pago%';
  if v_def is null then
    if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname = 'crear_orden_compra_con_soporte'
                 and pg_get_function_identity_arguments(p.oid) like '%p_pago%') then
      return;  -- ya se corrió
    end if;
    raise exception 'No existe crear_orden_compra_con_soporte.';
  end if;
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1
     or (length(v_def) - length(replace(v_def, v_perform, ''))) / length(v_perform) <> 1 then
    raise exception 'crear_orden_compra_con_soporte cambió: revisa el parche.';
  end if;
  v_def := replace(v_def, v_viejo, 'p_titular jsonb DEFAULT NULL::jsonb, p_pago jsonb DEFAULT NULL::jsonb)');
  v_def := replace(v_def, v_perform,
                   E'  perform public._fijar_pago_orden(v_id, p_pago);\n' || v_perform);
  drop function public.crear_orden_compra_con_soporte(uuid, uuid, text, date, text, text, text, text, text, text,
                                                      jsonb, jsonb, numeric, text, date, jsonb);
  execute v_def;
end $$;
revoke all on function public.crear_orden_compra_con_soporte(uuid, uuid, text, date, text, text, text, text, text, text,
                                                             jsonb, jsonb, numeric, text, date, jsonb, jsonb) from public, anon;
grant execute on function public.crear_orden_compra_con_soporte(uuid, uuid, text, date, text, text, text, text, text, text,
                                                               jsonb, jsonb, numeric, text, date, jsonb, jsonb) to authenticated;

-- 5. Cuentas que estaban solo en informacion_bancaria -> Terceros (PENDIENTE) --
-- Proveedores inscritos en Terceros sin ninguna cuenta y con número en
-- informacion_bancaria (31 al escribir esto). Se omiten los que no son cuenta
-- de banco (el fondo de Alianza Fiduciaria, "EFECTIVO") o cuyo banco no está en
-- la lista. Corre una sola vez: el tercero ya no queda "sin cuentas".
insert into public.terceros_cuentas (tercero_id, banco_id, tipo_cuenta, numero_cuenta, estado, observaciones)
select x.tercero_id, b.id, x.tipo, x.numero, 'PENDIENTE',
       'Cargada desde Proveedores (información bancaria) el 2026-10-23: falta verificarla.'
  from (
    select distinct on (t.id)
           t.id as tercero_id,
           case upper(btrim(ib.entidad_bancaria))
             when 'BANCO BBVA' then 'BBVA'
             when 'BANCO BOGOTA' then 'BANCO DE BOGOTA'
             when 'BOGOTA' then 'BANCO DE BOGOTA'
             else upper(btrim(ib.entidad_bancaria)) end as banco,
           case upper(btrim(ib.tipo_cuenta))
             when 'AHORRO' then 'AHORROS'
             when 'AHORROS' then 'AHORROS'
             when 'CORRIENTE' then 'CORRIENTE' end as tipo,
           regexp_replace(ib.no_cuenta, '\D', '', 'g') as numero
      from public.proveedores pr
      join public.terceros t on t.numero_documento = pr.numero_documento::text
      join public.informacion_bancaria ib on ib.id = pr.unique_id
     where regexp_replace(coalesce(ib.no_cuenta, ''), '\D', '', 'g') <> ''
       and not exists (select 1 from public.terceros_cuentas c where c.tercero_id = t.id)
     order by t.id, ib.created_at desc
  ) x
  join public.bancos b on upper(b.nombre) = x.banco
 where x.tipo is not null;
