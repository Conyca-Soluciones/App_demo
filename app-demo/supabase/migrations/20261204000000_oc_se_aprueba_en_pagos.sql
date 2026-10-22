-- ---------------------------------------------------------------------------
-- Las órdenes de compra se aprueban en A&F › Aprobación de pagos
-- (decisión del usuario, 2026-10-22). Se quita "Aprobación de órdenes de
-- compra" de AdPro. Flujo:
--
--   Compras genera la OC -> nace pendiente de aprobación y su pago (único o
--   anticipo) nace 'solicitado' en Aprobación de pagos -> A&F lo aprueba -> la
--   OC queda 'aprobada' en AdPro (lista para recibir en almacén) y el pago, con
--   su ITEM, pasa al consolidado. Si A&F rechaza ese pago, la OC queda
--   rechazada con el mismo motivo.
--
-- El saldo de una OC con anticipo sigue igual: nace 'programado' y llega a
-- Aprobación de pagos con la entrega o 3 días antes de su fecha.
-- Devolver (desaprobar) una OC aprobada anula sus pagos y le crea otra vez el
-- pago por aprobar: vuelve a A&F. Retirarla o cancelarla anula sus pagos.
--
-- Reemplaza a la primera versión de este archivo (Subgerencia aprobaba la OC),
-- que no se llegó a correr. Se puede correr dos veces.
-- ---------------------------------------------------------------------------

