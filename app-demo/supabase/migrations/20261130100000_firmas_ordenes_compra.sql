-- Firmas en las órdenes de compra (2026-10-21, después de 20261129000000_firmas
-- y 20261130000000_pendientes_firma_y_polizas).
--
-- * Al aprobar una OC se copian las firmas de quien la elaboró y quien la
--   aprobó (entidad 'orden_compra'). No exige firma (no traba compras): sin
--   ella sale solo el nombre.
-- * Una OC se puede desaprobar y volver a aprobar: cada aprobación renueva las
--   firmas (fecha y código) y el PDF congelado lleva el código en su ruta, así
--   que se congela otra vez (lib/documentos-firmados.tsx).
-- * Las OC y actas aprobadas DESPUÉS de que quien aprobó registró su firma (pero
--   antes de esta migración) quedan firmadas con la fecha de su aprobación.
-- * Mis pendientes: "Registra tu firma" también para Comprar y Aprobar OC.
-- Se puede correr más de una vez.

alter table public.documento_firmas drop constraint if exists documento_firmas_entidad_check;
alter table public.documento_firmas add constraint documento_firmas_entidad_check
  check (entidad in ('acta', 'poliza', 'orden_compra'));
alter table public.documentos_firmados drop constraint if exists documentos_firmados_entidad_check;
alter table public.documentos_firmados add constraint documentos_firmados_entidad_check
  check (entidad in ('acta', 'poliza', 'orden_compra'));

-- ---------------------------------------------------------------- al aprobar
create or replace function public._firmar_oc_aprobada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._firmar_documento('orden_compra', new.id, 'elaboro', new.created_by, false);
  perform public._firmar_documento('orden_compra', new.id, 'aprobo', coalesce(new.aprobada_por, auth.uid()), false);
  return null;
end;
$$;
revoke all on function public._firmar_oc_aprobada() from public, anon, authenticated;
drop trigger if exists trg_firmar_oc_aprobada on public.ordenes_compra;
create trigger trg_firmar_oc_aprobada
  after update of estado on public.ordenes_compra
  for each row when (new.estado = 'aprobada' and old.estado is distinct from 'aprobada')
  execute function public._firmar_oc_aprobada();

-- ---------------------------------------------------------------- quién ve qué
create or replace function public._puede_ver_documento(p_entidad text, p_id uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select case p_entidad
    when 'acta' then exists (select 1 from actas a join contratos c on c.id = a.contrato_id
                              where a.id = p_id and public.puede_ver_actas(c.proyecto_id))
    when 'poliza' then public._puede_ver_polizas(auth.uid())
                       and exists (select 1 from contrato_polizas o join contratos c on c.id = o.contrato_id
                                    where o.id = p_id and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id))
    when 'orden_compra' then exists (select 1 from ordenes_compra o
                                      where o.id = p_id and public.usuario_puede_ver_proyecto(auth.uid(), o.proyecto_id))
    else false end;
$$;
revoke all on function public._puede_ver_documento(text, uuid) from public, anon, authenticated;

create or replace function public.verificar_documento(p_sha256 text default null, p_codigo text default null)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_entidad text;
  v_id uuid;
  v_original boolean := false;
  v_titulo text;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión para verificar documentos.';
  end if;
  if p_sha256 is not null then
    select d.entidad, d.entidad_id into v_entidad, v_id from documentos_firmados d where d.sha256 = lower(p_sha256);
    v_original := found;
  elsif p_codigo is not null then
    select f.entidad, f.entidad_id into v_entidad, v_id
      from documento_firmas f where f.codigo = upper(regexp_replace(p_codigo, '[^A-Za-z0-9]', '', 'g'));
  end if;
  if v_id is null then
    return null;
  end if;

  if v_entidad = 'acta' then
    select case a.tipo when 'final' then 'Acta final' when 'liquidacion' then 'Acta de liquidación' else 'Acta parcial' end
           || ' N° ' || a.numero || ' · contrato ' || coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero)
           || ' · ' || k.nombre
      into v_titulo
      from actas a join contratos c on c.id = a.contrato_id join contratistas k on k.id = c.contratista_id
     where a.id = v_id;
  elsif v_entidad = 'orden_compra' then
    select 'Orden de compra N° ' || o.numero || coalesce(' · ' || pv.nombre, '')
      into v_titulo
      from ordenes_compra o left join proveedores pv on pv.unique_id = o.proveedor_id
     where o.id = v_id;
  else
    select 'Acta de aprobación de póliza · contrato ' || coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero)
           || ' · ' || k.nombre
      into v_titulo
      from contrato_polizas o join contratos c on c.id = o.contrato_id join contratistas k on k.id = c.contratista_id
     where o.id = v_id;
  end if;

  return jsonb_build_object(
    'entidad', v_entidad, 'titulo', v_titulo, 'archivo_original', v_original,
    'congelado_at', (select d.created_at from documentos_firmados d where d.entidad = v_entidad and d.entidad_id = v_id),
    'firmas', coalesce((
      select jsonb_agg(jsonb_build_object('papel', f.papel, 'nombre', f.nombre, 'cargo', f.cargo,
                                          'codigo', f.codigo, 'firmado_at', f.firmado_at,
                                          'con_imagen', f.imagen is not null) order by f.firmado_at)
        from documento_firmas f where f.entidad = v_entidad and f.entidad_id = v_id), '[]'::jsonb));
