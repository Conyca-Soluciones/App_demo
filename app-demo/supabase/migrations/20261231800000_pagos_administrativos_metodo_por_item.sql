-- =============================================================================
-- Pagos administrativos: método por ítem (decisión del usuario, 2026-11-06).
--
-- Lo que se llamaba "requisiciones administrativas" (20261202000000) pasa a
-- llamarse PAGOS ADMINISTRATIVOS (ruta /ayf/pagos-administrativos). Las tablas y
-- funciones conservan su nombre (requisiciones_admin, requisicion_admin_items,
-- *_requisicion_admin): solo cambian los textos que ve el usuario. El nombre
-- "requisiciones administrativas" queda para las requisiciones de
-- FUNCIONAMIENTO que compra Compras (20261231900000).
--
-- Cada ÍTEM se paga por transferencia o PSE (antes el cuadro completo era de un
-- solo método): requisicion_admin_items.metodo. requisiciones_admin.metodo pasa
-- a ser el resumen ('transferencia', 'pse' o 'mixto'). Lo demás sigue igual:
-- se envían y se aprueban completos en Aprobación de pagos.
--
-- Los parches son reemplazos de texto exacto sobre la versión viva (fallan si
-- no encuentran el texto).
-- =============================================================================

create or replace function pg_temp.parchar(p_nombre text, p_viejo text, p_nuevo text)
returns void
language plpgsql
as $$
declare
  v_oid oid;
  v_def text;
begin
  select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_nombre;
  v_def := pg_get_functiondef(v_oid);
  if position(p_viejo in v_def) = 0 then
    raise exception 'No se encontró el texto a reemplazar en %: %', p_nombre, left(p_viejo, 80);
  end if;
  execute replace(v_def, p_viejo, p_nuevo);
end;
$$;

-- 1. Columnas ---------------------------------------------------------------------

alter table public.requisicion_admin_items add column if not exists metodo text;
update public.requisicion_admin_items i
   set metodo = r.metodo
  from public.requisiciones_admin r
 where r.id = i.requisicion_id and i.metodo is null;
alter table public.requisicion_admin_items alter column metodo set default 'transferencia';
alter table public.requisicion_admin_items alter column metodo set not null;
alter table public.requisicion_admin_items drop constraint if exists requisicion_admin_items_metodo_check;
alter table public.requisicion_admin_items add constraint requisicion_admin_items_metodo_check
  check (metodo in ('transferencia', 'pse'));

alter table public.requisiciones_admin drop constraint if exists requisiciones_admin_metodo_check;
alter table public.requisiciones_admin add constraint requisiciones_admin_metodo_check
  check (metodo in ('transferencia', 'pse', 'mixto'));

-- 2. Guardar: el método de cada ítem ----------------------------------------------