-- 1. Pagos de la OC: se crean al crear la orden (pendiente) y el único o el
--    anticipo nacen por aprobar.
create or replace function public._crear_pagos_orden(p_orden_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_oc        record;
  v_total     numeric;
  v_anticipo  numeric;
  v_tercero   uuid;
  v_cuenta    uuid;
  v_concepto  text;
  v_ids       uuid[];
  v_id        uuid;
begin
  select oc.id, oc.numero, oc.estado, oc.proyecto_id, oc.proveedor_id, oc.created_at,
         oc.anticipo_porcentaje, oc.saldo_modo, oc.saldo_fecha,
         py.empresa_id, e.consolidado_id, pr.nombre as proveedor_nombre,
         pr.numero_documento::text as proveedor_documento
    into v_oc
    from public.ordenes_compra oc
    left join public.proyectos py on py.id = oc.proyecto_id
    left join public.empresas e on e.id = py.empresa_id
    left join public.proveedores pr on pr.unique_id = oc.proveedor_id
   where oc.id = p_orden_id;

  if not found or v_oc.estado not in ('pendiente_aprobacion', 'aprobada') then
    return;
  end if;
  if exists (
    select 1 from public.pagos
     where orden_compra_id = p_orden_id and estado not in ('anulado','rechazado')
  ) then
    return;
  end if;

  v_total := round(public.total_orden_compra(p_orden_id), 0);
  if v_total <= 0 then
    return;  -- una orden en cero no genera pago
  end if;

  -- El tercero sale del documento del proveedor; la cuenta se elige sola solo
  -- si el tercero tiene exactamente UNA cuenta verificada.
  select t.id into v_tercero
    from public.terceros t
   where t.numero_documento = v_oc.proveedor_documento;
  if v_tercero is not null then
    select c.id into v_cuenta
      from public.terceros_cuentas c
     where c.tercero_id = v_tercero and c.estado = 'ACTIVO'
       and (select count(*) from public.terceros_cuentas x
             where x.tercero_id = v_tercero and x.estado = 'ACTIVO') = 1;
  end if;

  v_concepto := 'ORDEN DE COMPRA N° ' || v_oc.numero || ' - ' || coalesce(upper(v_oc.proveedor_nombre), '');

  v_anticipo := case when v_oc.anticipo_porcentaje is null then null
                     else round(v_total * v_oc.anticipo_porcentaje / 100.0, 0) end;

  if v_anticipo is null or v_anticipo <= 0 or v_anticipo >= v_total then
    -- sin anticipo (o uno que redondeado no tiene sentido): un solo pago
    insert into public.pagos (
      fuente, orden_compra_id, tipo, proyecto_id, empresa_id, consolidado_id, tercero_id,
      cuenta_tercero_id, concepto, valor, estado, solicitado_en
    ) values (
      'orden_compra', p_orden_id, 'unico', v_oc.proyecto_id, v_oc.empresa_id, v_oc.consolidado_id,
      v_tercero, v_cuenta, v_concepto, v_total, 'solicitado', now()
    ) returning id into v_id;
    v_ids := array[v_id];
  else
    insert into public.pagos (
      fuente, orden_compra_id, tipo, proyecto_id, empresa_id, consolidado_id, tercero_id,
      cuenta_tercero_id, concepto, valor, estado, solicitado_en
    ) values (
      'orden_compra', p_orden_id, 'anticipo', v_oc.proyecto_id, v_oc.empresa_id, v_oc.consolidado_id,
      v_tercero, v_cuenta, v_concepto || ' - ANTICIPO', v_anticipo, 'solicitado', now()
    ) returning id into v_id;
    v_ids := array[v_id];

    insert into public.pagos (
      fuente, orden_compra_id, tipo, proyecto_id, empresa_id, consolidado_id, tercero_id,
      cuenta_tercero_id, concepto, valor, estado, fecha_programada
    ) values (
      'orden_compra', p_orden_id, 'saldo', v_oc.proyecto_id, v_oc.empresa_id, v_oc.consolidado_id,
      v_tercero, v_cuenta, v_concepto || ' - SALDO', v_total - v_anticipo, 'programado',
      case when v_oc.saldo_modo = 'fecha' then v_oc.saldo_fecha end
    ) returning id into v_id;
    v_ids := v_ids || v_id;
  end if;

  foreach v_id in array v_ids loop
    perform public._pago_asignar_item(v_id);  -- no hace nada hasta que se apruebe
    perform public._pago_actualizar_novedad(v_id);
  end loop;
end;
$function$;

-- 2. Crear la OC crea su pago por aprobar. Una OC en $0 no tiene pago con el
--    que aprobarse: no se deja crear.
create or replace function public.crear_orden_compra_con_soporte(p_proyecto_id uuid, p_proveedor_id uuid, p_sitio_entrega text, p_fecha_entrega date, p_contacto_nombre text, p_telefono text, p_ciudad text, p_email text, p_condiciones_pago text, p_observaciones text, p_lineas jsonb, p_soporte jsonb, p_anticipo_porcentaje numeric DEFAULT NULL::numeric, p_saldo_modo text DEFAULT NULL::text, p_saldo_fecha date DEFAULT NULL::date)
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

  if round(public.total_orden_compra(v_id), 0) <= 0 then
    raise exception 'La orden de compra no puede quedar en $ 0: revisa los precios.';
  end if;

  insert into orden_compra_soportes (orden_compra_id, tipo, ruta, nombre_archivo, tamano, mime, subido_por)
  values (v_id, v_tipo, v_ruta, coalesce(nullif(trim(p_soporte->>'nombre_archivo'), ''), 'soporte'),
          nullif(p_soporte->>'tamano', '')::bigint, p_soporte->>'mime', auth.uid());

  perform public._crear_pagos_orden(v_id);
  return v_id;
end;
$function$;

-- 3. La OC sigue a su pago: aprobar el único o el anticipo aprueba la OC;
--    rechazarlo la rechaza con el mismo motivo.
create or replace function public._oc_sigue_pago()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.fuente <> 'orden_compra' or new.orden_compra_id is null
     or new.tipo not in ('unico', 'anticipo') or old.estado <> 'solicitado' then
    return null;
  end if;

  if new.estado = 'aprobado' then
    update public.ordenes_compra
       set estado = 'aprobada', aprobada_por = new.aprobado_por,
           aprobada_at = coalesce(new.aprobado_en, now()), motivo_rechazo = null
     where id = new.orden_compra_id and estado = 'pendiente_aprobacion';
  elsif new.estado = 'rechazado' then
    update public.ordenes_compra
       set estado = 'rechazada', aprobada_por = new.rechazado_por,
           aprobada_at = coalesce(new.rechazado_en, now()), motivo_rechazo = new.motivo_rechazo
     where id = new.orden_compra_id and estado = 'pendiente_aprobacion';
  end if;
  return null;
end;
$function$;
revoke all on function public._oc_sigue_pago() from public, anon, authenticated;

drop trigger if exists trg_oc_sigue_pago on public.pagos;
create trigger trg_oc_sigue_pago
  after update of estado on public.pagos
  for each row when (old.estado is distinct from new.estado)
  execute function public._oc_sigue_pago();

-- 4. Pagos según el estado de la OC.
create or replace function public._oc_estado_pagos()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.estado = 'aprobada' then
    -- Normalmente el pago ya existe (la OC se aprobó con él). Por si no.
    begin
      perform public._crear_pagos_orden(new.id);
    exception when others then
      raise warning 'No se pudieron crear los pagos de la orden %: %', new.id, sqlerrm;
      begin
        insert into public.pagos_fallos (orden_compra_id, error) values (new.id, sqlerrm);
      exception when others then
        null;
      end;
    end;

  elsif new.estado in ('pendiente_aprobacion', 'cancelada', 'rechazada') then
    if exists (
      select 1 from public.pagos
       where orden_compra_id = new.id and estado in ('en_dispersion', 'dispersado')
    ) then
      raise exception
        'No se puede devolver ni cancelar la orden: ya tiene un pago en dispersión o pagado. Resuélvelo primero con Financiera.';
    end if;

    update public.pagos
       set estado = 'anulado', anulado_en = now(),
           motivo_anulacion = case new.estado
             when 'cancelada' then 'La orden de compra fue cancelada.'
             when 'rechazada' then 'La orden de compra fue rechazada.'
             else 'La orden de compra fue devuelta a pendiente.' end
     where orden_compra_id = new.id
       and estado in ('programado', 'solicitado', 'aprobado', 'liquidado');

    -- Los fallos de una orden que ya no está aprobada dejan de importar.
    update public.pagos_fallos set resuelto_en = now()
     where orden_compra_id = new.id and resuelto_en is null;

    -- Devuelta a pendiente: vuelve a Aprobación de pagos con un pago nuevo.
    if new.estado = 'pendiente_aprobacion' then
      perform public._crear_pagos_orden(new.id);
    end if;
  end if;
  return null;
end;
$function$;

-- 5. Ya no se aprueba ni se rechaza la OC por fuera de su pago.
create or replace function public.aprobar_orden_compra(p_orden_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  raise exception 'Las órdenes de compra se aprueban en A&F › Aprobación de pagos, al aprobar su pago.';
end;
$function$;

create or replace function public.rechazar_orden_compra(p_orden_id uuid, p_motivo text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  raise exception 'Las órdenes de compra se rechazan en A&F › Aprobación de pagos, al rechazar su pago.';
end;
$function$;
revoke all on function public.aprobar_orden_compra(uuid) from public, anon;
revoke all on function public.rechazar_orden_compra(uuid, text) from public, anon;
revoke all on function public._aprobar_orden_compra_sin_proyecto(uuid) from public, anon, authenticated;
revoke all on function public._rechazar_orden_compra_sin_proyecto(uuid, text) from public, anon, authenticated;

-- 6. Pendientes y avisos que iban a quien aprobaba OC.
do $$
declare
  v_fn regprocedure;
  v_def text;
  v_nuevo text;
begin
  -- Mis pendientes: ya no hay "OC por aprobar" (sale como pago por aprobar).
  v_fn := 'public._pendientes_de(uuid)'::regprocedure;
  v_def := pg_get_functiondef(v_fn);
  v_nuevo := replace(v_def, 'v_aprobar_oc boolean := public.tiene_accion(p_uid, ''aprobar_oc'');',
                     'v_aprobar_oc boolean := false;  -- la OC se aprueba con su pago en A&F (20261204000000)');
  if v_nuevo <> v_def then execute v_nuevo; end if;

  -- Avisos de precio alto y de insumo sobre presupuesto: a quien aprueba pagos.
  foreach v_fn in array array['public.notificar_precio_sobre_efectivo_oc_item()'::regprocedure,
                              'public.notificar_insumo_sobre_presupuesto()'::regprocedure]
  loop
    v_def := pg_get_functiondef(v_fn);
    v_nuevo := replace(v_def, 'tiene_accion(p.id, ''aprobar_oc'')', 'tiene_accion(p.id, ''aprobar_pagos'')');
    if v_nuevo <> v_def then execute v_nuevo; end if;
  end loop;
end $$;

-- 7. A&F ve lo que aprueba: líneas, insumos y proveedor de las OC con pago.
drop policy if exists ordenes_compra_items_select_de_pagos on public.ordenes_compra_items;
create policy ordenes_compra_items_select_de_pagos on public.ordenes_compra_items
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
         or public.tiene_pestana((select auth.uid()), 'ayf.consolidado'))
    and orden_compra_id in (select pg.orden_compra_id from public.pagos pg)
  );

drop policy if exists pedidos_insumos_select_de_pagos on public.pedidos_insumos;
create policy pedidos_insumos_select_de_pagos on public.pedidos_insumos
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
         or public.tiene_pestana((select auth.uid()), 'ayf.consolidado'))
    and id in (select i.pedido_insumo_id from public.ordenes_compra_items i
                where i.orden_compra_id in (select pg.orden_compra_id from public.pagos pg))
  );

drop policy if exists proveedores_select_de_pagos on public.proveedores;
create policy proveedores_select_de_pagos on public.proveedores
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
         or public.tiene_pestana((select auth.uid()), 'ayf.consolidado'))
    and unique_id in (select o.proveedor_id from public.ordenes_compra o
                       where o.id in (select pg.orden_compra_id from public.pagos pg))
  );

-- 8. Sin la pestaña ni la acción de aprobar OC en AdPro.
delete from public.rol_permisos
 where permiso in ('tab.compras.aprobar_oc', 'accion.aprobar_oc');

-- 9. Las OC que estaban pendientes de aprobación pasan a Aprobación de pagos.
do $$
declare
  v_id uuid;
begin
  for v_id in
    select o.id from public.ordenes_compra o
     where o.estado = 'pendiente_aprobacion'
       and not exists (select 1 from public.pagos p
                        where p.orden_compra_id = o.id and p.estado not in ('anulado', 'rechazado'))
  loop
    perform public._crear_pagos_orden(v_id);
  end loop;
end $$;
