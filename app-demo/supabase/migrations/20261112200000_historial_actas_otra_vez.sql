-- historial_entidad: vuelve a aceptar 'acta'. La 20261112100000_visualizacion_ver_contratos
-- (rama main, Sofia) la recreó con admin.visualizacion pero sin la rama de
-- actas que agregó 20261112000000_actas_sobre_contrato (el detalle del acta
-- mostraba "Tipo de historial desconocido"). Esta versión junta las dos.
--
-- Además, detalle_acta: "otras actas" pasa a ser solo las ANTERIORES al acta
-- (antes contaba también las posteriores, así que el estado del contrato de un
-- acta ya aprobada, y su PDF, cambiaban al hacer actas nuevas).
create or replace function public.historial_entidad(p_tipo text, p_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  if p_tipo = 'orden_compra' then
    select (public.rol_compras(auth.uid()) or public.usuario_puede_ver_proyecto(auth.uid(), o.proyecto_id))
      into v_ok from public.ordenes_compra o where o.id = p_id;
  elsif p_tipo = 'pedido' then
    select (public.usuario_tiene_acceso_a_item(p.presupuesto_item_id) or public.rol_compras(auth.uid()))
      into v_ok from public.pedidos_insumos p where p.id = p_id;
  elsif p_tipo = 'requisicion' then
    select exists (
      select 1 from public.pedidos_insumos p
      where p.grupo_pedido_id = p_id
        and (public.usuario_tiene_acceso_a_item(p.presupuesto_item_id)
             or public.rol_compras(auth.uid())
             or public.tiene_accion(auth.uid(), 'aprobar_pedidos'))
    ) into v_ok;
  elsif p_tipo = 'contrato' then
    select (
      public.tiene_pestana(auth.uid(), 'contratos.solicitar')
      or public.tiene_pestana(auth.uid(), 'contratos.preaprobacion')
      or public.tiene_pestana(auth.uid(), 'contratos.contratos')
      or public.tiene_pestana(auth.uid(), 'contratos.aprobar_minutas')
      or public.tiene_pestana(auth.uid(), 'admin.visualizacion')
    ) and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
      into v_ok from public.contratos c where c.id = p_id;
  elsif p_tipo = 'acta' then
    select public.puede_ver_actas(c.proyecto_id)
      into v_ok from public.actas a join public.contratos c on c.id = a.contrato_id where a.id = p_id;
  else
    raise exception 'Tipo de historial desconocido.';
  end if;

  if not coalesce(v_ok, false) then
    raise exception 'No tienes permiso para ver este historial.';
  end if;

  if p_tipo = 'requisicion' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre,
               'motivo', h.motivo,
               'datos', case when h.entidad_tipo = 'pedido'
                             then coalesce(h.datos, '{}'::jsonb) || jsonb_build_object('insumo', mi.descripcion)
                             else h.datos end,
               'created_at', h.created_at
             ) order by h.created_at, h.id)
        from public.historial_eventos h
        left join public.perfiles pf on pf.id = h.usuario_id
        left join public.pedidos_insumos pe on h.entidad_tipo = 'pedido' and pe.id = h.entidad_id
        left join public.maestro_insumos mi on mi.id = pe.insumo_id
       where (h.entidad_tipo = 'requisicion' and h.entidad_id = p_id)
          or (h.entidad_tipo = 'pedido' and h.evento = 'rechazado_por_compras'
              and pe.grupo_pedido_id = p_id)
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre,
             'motivo', h.motivo, 'datos', h.datos, 'created_at', h.created_at
           ) order by h.created_at, h.id)
      from public.historial_eventos h
      left join public.perfiles pf on pf.id = h.usuario_id
     where h.entidad_tipo = p_tipo and h.entidad_id = p_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.detalle_acta(p_acta_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v record;
begin
  select a.*, c.proyecto_id, c.numero_contrato, c.numero as contrato_numero, c.valor as contrato_valor,
         c.objeto, c.tipo as contrato_tipo, c.anexo_tipo, c.contratista_id,
         p.codigo as proyecto_codigo, p.nombre as proyecto_nombre, p.ciudad as proyecto_ciudad,
         emp.razon_social as empresa_nombre, emp.nit as empresa_nit,
         k.nombre as contratista_nombre, k.tipo_persona as contratista_tipo_persona,
         k.tipo_documento || ' ' || k.numero_documento || coalesce('-' || k.digito_verificacion, '') as contratista_documento,
         k.representante_nombre as contratista_representante,
         pc.nombre as creado_por_nombre, pr.nombre as resuelto_por_nombre, pe.nombre as editada_por_nombre
    into v
  from actas a
  join contratos c on c.id = a.contrato_id
  join proyectos p on p.id = c.proyecto_id
  left join empresas emp on emp.id = p.empresa_id
  join contratistas k on k.id = c.contratista_id
  left join perfiles pc on pc.id = a.creado_por
  left join perfiles pr on pr.id = a.resuelto_por
  left join perfiles pe on pe.id = a.editada_por
  where a.id = p_acta_id;
  if not found or not public.puede_ver_actas(v.proyecto_id) then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;

  return jsonb_build_object(
    'id', v.id, 'numero', v.numero, 'tipo', v.tipo, 'estado', v.estado,
    'periodo_desde', v.periodo_desde, 'periodo_hasta', v.periodo_hasta, 'observaciones', v.observaciones,
    'porcentaje_avance', v.porcentaje_avance, 'valor_bruto', v.valor_bruto, 'amortizacion', v.amortizacion,
    'retencion', v.retencion, 'devolucion_retencion', v.devolucion_retencion, 'otros_descuentos', v.otros_descuentos,
    'neto', v.neto, 'anticipo_porcentaje', v.anticipo_porcentaje, 'retencion_porcentaje', v.retencion_porcentaje,
    'created_at', v.created_at, 'creado_por_nombre', v.creado_por_nombre,
    'resuelto_at', v.resuelto_at, 'resuelto_por_nombre', v.resuelto_por_nombre,
    'motivo_resolucion', v.motivo_resolucion,
    'editada_at', v.editada_at, 'editada_por_nombre', v.editada_por_nombre,
    'es_mio', v.creado_por is not distinct from auth.uid(),
    'contrato_id', v.contrato_id, 'numero_contrato', coalesce(v.numero_contrato, 'Solicitud N° ' || v.contrato_numero),
    'contrato_valor', v.contrato_valor, 'objeto', v.objeto, 'tipo_contrato', v.contrato_tipo, 'anexo_tipo', v.anexo_tipo,
    'proyecto_codigo', v.proyecto_codigo, 'proyecto_nombre', v.proyecto_nombre, 'proyecto_ciudad', v.proyecto_ciudad,
    'empresa_nombre', v.empresa_nombre, 'empresa_nit', v.empresa_nit,
    'contratista_id', v.contratista_id, 'contratista_nombre', v.contratista_nombre,
    'contratista_tipo_persona', v.contratista_tipo_persona,
    'contratista_documento', v.contratista_documento, 'contratista_representante', v.contratista_representante,
    -- Lo que usan las actas ANTERIORES a esta (número menor, por aprobar +
    -- aprobadas): el estado del contrato del acta no cambia con actas posteriores.
    'otras_actas', (select coalesce(sum(o.valor_bruto), 0) from actas o
                     where o.contrato_id = v.contrato_id and o.numero < v.numero and o.estado <> 'rechazada'),
    -- Avance acumulado ANTES de esta acta (actas anteriores no rechazadas).
    'avance_anterior', (select coalesce(sum(o.porcentaje_avance), 0) from actas o
                         where o.contrato_id = v.contrato_id and o.numero < v.numero and o.estado <> 'rechazada'),
    'actividades', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'orden', i.orden, 'actividad', i.actividad, 'unidad', i.unidad,
               'cantidad_contratada', i.cantidad, 'valor_unitario', i.valor_unitario,
               'acumulado_anterior', coalesce((
                 select sum(x.cantidad) from acta_actividades x join actas o on o.id = x.acta_id
                 where x.contrato_anexo_item_id = i.id and o.estado <> 'rechazada' and o.numero < v.numero), 0),
               'cantidad', aa.cantidad, 'valor', aa.valor
             ) order by i.orden, i.id)
      from contrato_anexo_items i
      left join acta_actividades aa on aa.acta_id = v.id and aa.contrato_anexo_item_id = i.id
      where i.contrato_id = v.contrato_id), '[]'::jsonb),
    'descuentos', coalesce((
      select jsonb_agg(jsonb_build_object('concepto', d.concepto, 'valor', d.valor) order by d.orden)
      from acta_descuentos d where d.acta_id = v.id), '[]'::jsonb),
    'soportes', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'tipo', s.tipo, 'ruta', s.ruta, 'nombre_archivo', s.nombre_archivo,
                                          'tamano', s.tamano, 'mime', s.mime) order by s.created_at, s.id)
      from acta_soportes s where s.acta_id = v.id), '[]'::jsonb),
    'pago', (select jsonb_build_object('id', g.id, 'estado', g.estado, 'valor', g.valor, 'anio', g.anio,
                                       'semana', g.semana, 'item', g.item, 'novedad', g.novedad)
               from pagos g where g.acta_id = v.id and g.estado not in ('anulado', 'rechazado')
              order by g.creado_en desc limit 1),
    'lineas_anteriores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'orden', l.orden, 'item_codigo', l.item_codigo, 'item_descripcion', l.item_descripcion,
               'insumo_descripcion', l.insumo_descripcion, 'unidad', l.unidad, 'cantidad', l.cantidad,
               'precio', l.precio, 'total', l.total) order by l.orden)
      from acta_lineas l where l.acta_id = v.id), '[]'::jsonb)
  );
end;
$function$;