end;
$$;
revoke all on function public.verificar_documento(text, text) from public, anon;
grant execute on function public.verificar_documento(text, text) to authenticated;

-- ---------------------------------------------------------------- aprobadas con la firma ya registrada
-- Solo si quien aprobó ya tenía su firma al aprobar (y sin firmas todavía).
insert into public.documento_firmas (entidad, entidad_id, papel, perfil_id, nombre, cargo, imagen, firmado_at)
select 'orden_compra', o.id, x.papel, p.id, coalesce(p.nombre, 'Usuario'), r.nombre, f.imagen, o.aprobada_at
  from public.ordenes_compra o
  join public.firmas_usuario fa on fa.perfil_id = o.aprobada_por and fa.actualizada_at <= o.aprobada_at
  cross join lateral (values ('elaboro', o.created_by), ('aprobo', o.aprobada_por)) x(papel, perfil)
  join public.perfiles p on p.id = x.perfil
  left join public.roles r on r.id = p.rol_id
  left join public.firmas_usuario f on f.perfil_id = p.id and f.actualizada_at <= o.aprobada_at
 where o.estado = 'aprobada'
   and not exists (select 1 from public.documento_firmas d where d.entidad = 'orden_compra' and d.entidad_id = o.id)
on conflict (entidad, entidad_id, papel) do nothing;

insert into public.documento_firmas (entidad, entidad_id, papel, perfil_id, nombre, cargo, imagen, firmado_at)
select 'acta', a.id, x.papel, p.id, coalesce(p.nombre, 'Usuario'), r.nombre, f.imagen, a.resuelto_at
  from public.actas a
  join public.firmas_usuario fa on fa.perfil_id = a.resuelto_por and fa.actualizada_at <= a.resuelto_at
  cross join lateral (values ('elaboro', a.creado_por), ('aprobo', a.resuelto_por)) x(papel, perfil)
  join public.perfiles p on p.id = x.perfil
  left join public.roles r on r.id = p.rol_id
  left join public.firmas_usuario f on f.perfil_id = p.id and f.actualizada_at <= a.resuelto_at
 where a.estado = 'aprobada'
   and not exists (select 1 from public.documento_firmas d where d.entidad = 'acta' and d.entidad_id = a.id)
on conflict (entidad, entidad_id, papel) do nothing;

