-- Titular de la cuenta distinto de quien factura, en órdenes de compra y actas
-- (decisión del usuario, 2026-10-23; la requisición administrativa ya lo
-- tenía). Caso: CONSTRUCCIÓN SAS factura, pero la cuenta donde se paga es de
-- Luis Carlos Pérez. El pago sigue siendo DE quien factura (tercero_id, el de
-- las retenciones) y se consigna en la cuenta del titular:
--   pagos.titular_tercero_id  = dueño de cuenta_tercero_id cuando NO es el
--                               tercero (null = la cuenta es del mismo tercero).
-- Compras lo elige al generar la OC y el director al hacer el acta (casilla
-- "El titular de la cuenta es otro tercero"): ordenes_compra / actas guardan
-- titular_tercero_id + cuenta_tercero_id y los pagos los toman de ahí.
-- La requisición administrativa pasa al mismo modelo: antes su pago quedaba a
-- nombre del titular; ahora a nombre de quien factura, con el titular aparte.
--
-- Funciones vivas parchadas (texto exacto; falla si no lo encuentra el número
-- de veces esperado): crear_orden_compra_con_soporte (+ parámetro p_titular),
-- _crear_pagos_orden, resolicitar_pago, _pago_de_acta, crear_acta, editar_acta,
-- _enlazar_pagos_tercero, asignar_tercero_pago, _crear_pagos_requisicion_admin.
-- OJO: pagos tiene ahora DOS llaves hacia terceros: los embeds de PostgREST
-- tienen que nombrar la llave (terceros!pagos_tercero_id_fkey).

-- 1. Columnas ----------------------------------------------------------------

alter table public.pagos
  add column if not exists titular_tercero_id uuid references public.terceros(id);
create index if not exists idx_pagos_titular_tercero on public.pagos(titular_tercero_id)
  where titular_tercero_id is not null;

alter table public.ordenes_compra
  add column if not exists titular_tercero_id uuid references public.terceros(id),
  add column if not exists cuenta_tercero_id uuid references public.terceros_cuentas(id);
alter table public.ordenes_compra drop constraint if exists ordenes_compra_titular_cuenta_check;
alter table public.ordenes_compra add constraint ordenes_compra_titular_cuenta_check
  check ((titular_tercero_id is null) = (cuenta_tercero_id is null));
create index if not exists idx_ordenes_compra_titular on public.ordenes_compra(titular_tercero_id)
  where titular_tercero_id is not null;
create index if not exists idx_ordenes_compra_cuenta_titular on public.ordenes_compra(cuenta_tercero_id)
  where cuenta_tercero_id is not null;

alter table public.actas
  add column if not exists titular_tercero_id uuid references public.terceros(id),
  add column if not exists cuenta_tercero_id uuid references public.terceros_cuentas(id);
alter table public.actas drop constraint if exists actas_titular_cuenta_check;
alter table public.actas add constraint actas_titular_cuenta_check
  check ((titular_tercero_id is null) = (cuenta_tercero_id is null));
create index if not exists idx_actas_titular on public.actas(titular_tercero_id)
  where titular_tercero_id is not null;
create index if not exists idx_actas_cuenta_titular on public.actas(cuenta_tercero_id)
  where cuenta_tercero_id is not null;

-- 2. Validar y guardar el titular --------------------------------------------