create or replace function public._guardar_requisicion_admin(p_id uuid, p_metodo text, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_it jsonb;
  v_n integer := 0;
  v_total numeric := 0;
  v_valor numeric;
  v_empresa uuid;
  v_proyecto uuid;
  v_fac record;
  v_tit record;
  v_cuenta uuid;
  v_fac_id uuid;
  v_tit_id uuid;
  v_fac_nombre text;
  v_fac_nit text;
  v_tit_nombre text;
  v_tit_tipo text;
  v_tit_doc text;
  v_fila text;
  v_metodo text;
begin
  -- p_metodo es el de los ítems que no traen el suyo (código de antes).
  if p_metodo is not null and p_metodo not in ('transferencia', 'pse', 'mixto') then
    raise exception 'El método de pago debe ser transferencia o PSE.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un ítem.';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Un cuadro de pagos tiene como máximo 50 ítems.';
  end if;

  delete from public.requisicion_admin_items where requisicion_id = p_id;

  for v_it in select value from jsonb_array_elements(p_items)
  loop
    v_n := v_n + 1;
    v_fila := 'Ítem ' || v_n || ': ';

    v_metodo := coalesce(nullif(v_it ->> 'metodo', ''), nullif(p_metodo, 'mixto'));
    if v_metodo is null or v_metodo not in ('transferencia', 'pse') then
      raise exception '%elige cómo se paga: transferencia o PSE.', v_fila;
    end if;

    v_empresa := nullif(v_it ->> 'empresa_id', '')::uuid;
    if v_empresa is null or not exists (select 1 from public.empresas where id = v_empresa) then
      raise exception '%elige el grupo empresarial.', v_fila;
    end if;
    v_proyecto := nullif(v_it ->> 'proyecto_id', '')::uuid;
    if v_proyecto is null or not exists (select 1 from public.proyectos where id = v_proyecto) then
      raise exception '%elige el código de proyecto.', v_fila;
    end if;
    if btrim(coalesce(v_it ->> 'concepto', '')) = '' then
      raise exception '%escribe el concepto de la factura.', v_fila;
    end if;
    begin
      v_valor := round((v_it ->> 'valor')::numeric, 2);
    exception when others then
      v_valor := null;
    end;
    if v_valor is null or v_valor <= 0 then
      raise exception '%el valor debe ser mayor que cero.', v_fila;
    end if;

    v_cuenta := null;
    v_fac_id := null;
    v_tit_id := null;
    if v_metodo = 'transferencia' then
      select t.id, t.razon_social, t.tipo_documento, t.numero_documento, t.dv into v_fac
        from public.terceros t where t.id = nullif(v_it ->> 'tercero_factura_id', '')::uuid;
      if v_fac.id is null then
        raise exception '%la empresa que factura tiene que estar inscrita en Terceros.', v_fila;
      end if;
      select t.id, t.razon_social, t.tipo_documento, t.numero_documento into v_tit
        from public.terceros t
       where t.id = coalesce(nullif(v_it ->> 'titular_tercero_id', '')::uuid, v_fac.id);
      if v_tit.id is null then
        raise exception '%el titular de la cuenta tiene que estar inscrito en Terceros.', v_fila;
      end if;
      select c.id into v_cuenta
        from public.terceros_cuentas c
       where c.id = nullif(v_it ->> 'cuenta_tercero_id', '')::uuid
         and c.tercero_id = v_tit.id and c.estado <> 'INACTIVO';
      if v_cuenta is null then
        raise exception '%elige una cuenta del titular (registrada en Terceros).', v_fila;
      end if;
      v_fac_id := v_fac.id;
      v_tit_id := v_tit.id;
      v_fac_nombre := v_fac.razon_social;
      v_fac_nit := v_fac.numero_documento || coalesce('-' || v_fac.dv, '');
      v_tit_nombre := v_tit.razon_social;
      v_tit_tipo := v_tit.tipo_documento;
      v_tit_doc := v_tit.numero_documento;
    else
      v_fac_nombre := btrim(coalesce(v_it ->> 'factura_nombre', ''));
      v_fac_nit := regexp_replace(btrim(coalesce(v_it ->> 'factura_nit', '')), '[^0-9-]', '', 'g');
      v_tit_nombre := btrim(coalesce(v_it ->> 'titular_nombre', ''));
      v_tit_tipo := upper(btrim(coalesce(v_it ->> 'titular_tipo_documento', '')));
      v_tit_doc := regexp_replace(coalesce(v_it ->> 'titular_documento', ''), '[^0-9]', '', 'g');
      if v_fac_nombre = '' then
        raise exception '%escribe la empresa que factura.', v_fila;
      end if;
      if v_fac_nit !~ '^[0-9]+(-[0-9])?$' then
        raise exception '%el NIT de la empresa que factura solo lleva números (y el dígito de verificación después de un guion).', v_fila;
      end if;
      if v_tit_nombre = '' then
        raise exception '%escribe el titular de la cuenta.', v_fila;
      end if;
      if v_tit_tipo not in ('CC', 'NIT', 'CE', 'PPT') then
        raise exception '%el tipo de documento del titular debe ser CC, NIT, PPT o CE.', v_fila;
      end if;
      if v_tit_doc = '' then
        raise exception '%escribe el NIT o CC del titular.', v_fila;
      end if;
    end if;

    perform public._validar_soporte_req_admin(v_it -> 'soporte', v_fila);
    insert into public.requisicion_admin_items (
      requisicion_id, orden, metodo, empresa_id, tercero_factura_id, factura_nombre, factura_nit,
      titular_tercero_id, titular_nombre, titular_tipo_documento, titular_documento, cuenta_tercero_id,
      concepto, proyecto_id, valor, observaciones, soporte_ruta, soporte_nombre, soporte_mime, soporte_tamano, soporte_tipo)
    values (
      p_id, v_n, v_metodo, v_empresa,
      v_fac_id, v_fac_nombre, v_fac_nit,
      v_tit_id, v_tit_nombre, v_tit_tipo, v_tit_doc, v_cuenta,
      btrim(v_it ->> 'concepto'), v_proyecto, v_valor, nullif(btrim(coalesce(v_it ->> 'observaciones', '')), ''),
      nullif(btrim(coalesce(v_it -> 'soporte' ->> 'ruta', '')), ''),
      case when nullif(btrim(coalesce(v_it -> 'soporte' ->> 'ruta', '')), '') is not null then btrim(v_it -> 'soporte' ->> 'nombre') end,
      case when nullif(btrim(coalesce(v_it -> 'soporte' ->> 'ruta', '')), '') is not null then v_it -> 'soporte' ->> 'mime' end,
      case when nullif(btrim(coalesce(v_it -> 'soporte' ->> 'ruta', '')), '') is not null then nullif(v_it -> 'soporte' ->> 'tamano', '')::bigint end,
      case when nullif(btrim(coalesce(v_it -> 'soporte' ->> 'ruta', '')), '') is not null then v_it -> 'soporte' ->> 'tipo' end);

    v_total := v_total + v_valor;
  end loop;

  -- Método del cuadro: el de sus ítems, o 'mixto' si tiene de los dos.
  update public.requisiciones_admin r
     set metodo = (select case when count(distinct i.metodo) > 1 then 'mixto' else min(i.metodo) end
                     from public.requisicion_admin_items i where i.requisicion_id = p_id),
         n_items = v_n, valor_total = v_total, enviada_en = now()
   where r.id = p_id;
end;
$$;

revoke all on function public._guardar_requisicion_admin(uuid, text, jsonb) from public, anon, authenticated;

select pg_temp.parchar('crear_requisicion_admin',
  $p$case when p_metodo in ('transferencia', 'pse') then p_metodo else 'transferencia' end$p$,
  $p$case when p_metodo in ('transferencia', 'pse', 'mixto') then p_metodo else 'transferencia' end$p$);

-- 3. El pago de cada ítem toma su método ------------------------------------------

select pg_temp.parchar('_crear_pagos_requisicion_admin',
  $p$upper('Req. administrativa N° ' || v_r.numero || case when v_r.metodo = 'pse' then ' (PSE)' else '' end$p$,
  $p$upper('Pago administrativo N° ' || v_r.numero || case when v_it.metodo = 'pse' then ' (PSE)' else '' end$p$);

-- (Primero el join y después usarlo: una función SQL se valida al crearla.)
select pg_temp.parchar('_pago_novedad',
  $p$left join public.requisiciones_admin r on r.id = p.requisicion_admin_id$p$,
  $p$left join public.requisiciones_admin r on r.id = p.requisicion_admin_id
  left join public.requisicion_admin_items ri on ri.id = p.requisicion_admin_item_id$p$);
select pg_temp.parchar('_pago_novedad',
  $p$case when r.metodo = 'pse' or$p$,
  $p$case when coalesce(ri.metodo, r.metodo) = 'pse' or$p$);

select pg_temp.parchar('detalle_requisicion_admin',
  $p$'id', i.id, 'orden', i.orden,$p$,
  $p$'id', i.id, 'orden', i.orden, 'metodo', i.metodo,$p$);

-- 4. Mis pendientes ---------------------------------------------------------------

select pg_temp.parchar('_pendientes_de',
  $p$case when ra.metodo = 'pse' then 'PSE' end$p$,
  $p$case ra.metodo when 'pse' then 'PSE' when 'mixto' then 'Transferencia y PSE' end$p$);
select pg_temp.parchar('_pendientes_de',
  $p$    left join requisiciones_admin ra on ra.id = g.requisicion_admin_id
   where v_gestionar_pagos$p$,
  $p$    left join requisiciones_admin ra on ra.id = g.requisicion_admin_id
    left join requisicion_admin_items ri on ri.id = g.requisicion_admin_item_id
   where v_gestionar_pagos$p$);
select pg_temp.parchar('_pendientes_de',
  $p$and ra.metodo is distinct from 'pse'$p$,
  $p$and coalesce(ri.metodo, ra.metodo) is distinct from 'pse'$p$);

-- 5. Textos: "pago administrativo" -------------------------------------------------

do $$
declare
  v record;
  v_def text;
begin
  for v in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.prosrc like '%Requisición administrativa%' or p.prosrc like '%requisición administrativa%'
            or p.prosrc like '%/ayf/requisiciones-administrativas%')
  loop
    v_def := pg_get_functiondef(v.oid);
    v_def := replace(v_def, $t$'Requisición administrativa N° ' || v_r.numero || ' aprobada'$t$, $t$'Pago administrativo N° ' || v_r.numero || ' aprobado'$t$);
    v_def := replace(v_def, $t$'Requisición administrativa N° ' || v_r.numero || ' rechazada'$t$, $t$'Pago administrativo N° ' || v_r.numero || ' rechazado'$t$);
    v_def := replace(v_def, 'Requisición administrativa N° ', 'Pago administrativo N° ');
    v_def := replace(v_def, 'Requisición administrativa cancelada: ', 'Pago administrativo cancelado: ');
    v_def := replace(v_def, 'Requisición administrativa modificada.', 'Pago administrativo modificado.');
    v_def := replace(v_def, 'Este pago es de una requisición administrativa: se aprueba con la requisición completa.',
                            'Este pago es de un cuadro de pagos administrativos: se aprueba con el cuadro completo.');
    v_def := replace(v_def, 'Este pago es de una requisición administrativa: se rechaza con la requisición completa.',
                            'Este pago es de un cuadro de pagos administrativos: se rechaza con el cuadro completo.');
    v_def := replace(v_def, '/ayf/requisiciones-administrativas?ver=', '/ayf/pagos-administrativos?ver=');
    execute v_def;
  end loop;
end;
$$;