-- ---------------------------------------------------------------- Mis pendientes
-- Igual que 20261130000000, con Comprar y Aprobar OC entre quienes firman.
create or replace function public._pendientes_de(p_uid uuid)
returns table (
  tipo text,         -- clave del grupo (lib/pendientes.ts tiene su título)
  categoria text,    -- 'hacer' (le toca a la persona) | 'seguimiento' (lo suyo, en manos de otro)
  id uuid,
  proyecto_id uuid,
  titulo text,
  detalle text,
  monto numeric,
  desde timestamptz, -- desde cuándo espera
  de_quien uuid,     -- quién lo envió o lo creó
  vence date,        -- fecha requerida o de entrega, si tiene
  url text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_proys uuid[] := array(select public.proyectos_visibles(p_uid));
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_aprobar_pedidos boolean := public.tiene_accion(p_uid, 'aprobar_pedidos');
  v_comprar boolean := public.tiene_accion(p_uid, 'comprar');
  v_aprobar_insumos boolean := public.tiene_accion(p_uid, 'aprobar_insumos');
  v_aprobar_mo boolean := public.tiene_accion(p_uid, 'aprobar_mano_obra');
  v_aprobar_oc boolean := public.tiene_accion(p_uid, 'aprobar_oc');
  v_almacen boolean := public.tiene_accion(p_uid, 'gestionar_almacen');
  v_aprobar_pagos boolean := public.tiene_accion(p_uid, 'aprobar_pagos');
  v_gestionar_pagos boolean := public.tiene_accion(p_uid, 'gestionar_pagos');
  v_verificar boolean := public.tiene_accion(p_uid, 'verificar_terceros');
  v_juridica boolean := public.tiene_accion(p_uid, 'aprobar_contratos');
  v_subgerencia boolean := public.tiene_accion(p_uid, 'aprobar_minutas');
  v_revisar_polizas boolean := public.tiene_accion(p_uid, 'aprobar_contratos')
                               and public.tiene_pestana(p_uid, 'contratos.aprobar_polizas');
  -- Firma: quien elabora o aprueba documentos que se firman (actas, pólizas,
  -- órdenes de compra, minutas y otrosí; 20261129000000 y 20261130100000).
  v_firma_pendiente boolean := (public.tiene_accion(p_uid, 'elaborar_actas')
                                or public.tiene_accion(p_uid, 'aprobar_pagos')
                                or public.tiene_accion(p_uid, 'aprobar_contratos')
                                or public.tiene_accion(p_uid, 'aprobar_minutas')
                                or public.tiene_accion(p_uid, 'solicitar_contratos')
                                or public.tiene_accion(p_uid, 'comprar')
                                or public.tiene_accion(p_uid, 'aprobar_oc'))
                               and not exists (select 1 from public.firmas_usuario f where f.perfil_id = p_uid);
begin
  if p_uid is null then
    return;
  end if;

  return query
  -- ------------------------------------------------ Requisiciones por aprobar
  select 'req_por_aprobar', 'hacer', r.id, r.proyecto_id,
         'Requisición N° ' || r.numero,
         r.n_lineas || case when r.n_lineas = 1 then ' insumo' else ' insumos' end
           || case when r.urgente then ' · urgente' else '' end,
         null::numeric, r.created_at, r.solicitado_por, r.fecha_requerida, '/admin-tecnico'
    from requisiciones r
   where v_aprobar_pedidos and r.estado = 'pendiente' and r.proyecto_id = any(v_proys)

  -- ------------------------------------------------ Requisiciones por comprar
  union all
  select 'req_por_comprar', 'hacer', r.id, r.proyecto_id,
         'Requisición N° ' || r.numero,
         r.n_lineas || case when r.n_lineas = 1 then ' insumo' else ' insumos' end
           || case when r.urgente then ' · urgente' else '' end,
         null, r.created_at, r.solicitado_por, r.fecha_requerida, '/almacen/comprar-pedidos'
    from requisiciones r
   where v_comprar and r.estado = 'aprobada' and r.estado_compra = 'pendiente' and r.proyecto_id = any(v_proys)

  -- ------------------------------------------------ Insumos nuevos por aprobar
  -- Van por proyecto (20261118500000); sin presupuesto ligado, a todos.
  union all
  select 'insumo_por_aprobar', 'hacer', s.id, pr.proyecto_id,
         s.descripcion,
         concat_ws(' · ', nullif(s.u_m, ''), nullif(s.tipo, '')),
         s.vr_unitario_propuesto, s.created_at, s.solicitado_por, null::date, '/presupuestos/admin-insumos'
    from solicitudes_insumos s
    left join presupuesto_items pi on pi.id = s.presupuesto_item_id
    left join presupuestos pr on pr.id = pi.presupuesto_id
   where v_aprobar_insumos and s.estado = 'pendiente'
     and (pr.proyecto_id is null or pr.proyecto_id = any(v_proys))

  -- ------------------------------------------------ Mano de obra y equipos por aprobar
  union all
  select 'mo_por_aprobar', 'hacer', s.id, pr.proyecto_id,
         s.descripcion, 'Mano de obra' || coalesce(' · ' || nullif(s.grupo_sugerido, ''), ''),
         s.valor_propuesto, s.created_at, s.solicitado_por, null::date, '/presupuestos/admin-mo'
    from solicitudes_mano_obra s
    left join presupuesto_items pi on pi.id = s.presupuesto_item_id
    left join presupuestos pr on pr.id = pi.presupuesto_id
   where v_aprobar_mo and s.estado = 'pendiente'
     and (pr.proyecto_id is null or pr.proyecto_id = any(v_proys))
  union all
  select 'mo_por_aprobar', 'hacer', s.id, pr.proyecto_id,
         s.descripcion, 'Equipo' || coalesce(' · ' || nullif(s.grupo_sugerido, ''), ''),
         s.valor_propuesto, s.created_at, s.solicitado_por, null::date, '/presupuestos/admin-mo'
    from solicitudes_equipo s
    left join presupuesto_items pi on pi.id = s.presupuesto_item_id
    left join presupuestos pr on pr.id = pi.presupuesto_id
   where v_aprobar_mo and s.estado = 'pendiente'
     and (pr.proyecto_id is null or pr.proyecto_id = any(v_proys))

  -- ------------------------------------------------ OC por aprobar
  union all
  select 'oc_por_aprobar', 'hacer', o.id, o.proyecto_id,
         'OC N° ' || o.numero, coalesce(pv.nombre, 'Sin proveedor'),
         (select round(coalesce(sum(i.cantidad * i.precio_unitario * (1 - i.porcentaje_descuento / 100.0)
                                    * (1 + i.porcentaje_iva / 100.0)), 0), 2)
            from ordenes_compra_items i where i.orden_compra_id = o.id),
         o.created_at, o.created_by, o.fecha_entrega, '/almacen/aprobar-oc'
    from ordenes_compra o
    left join proveedores pv on pv.unique_id = o.proveedor_id
   where v_aprobar_oc and o.estado = 'pendiente_aprobacion' and o.proyecto_id = any(v_proys)

  -- ------------------------------------------------ OC por recibir en bodega
  union all
  select 'oc_por_recibir', 'hacer', o.id, o.proyecto_id,
         'OC N° ' || o.numero,
         coalesce(pv.nombre, 'Sin proveedor') || case when o.estado_entrega = 'entrega_parcial' then ' · entrega parcial' else '' end,
         null, coalesce(o.aprobada_at, o.created_at), o.created_by, o.fecha_entrega, '/almacen/entradas'
    from ordenes_compra o
    left join proveedores pv on pv.unique_id = o.proveedor_id
   where v_almacen and o.estado = 'aprobada' and o.estado_entrega <> 'entregada' and o.proyecto_id = any(v_proys)

  -- ------------------------------------------------ Pagos por aprobar (A&F: global)
  union all
  select 'pago_por_aprobar', 'hacer', g.id, g.proyecto_id,
         g.concepto, coalesce(t.razon_social, 'Sin tercero'),
         g.valor, coalesce(g.solicitado_en, g.creado_en), null::uuid, null::date, '/ayf/aprobacion-pagos'
    from pagos g
    left join terceros t on t.id = g.tercero_id
   where v_aprobar_pagos and g.estado = 'solicitado'

  -- ------------------------------------------------ Pagos aprobados sin tercero o cuenta
  union all
  select 'pago_sin_tercero', 'hacer', g.id, g.proyecto_id,
         g.concepto, case when g.tercero_id is null then 'Sin tercero' else 'Sin cuenta verificada' end,
         g.valor, coalesce(g.aprobado_en, g.creado_en), g.aprobado_por, null::date, '/ayf/consolidado'
    from pagos g
   where v_gestionar_pagos and g.estado = 'aprobado' and (g.tercero_id is null or g.cuenta_tercero_id is null)

  -- ------------------------------------------------ Cuentas de terceros por verificar
  union all
  select 'cuenta_por_verificar', 'hacer', c.id, null::uuid,
         t.razon_social, concat_ws(' · ', b.nombre, '•••• ' || right(c.numero_cuenta, 4)),
         null, c.creado_en, c.creado_por, null::date, '/ayf/terceros'
    from terceros_cuentas c
    join terceros t on t.id = c.tercero_id
    left join bancos b on b.id = c.banco_id
   where v_verificar and c.estado = 'PENDIENTE'

  -- ------------------------------------------------ Contratos por pre-aprobar (Jurídica)
  union all
  select 'contrato_por_preaprobar', 'hacer', c.id, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero), k.nombre,
         c.valor, coalesce(c.enviado_at, c.created_at), c.solicitado_por, null::date, '/contratos/pre-aprobacion'
    from contratos c
    join contratistas k on k.id = c.contratista_id
   where v_juridica and c.estado = 'pre_aprobacion' and c.proyecto_id = any(v_proys)

  -- ------------------------------------------------ Minutas por hacer o corregir (Jurídica)
  union all
  select 'minuta_por_elaborar', 'hacer', c.id, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero),
         k.nombre || case when c.minuta_estado = 'devuelta' then ' · devuelta por Subgerencia' else '' end,
         c.valor, coalesce(c.minuta_resuelta_at, c.resuelto_at, c.created_at), c.solicitado_por, null::date,
         '/contratos/pre-aprobacion'
    from contratos c
    join contratistas k on k.id = c.contratista_id
   where v_juridica and c.estado = 'aprobada' and (c.minuta_estado is null or c.minuta_estado = 'devuelta')
     and c.liquidado_at is null and c.proyecto_id = any(v_proys)

  -- ------------------------------------------------ Minutas por aprobar (Subgerencia)
  union all
  select 'minuta_por_aprobar', 'hacer', c.id, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero), k.nombre,
         c.valor, coalesce(c.minuta_enviada_at, c.created_at), c.minuta_enviada_por, null::date,
         '/contratos/aprobacion-minutas'
    from contratos c
    join contratistas k on k.id = c.contratista_id
   where v_subgerencia and c.minuta_estado = 'en_revision' and c.proyecto_id = any(v_proys)

  -- ------------------------------------------------ Otrosí por revisar (Jurídica) y por aprobar (Subgerencia)
  union all
  select case when o.estado = 'en_revision' then 'otrosi_por_aprobar' else 'otrosi_por_revisar' end, 'hacer',
         o.id, o.proyecto_id,
         'Otrosí al contrato ' || coalesce(c.numero_contrato, 'N° ' || c.numero),
         k.nombre || case when o.estado = 'devuelta_subgerencia' then ' · devuelto por Subgerencia' else '' end,
         o.nuevo_valor,
         case when o.estado = 'en_revision' then coalesce(o.enviada_subgerencia_at, o.enviado_at, o.created_at)
              else coalesce(o.resuelto_at, o.enviado_at, o.created_at) end,
         case when o.estado = 'en_revision' then o.enviada_subgerencia_por else o.solicitado_por end,
         null::date, '/contratos/aprobacion-otrosi'
    from otrosis o
    join contratos c on c.id = o.contrato_id
    join contratistas k on k.id = c.contratista_id
   where o.proyecto_id = any(v_proys)
     and ((v_juridica and o.estado in ('por_revisar', 'devuelta_subgerencia'))
          or (v_subgerencia and o.estado = 'en_revision'))

  -- ------------------------------------------------ Lo mío: solicitud de contrato devuelta
  union all
  select 'mi_contrato_devuelto', 'hacer', c.id, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero),
         k.nombre || coalesce(' · ' || nullif(c.motivo_resolucion, ''), ''),
         c.valor, coalesce(c.resuelto_at, c.created_at), c.resuelto_por, null::date,
         case when c.clase = 'general' then '/contratos/generales' else '/contratos/solicitar' end
    from contratos c
    join contratistas k on k.id = c.contratista_id
   where c.solicitado_por = p_uid and c.estado = 'devuelta'

  -- ------------------------------------------------ Lo mío: otrosí devuelto
  union all
  select 'mi_otrosi_devuelto', 'hacer', o.id, o.proyecto_id,
         'Otrosí al contrato ' || coalesce(c.numero_contrato, 'N° ' || c.numero),
         k.nombre || coalesce(' · ' || nullif(o.motivo, ''), ''),
         o.nuevo_valor, coalesce(o.resuelto_at, o.created_at), o.resuelto_por, null::date, '/contratos/otrosi'
    from otrosis o
    join contratos c on c.id = o.contrato_id
    join contratistas k on k.id = c.contratista_id
   where o.solicitado_por = p_uid and o.estado = 'devuelta'

  -- ------------------------------------------------ Lo mío: acta rechazada (se corrige y se envía otra vez)
  union all
  select 'mi_acta_rechazada', 'hacer', a.id, c.proyecto_id,
         'Acta ' || a.numero || ' · ' || coalesce(c.numero_contrato, 'N° ' || c.numero),
         k.nombre || coalesce(' · ' || nullif(a.motivo_resolucion, ''), ''),
         a.neto, coalesce(a.resuelto_at, a.created_at), a.resuelto_por, null::date, '/contratos/actas'
    from actas a
    join contratos c on c.id = a.contrato_id
    join contratistas k on k.id = c.contratista_id
   where a.creado_por = p_uid and a.estado = 'rechazada' and c.liquidado_at is null

  -- ------------------------------------------------ Contratos vencidos sin liquidar
  -- A quien lo pidió y a Jurídica de sus proyectos.
  union all
  select 'contrato_vencido', 'hacer', c.id, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero), k.nombre || ' · falta el acta de liquidación',
         c.valor, public._fecha_fin_contrato(c.id)::timestamptz, c.solicitado_por, public._fecha_fin_contrato(c.id),
         '/contratos/actas'
    from contratos c
    join contratistas k on k.id = c.contratista_id
   where c.estado = 'aprobada' and c.minuta_estado = 'aprobada' and c.liquidado_at is null
     and (c.solicitado_por = p_uid or (v_juridica and c.proyecto_id = any(v_proys)))
     and public._fecha_fin_contrato(c.id) < v_hoy

  -- ------------------------------------------------ Seguimiento: mis requisiciones atrasadas
  -- Aprobadas, sin comprar del todo y con la fecha requerida ya pasada.
  union all
  select 'mi_req_atrasada', 'seguimiento', r.id, r.proyecto_id,
         'Requisición N° ' || r.numero, 'Aprobada, todavía sin comprar del todo',
         null, r.created_at, null::uuid, r.fecha_requerida, '/almacen/registro-requisiciones/' || r.id
    from requisiciones r
   where r.solicitado_por = p_uid and r.estado = 'aprobada' and r.estado_compra = 'pendiente'
     and r.fecha_requerida < v_hoy

  -- ------------------------------------------------ Mi firma sin registrar
  -- Se registra una vez y se pone sola en lo que la persona apruebe o elabore.
  -- La url '#mi-firma' abre el diálogo de Mi firma (no es una página).
  union all
  select 'mi_firma', 'hacer', p_uid, null::uuid,
         'Registra tu firma', 'Una sola vez: se pone sola en los documentos que apruebes o elabores',
         null, null::timestamptz, null::uuid, null::date, '#mi-firma'
   where v_firma_pendiente

  -- ------------------------------------------------ Lo mío: póliza por subir
  -- Contrato aprobado sin póliza (o con la póliza devuelta por Jurídica).
  union all
  select 'mi_poliza_por_subir', 'hacer', c.id, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero),
         k.nombre || coalesce(' · devuelta: ' || nullif(d.motivo, ''), ''),
         c.valor, coalesce(d.resuelta_at, c.minuta_resuelta_at, c.created_at), d.resuelta_por, null::date,
         '/contratos/polizas'
    from contratos c
    join contratistas k on k.id = c.contratista_id
    left join lateral (select o.motivo, o.resuelta_at, o.resuelta_por from contrato_polizas o
                        where o.contrato_id = c.id and o.estado = 'devuelta'
                        order by o.resuelta_at desc nulls last limit 1) d on true
   where c.solicitado_por = p_uid and c.poliza_estado = 'pendiente' and c.liquidado_at is null

  -- ------------------------------------------------ Pólizas por revisar (Jurídica)
  union all
  select 'poliza_por_revisar', 'hacer', o.id, c.proyecto_id,
         'Póliza del contrato ' || coalesce(c.numero_contrato, 'N° ' || c.numero), k.nombre,
         c.valor, o.created_at, o.subida_por, null::date, '/contratos/aprobacion-polizas'
    from contrato_polizas o
    join contratos c on c.id = o.contrato_id
    join contratistas k on k.id = c.contratista_id
   where v_revisar_polizas and o.estado = 'por_revisar' and c.proyecto_id = any(v_proys);
end;
$function$;

revoke all on function public._pendientes_de(uuid) from public, anon, authenticated;
