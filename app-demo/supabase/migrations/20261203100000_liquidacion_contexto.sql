-- A&F · Liquidación de pagos, paso 3: lo que necesita el motor de sugerencias.
--
-- contexto_liquidacion(ids) devuelve en UN jsonb, para un lote de pagos (hasta
-- 200, los de una página de la pantalla): el pago con su desglose, el tercero
-- y su perfil tributario, la memoria de lo que Contabilidad decidió para ese
-- documento (liquidacion_preferencias, que no se lee por la API), qué retiene
-- la empresa, el municipio de ICA del proyecto con sus bases y tarifas, de
-- dónde sale el pago (categorías de los insumos de la OC o tipo de contrato
-- del acta) y la retefuente ya practicada en los anticipos de la misma OC.
-- Más los catálogos (UVT, conceptos, actividades de ICA). El motor (TS,
-- lib/liquidacion.ts) arma la sugerencia; liquidar_pago vuelve a calcular.
-- Costo: una subconsulta indexada por pago (lineal en el lote).

create index if not exists idx_ordenes_compra_items_orden on public.ordenes_compra_items(orden_compra_id);
create index if not exists idx_pagos_orden_tipo on public.pagos(orden_compra_id, tipo);

create or replace function public.contexto_liquidacion(p_pago_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v     jsonb;
begin
  if not (public.tiene_pestana(v_uid, 'ayf.liquidacion') or public.tiene_accion(v_uid, 'liquidar_pagos')) then
    raise exception 'No autorizado -- no tienes acceso a la liquidación de pagos.';
  end if;
  if coalesce(cardinality(p_pago_ids), 0) > 200 then
    raise exception 'Como mucho 200 pagos a la vez.';
  end if;

  with p as (
    select g.id, g.tipo, g.fuente, g.estado, g.valor, g.valor_documento, g.base_gravable, g.iva,
           g.descuento_anticipos, g.retencion_garantia, g.otros_descuentos, g.orden_compra_id, g.acta_id,
           g.tercero_id, g.empresa_id,
           extract(year from coalesce(g.aprobado_en, g.creado_en) at time zone 'America/Bogota')::int as anio,
           t.numero_documento as doc, t.tipo_documento, t.razon_social,
           py.municipio_ica_id as mun_id
      from public.pagos g
      left join public.terceros t on t.id = g.tercero_id
      left join public.proyectos py on py.id = g.proyecto_id
     where g.id = any (p_pago_ids)
  )
  select jsonb_build_object(
    'uvt', (select coalesce(jsonb_object_agg(u.anio::text, u.valor), '{}'::jsonb) from public.uvt u),
    'conceptos', (select coalesce(jsonb_agg(jsonb_build_object(
                     'clave', c.clave, 'nombre', c.nombre, 'tarifa_declarante', c.tarifa_declarante,
                     'tarifa_no_declarante', c.tarifa_no_declarante, 'tarifa_juridica', c.tarifa_juridica,
                     'base_uvt', c.base_uvt, 'natural_tabla_383', c.natural_tabla_383,
                     'actividad_ica', c.actividad_ica) order by c.orden), '[]'::jsonb)
                    from public.retencion_conceptos c where c.activo),
    'actividades', (select coalesce(jsonb_agg(jsonb_build_object('clave', a.clave, 'nombre', a.nombre, 'usa_base', a.usa_base)
                      order by a.orden), '[]'::jsonb) from public.ica_actividades a),
    'pagos', coalesce((select jsonb_object_agg(p.id, jsonb_build_object(
        'tipo', p.tipo, 'fuente', p.fuente, 'estado', p.estado, 'anio', p.anio,
        'valor', p.valor, 'valor_documento', p.valor_documento, 'base_gravable', p.base_gravable, 'iva', p.iva,
        'tercero', case when p.tercero_id is null then null else jsonb_build_object(
                     'documento', p.doc, 'tipo_documento', p.tipo_documento, 'razon_social', p.razon_social) end,
        'perfil', (select jsonb_build_object(
                     'tipo_persona', x.tipo_persona, 'declarante', x.declarante, 'responsable_iva', x.responsable_iva,
                     'regimen_simple', x.regimen_simple, 'autorretenedor', x.autorretenedor,
                     'gran_contribuyente', x.gran_contribuyente, 'zomac', x.zomac, 'ciiu_principal', x.ciiu_principal,
                     'municipio_rut', x.municipio_rut,
                     'fecha_rut', x.fecha_rut, 'estado', x.estado, 'alerta', x.alerta)
                     from public.terceros_tributario x where x.tercero_id = p.tercero_id),
        'empresa', (select jsonb_build_object('agente_retefuente', r.agente_retefuente,
                     'agente_reteiva', r.agente_reteiva, 'confirmado', r.confirmado)
                     from public.empresas_retenciones r where r.empresa_id = p.empresa_id),
        'empresa_ica', exists (select 1 from public.empresas_reteica_municipios em
                                where em.empresa_id = p.empresa_id and em.municipio_id = p.mun_id),
        'municipio', (select jsonb_build_object('id', m.id, 'nombre', m.nombre, 'departamento', m.departamento,
                     'base_compras', m.base_compras, 'base_servicios', m.base_servicios,
                     'base_profesionales', m.base_profesionales,
                     'tarifas', (select coalesce(jsonb_object_agg(it.actividad_clave, it.tarifa), '{}'::jsonb)
                                   from public.ica_tarifas it where it.municipio_id = m.id))
                     from public.municipios m where m.id = p.mun_id),
        'preferencias', (select coalesce(jsonb_agg(jsonb_build_object('tipo', lp.tipo, 'municipio_id', lp.municipio_id,
                     'concepto', lp.concepto_clave, 'actividad', lp.actividad_ica, 'tarifa', lp.tarifa,
                     'veces', lp.veces, 'origen', lp.origen)), '[]'::jsonb)
                     from public.liquidacion_preferencias lp where lp.numero_documento = p.doc),
        -- Letra de la categoría del insumo (MATERIAL - M -> M) con el subtotal
        -- de la OC en esa categoría.
        'categorias', case when p.fuente = 'orden_compra' then (
                     select coalesce(jsonb_object_agg(z.cat, z.total), '{}'::jsonb) from (
                       select coalesce(nullif(btrim(regexp_replace(coalesce(mi.tipo, ''), '^.*-', '')), ''), '?') as cat,
                              round(sum(i.cantidad * i.precio_unitario * (1 - i.porcentaje_descuento / 100.0)), 0) as total
                         from public.ordenes_compra_items i
                         left join public.pedidos_insumos pe on pe.id = i.pedido_insumo_id
                         left join public.maestro_insumos mi on mi.id = pe.insumo_id
                        where i.orden_compra_id = p.orden_compra_id
                        group by 1) z) end,
        'contrato', case when p.fuente = 'acta' then (
                     select jsonb_build_object('tipo', c.tipo, 'clase', c.clase)
                       from public.actas a join public.contratos c on c.id = a.contrato_id
                      where a.id = p.acta_id) end,
        'retefuente_anticipos', case when p.tipo = 'saldo' then (
                     select coalesce(sum(l.retefuente), 0)
                       from public.pagos g2
                       join public.pago_liquidaciones l on l.id = g2.liquidacion_id and l.estado = 'vigente'
                      where g2.orden_compra_id = p.orden_compra_id and g2.tipo = 'anticipo') else 0 end
      )) from p), '{}'::jsonb)
  ) into v;
  return v;
end;
$$;
revoke all on function public.contexto_liquidacion(uuid[]) from public, anon;
grant execute on function public.contexto_liquidacion(uuid[]) to authenticated;
