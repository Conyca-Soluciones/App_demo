-- T1 (revisión por roles, 2026-10-19): bandeja "Mis pendientes" de CADA
-- persona (decisión del usuario 2026-10-21: no por rol sino por perfil; le
-- sale a todos los que pueden resolverlo y el primero que lo resuelve lo quita
-- de la bandeja de todos).
--
-- No se guarda nada: se calcula en el momento desde el estado de cada cosa, así
-- que nunca queda desactualizada. Qué le sale a cada quien se decide con tres
-- reglas, todas visibles (nada de reglas ocultas por nombre de rol):
--   1. su permiso en la matriz (tiene_accion: Aprobar requisiciones, Comprar...);
--   2. sus proyectos (proyectos_visibles), en lo que va por proyecto. A&F, la
--      maestra de insumos y las cuentas de terceros son globales, igual que su
--      RLS (20261118500000);
--   3. lo suyo: su solicitud de contrato u otrosí devuelto, su acta rechazada,
--      su contrato vencido sin liquidar y sus requisiciones atrasadas.
--
-- Rendimiento: cada bloque filtra por un estado con índice y se evalúa solo si
-- la persona tiene el permiso (los booleanos se calculan una vez). La salida va
-- agrupada por tipo, con el total y como mucho p_por_grupo filas por tipo (las
-- vencidas y las más viejas primero): 310 insumos pendientes son una fila de
-- resumen y 20 detalles, no 310.
--
-- Las pólizas (rama de spr, aún no en main) se agregan cuando se unan.

create index if not exists idx_actas_rechazadas_creador
  on public.actas(creado_por) where estado = 'rechazada';
create index if not exists idx_otrosis_estado
  on public.otrosis(estado, solicitado_por);
create index if not exists idx_requisiciones_solicitante_aprobadas
  on public.requisiciones(solicitado_por, fecha_requerida) where estado = 'aprobada' and estado_compra = 'pendiente';
create index if not exists idx_ordenes_compra_por_recibir
  on public.ordenes_compra(proyecto_id) where estado = 'aprobada' and estado_entrega <> 'entregada';
create index if not exists idx_solicitudes_equipo_estado
  on public.solicitudes_equipo(estado);
create index if not exists idx_pagos_aprobados_sin_tercero
  on public.pagos(aprobado_en) where estado = 'aprobado' and (tercero_id is null or cuenta_tercero_id is null);

-- Todas las filas pendientes de una persona. Interna: solo la llaman
-- mis_pendientes y contar_mis_pendientes con auth.uid() (nadie puede pedir los
-- pendientes de otro).
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
     and r.fecha_requerida < v_hoy;
end;
$function$;

revoke all on function public._pendientes_de(uuid) from public, anon, authenticated;

-- La bandeja de quien consulta, agrupada por tipo: total, suma, el más viejo,
-- cuántos vencidos y como mucho p_por_grupo filas (vencidas y más viejas
-- primero) con el proyecto y el nombre de quien lo envió.
create or replace function public.mis_pendientes(p_por_grupo integer default 20)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with base as (
    select p.*,
           (p.vence is not null and p.vence < (now() at time zone 'America/Bogota')::date) as vencido
      from public._pendientes_de(auth.uid()) p
  ),
  orden as (
    select b.*, row_number() over (partition by b.tipo order by b.vencido desc, b.desde asc nulls last, b.id) as n
      from base b
  )
  select coalesce(jsonb_agg(g order by g->>'categoria', (g->>'mas_antiguo')), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'tipo', o.tipo,
               'categoria', min(o.categoria),
               'total', count(*),
               'monto_total', sum(o.monto),
               'vencidos', count(*) filter (where o.vencido),
               'mas_antiguo', min(o.desde),
               'items', coalesce(jsonb_agg(jsonb_build_object(
                          'id', o.id, 'proyecto_id', o.proyecto_id,
                          'proyecto', coalesce(pr.codigo, pr.nombre),
                          'titulo', o.titulo, 'detalle', o.detalle, 'monto', o.monto,
                          'desde', o.desde, 'de_quien', pf.nombre, 'vence', o.vence,
                          'vencido', o.vencido, 'url', o.url)
                        order by o.n) filter (where o.n <= greatest(least(p_por_grupo, 100), 1)), '[]'::jsonb)
             ) as g
        from orden o
        left join proyectos pr on pr.id = o.proyecto_id
        left join perfiles pf on pf.id = o.de_quien
       group by o.tipo
    ) x;
$function$;

revoke all on function public.mis_pendientes(integer) from public, anon;
grant execute on function public.mis_pendientes(integer) to authenticated;

-- Cuántas cosas le tocan a quien consulta (para el número del menú). Sin
-- seguimiento: solo lo que tiene que hacer.
create or replace function public.contar_mis_pendientes()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select count(*)::integer from public._pendientes_de(auth.uid()) where categoria = 'hacer';
$function$;

revoke all on function public.contar_mis_pendientes() from public, anon;
grant execute on function public.contar_mis_pendientes() to authenticated;