-- p_titular = {"tercero_id": ..., "cuenta_id": ...} o null. Titular igual a
-- quien factura = sin titular aparte.
create or replace function public._titular_valido(p_titular jsonb, p_tercero_factura uuid,
                                                  out o_titular uuid, out o_cuenta uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  o_titular := nullif(p_titular ->> 'tercero_id', '')::uuid;
  o_cuenta := nullif(p_titular ->> 'cuenta_id', '')::uuid;
  if o_titular is null then
    o_cuenta := null;
    return;
  end if;
  if not exists (select 1 from public.terceros t where t.id = o_titular) then
    raise exception 'El titular de la cuenta no está inscrito en Terceros.';
  end if;
  if o_cuenta is null then
    raise exception 'Elige la cuenta del titular (registrada en Terceros).';
  end if;
  select c.estado into v_estado from public.terceros_cuentas c where c.id = o_cuenta and c.tercero_id = o_titular;
  if not found then
    raise exception 'La cuenta no pertenece al titular elegido.';
  end if;
  if v_estado = 'INACTIVO' then
    raise exception 'La cuenta del titular está inactiva: elige otra.';
  end if;
  if o_titular = p_tercero_factura then
    o_titular := null;
    o_cuenta := null;
  end if;
end;
$$;

create or replace function public._fijar_titular_orden(p_orden_id uuid, p_titular jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_factura uuid;
  v record;
begin
  select t.id into v_factura
    from public.ordenes_compra oc
    join public.proveedores pr on pr.unique_id = oc.proveedor_id
    join public.terceros t on t.numero_documento = pr.numero_documento::text
   where oc.id = p_orden_id
   limit 1;
  select * into v from public._titular_valido(p_titular, v_factura);
  update public.ordenes_compra set titular_tercero_id = v.o_titular, cuenta_tercero_id = v.o_cuenta
   where id = p_orden_id;
end;
$$;

create or replace function public._fijar_titular_acta(p_acta_id uuid, p_titular jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_factura uuid;
  v record;
begin
  select t.id into v_factura
    from public.actas a
    join public.contratos c on c.id = a.contrato_id
    join public.contratistas k on k.id = c.contratista_id
    join public.terceros t on t.numero_documento = k.numero_documento
   where a.id = p_acta_id
   limit 1;
  select * into v from public._titular_valido(p_titular, v_factura);
  update public.actas set titular_tercero_id = v.o_titular, cuenta_tercero_id = v.o_cuenta
   where id = p_acta_id;
end;
$$;

revoke all on function public._titular_valido(jsonb, uuid) from public, anon, authenticated;
revoke all on function public._fijar_titular_orden(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._fijar_titular_acta(uuid, jsonb) from public, anon, authenticated;

-- Titular guardado de un acta, para corregirla (número de cuenta enmascarado,
-- como cuentas_tercero_requisicion_admin).
create or replace function public.titular_de_acta(p_acta_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not exists (select 1 from public.actas a join public.contratos c on c.id = a.contrato_id
                  where a.id = p_acta_id and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)) then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;
  select jsonb_build_object(
           'tercero_id', t.id, 'razon_social', t.razon_social, 'tipo_documento', t.tipo_documento,
           'numero_documento', t.numero_documento, 'dv', t.dv,
           'cuenta_id', c.id, 'banco', b.nombre, 'tipo_cuenta', c.tipo_cuenta,
           'numero_cuenta', repeat('•', greatest(length(c.numero_cuenta) - 4, 0)) || right(c.numero_cuenta, 4),
           'verificada', c.estado = 'ACTIVO')
    into v
    from public.actas a
    join public.terceros t on t.id = a.titular_tercero_id
    join public.terceros_cuentas c on c.id = a.cuenta_tercero_id
    join public.bancos b on b.id = c.banco_id
   where a.id = p_acta_id;
  return v;
end;
$$;
revoke all on function public.titular_de_acta(uuid) from public, anon;
grant execute on function public.titular_de_acta(uuid) to authenticated;

-- 3. Funciones vivas, parchadas ------------------------------------------------

do $$
declare
  -- función, texto a buscar, reemplazo, veces que debe aparecer
  v_cambios constant text[][] := array[
    ['_crear_pagos_orden',
     'oc.anticipo_porcentaje, oc.saldo_modo, oc.saldo_fecha,',
     'oc.anticipo_porcentaje, oc.saldo_modo, oc.saldo_fecha, oc.titular_tercero_id, oc.cuenta_tercero_id as titular_cuenta_id,',
     '1'],
    ['_crear_pagos_orden',
     '  v_concepto := ''ORDEN DE COMPRA N° ''',
     E'  -- Titular aparte (Generar OC): se paga en su cuenta.\n  if v_oc.titular_tercero_id is not null then\n    v_cuenta := v_oc.titular_cuenta_id;\n  end if;\n\n  v_concepto := ''ORDEN DE COMPRA N° ''',
     '1'],
    ['_crear_pagos_orden',
     'cuenta_tercero_id, concepto, valor, estado,',
     'cuenta_tercero_id, titular_tercero_id, concepto, valor, estado,',
     '3'],
    ['_crear_pagos_orden',
     'v_tercero, v_cuenta, v_concepto',
     'v_tercero, v_cuenta, v_oc.titular_tercero_id, v_concepto',
     '3'],
    ['resolicitar_pago',
     'tercero_id, cuenta_tercero_id, concepto, valor, numero_factura',
     'tercero_id, cuenta_tercero_id, titular_tercero_id, concepto, valor, numero_factura',
     '1'],
    ['resolicitar_pago',
     'v.tercero_id, v.cuenta_tercero_id, v.concepto',
     'v.tercero_id, v.cuenta_tercero_id, v.titular_tercero_id, v.concepto',
     '1'],
    ['_pago_de_acta',
     'k.numero_documento, k.nombre as contratista_nombre, py.empresa_id, e.consolidado_id',
     'k.numero_documento, k.nombre as contratista_nombre, py.empresa_id, e.consolidado_id, a.titular_tercero_id, a.cuenta_tercero_id as titular_cuenta_id',
     '1'],
    ['_pago_de_acta',
     '  v_concepto := upper(case v.tipo',
     E'  -- Titular aparte (formulario del acta): se paga en su cuenta.\n  if v.titular_tercero_id is not null then\n    v_cuenta := v.titular_cuenta_id;\n  end if;\n  v_concepto := upper(case v.tipo',
     '1'],
    ['_pago_de_acta',
     'cuenta_tercero_id = coalesce(cuenta_tercero_id, v_cuenta)',
     E'cuenta_tercero_id = case when v.titular_tercero_id is not null or titular_tercero_id is not null\n                                              then v_cuenta else coalesce(cuenta_tercero_id, v_cuenta) end,\n                     titular_tercero_id = v.titular_tercero_id',
     '1'],
    ['_pago_de_acta',
     'cuenta_tercero_id, concepto, valor, estado, solicitado_en)',
     'cuenta_tercero_id, titular_tercero_id, concepto, valor, estado, solicitado_en)',
     '1'],
    ['_pago_de_acta',
     'v.consolidado_id, v_tercero, v_cuenta,',
     'v.consolidado_id, v_tercero, v_cuenta, v.titular_tercero_id,',
     '1'],
    ['crear_acta',
     '  perform public._pago_de_acta(p_acta_id);',
     E'  perform public._fijar_titular_acta(p_acta_id, p_datos -> ''titular'');\n  perform public._pago_de_acta(p_acta_id);',
     '1'],
    ['editar_acta',
     '  perform public._pago_de_acta(p_acta_id);',
     E'  perform public._fijar_titular_acta(p_acta_id, p_datos -> ''titular'');\n  perform public._pago_de_acta(p_acta_id);',
     '1'],
    ['_enlazar_pagos_tercero',
     '         and pg.cuenta_tercero_id is null',
     E'         and pg.cuenta_tercero_id is null\n         and pg.titular_tercero_id is null',
     '1'],
    ['asignar_tercero_pago',
     'select 1 from public.terceros_cuentas where id = p_cuenta_id and tercero_id = p_tercero_id',
     'select 1 from public.terceros_cuentas where id = p_cuenta_id and (tercero_id = p_tercero_id'
       || ' or tercero_id = (select g.titular_tercero_id from public.pagos g where g.id = p_pago_id))',
     '1'],
    ['asignar_tercero_pago',
     'set tercero_id = p_tercero_id, cuenta_tercero_id = p_cuenta_id, cuenta_modificada = null',
     E'set tercero_id = p_tercero_id, cuenta_tercero_id = p_cuenta_id, cuenta_modificada = null,\n'
       || E'         -- Se conserva el titular si la cuenta sigue siendo la suya.\n'
       || E'         titular_tercero_id = case when titular_tercero_id is distinct from p_tercero_id and exists (\n'
       || E'           select 1 from public.terceros_cuentas x where x.id = p_cuenta_id and x.tercero_id = pagos.titular_tercero_id)\n'
       || E'           then titular_tercero_id end',
     '1'],
    ['_crear_pagos_requisicion_admin',
     'consolidado_id, tercero_id, cuenta_tercero_id, concepto, valor, estado, solicitado_en)',
     'consolidado_id, tercero_id, cuenta_tercero_id, titular_tercero_id, concepto, valor, estado, solicitado_en)',
     '1'],
    ['_crear_pagos_requisicion_admin',
     'v_it.titular_tercero_id, v_it.cuenta_tercero_id,',
     'coalesce(v_it.tercero_factura_id, v_it.titular_tercero_id), v_it.cuenta_tercero_id,'
       || ' nullif(v_it.titular_tercero_id, v_it.tercero_factura_id),',
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
    v_n := (length(v_def) - length(replace(v_def, v_cambios[i][2], ''))) / length(v_cambios[i][2]);
    if v_n <> v_cambios[i][4]::int then
      raise exception 'En % se esperaba encontrar % veces el texto % (veces: %): ¿cambió la función?',
        v_cambios[i][1], v_cambios[i][4], v_cambios[i][2], v_n;
    end if;
    execute replace(v_def, v_cambios[i][2], v_cambios[i][3]);
  end loop;
end $$;

-- crear_orden_compra_con_soporte: parámetro nuevo p_titular (cambia la firma:
-- se borra la anterior para que PostgREST no tenga dos candidatas).
do $$
declare
  v_def text;
  v_viejo constant text := 'p_saldo_fecha date DEFAULT NULL::date)';
  v_perform constant text := '  perform public._crear_pagos_orden(v_id);';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'crear_orden_compra_con_soporte'
     and pg_get_function_identity_arguments(p.oid) not like '%p_titular%';
  if v_def is null then
    if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname = 'crear_orden_compra_con_soporte'
                 and pg_get_function_identity_arguments(p.oid) like '%p_titular%') then
      return;  -- ya se corrió
    end if;
    raise exception 'No existe crear_orden_compra_con_soporte.';
  end if;
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1
     or (length(v_def) - length(replace(v_def, v_perform, ''))) / length(v_perform) <> 1 then
    raise exception 'crear_orden_compra_con_soporte cambió: revisa el parche.';
  end if;
  v_def := replace(v_def, v_viejo, 'p_saldo_fecha date DEFAULT NULL::date, p_titular jsonb DEFAULT NULL::jsonb)');
  v_def := replace(v_def, v_perform,
                   E'  perform public._fijar_titular_orden(v_id, p_titular);\n' || v_perform);
  drop function public.crear_orden_compra_con_soporte(uuid, uuid, text, date, text, text, text, text, text, text,
                                                      jsonb, jsonb, numeric, text, date);
  execute v_def;
end $$;
revoke all on function public.crear_orden_compra_con_soporte(uuid, uuid, text, date, text, text, text, text, text, text,
                                                             jsonb, jsonb, numeric, text, date, jsonb) from public, anon;
grant execute on function public.crear_orden_compra_con_soporte(uuid, uuid, text, date, text, text, text, text, text, text,
                                                               jsonb, jsonb, numeric, text, date, jsonb) to authenticated;

-- 4. Pagos de requisiciones administrativas que ya existían -------------------
-- (a nombre de quien factura, con el titular aparte cuando es otro).
update public.pagos g
   set tercero_id = i.tercero_factura_id, titular_tercero_id = i.titular_tercero_id
  from public.requisicion_admin_items i
 where g.requisicion_admin_item_id = i.id
   and i.tercero_factura_id is not null
   and i.titular_tercero_id is distinct from i.tercero_factura_id
   and g.titular_tercero_id is null;
