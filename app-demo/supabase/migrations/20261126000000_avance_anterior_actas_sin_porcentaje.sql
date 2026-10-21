-- E6 (revisión por roles, 2026-10-19): el "avance anterior" del acta por % de
-- avance (contratos a valor global) salía equivocado cuando había actas sin
-- porcentaje guardado. Las actas hechas antes de 20261112000000 (actas sobre
-- el contrato) cobraron un valor pero no tienen porcentaje_avance: la suma de
-- porcentajes las contaba como 0 %. En CJ-14 el Acta 1 cobró $694.058,38
-- (34,7 %) y el formulario decía "avance anterior 25 %", así que dejaba
-- escribir un % que, sumado, pasaba del 100 %.
--
-- Ahora, si un acta no tiene porcentaje, cuenta lo que cobró como % del valor
-- del contrato (valor_bruto * 100 / valor). Las que sí lo tienen siguen igual.
-- El tope por saldo ya estaba en _guardar_acta y no cambia.
--
-- Va después de 20261123000000 y 20261124000000 (otrosí), que también
-- redefinen estas funciones; este cuerpo es el de esas más el coalesce.
--
-- Cambia: contrato_para_acta (avance_otras) y detalle_acta (avance_anterior).
-- Mismo cuerpo que hoy en la base, solo con ese coalesce.

create or replace function public.contrato_para_acta(p_contrato_id uuid, p_excluir_acta uuid default null::uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v record;
  v_fin date;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_ret numeric;
  v_valor numeric;
begin
  select c.* into v from contratos c where c.id = p_contrato_id;
  if not found or not public.puede_ver_actas(v.proyecto_id) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  v_fin := public._fecha_fin_contrato(p_contrato_id);
  v_ret := public._retencion_porcentaje_contrato(p_contrato_id);
  v_valor := public._valor_contrato(p_contrato_id);

  return jsonb_build_object(
    -- Tope de las actas: el valor vigente (otrosí aprobado). El anticipo es % del inicial.
    'valor', v_valor,
    'valor_inicial', v.valor,
    'anexo_tipo', v.anexo_tipo,
    'anticipo_porcentaje', case when v.tiene_anticipo then v.anticipo_porcentaje end,
    'retencion_porcentaje', v_ret,
    'fecha_fin', v_fin,
    'vencido', v_fin is not null and v_fin < v_hoy,
    'liquidado', v.liquidado_at is not null,
    'listo_para_actas', v.estado = 'aprobada' and v.minuta_estado = 'aprobada',
    -- Ya hay un acta final (por aprobar o aprobada) distinta de la que se edita.
    'tiene_final', exists (select 1 from actas a where a.contrato_id = v.id and a.tipo = 'final'
                             and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    'tiene_liquidacion', exists (select 1 from actas a where a.contrato_id = v.id and a.tipo = 'liquidacion'
                                   and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    'actas_por_aprobar', (select count(*) from actas a where a.contrato_id = v.id and a.estado = 'pendiente'
                            and a.tipo <> 'liquidacion' and a.id is distinct from p_excluir_acta),
    'bruto_otras', (select coalesce(sum(a.valor_bruto), 0) from actas a where a.contrato_id = v.id
                      and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    -- Valor global: si el valor cambió, lo cobrado como % del valor vigente.
    -- Un acta sin porcentaje (de antes de las actas sobre el contrato) cuenta
    -- lo que cobró como % del valor del contrato.
    'avance_otras', (select case when v_valor = v.valor
                                   then coalesce(sum(coalesce(a.porcentaje_avance,
                                                              round(a.valor_bruto * 100 / nullif(v.valor, 0), 4))), 0)
                                 else coalesce(round(sum(a.valor_bruto) * 100 / nullif(v_valor, 0), 4), 0) end
                       from actas a where a.contrato_id = v.id
                       and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    'amortizado_otras', (select coalesce(sum(a.amortizacion), 0) from actas a where a.contrato_id = v.id
                           and a.tipo <> 'liquidacion' and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    -- Para la liquidación: solo lo APROBADO.
    'amortizado_aprobado', (select coalesce(sum(a.amortizacion), 0) from actas a where a.contrato_id = v.id
                              and a.tipo <> 'liquidacion' and a.estado = 'aprobada'),
    'retenido_aprobado', (select coalesce(sum(a.retencion), 0) from actas a where a.contrato_id = v.id
                            and a.tipo <> 'liquidacion' and a.estado = 'aprobada'),
    'actividades', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'orden', i.orden, 'actividad', i.actividad, 'unidad', i.unidad,
               'cantidad', i.cantidad, 'valor_unitario', i.valor_unitario,
               'acumulado', coalesce((
                 select sum(x.cantidad) from acta_actividades x join actas a on a.id = x.acta_id
                 where x.contrato_anexo_item_id = i.id and a.estado <> 'rechazada'
                   and a.id is distinct from p_excluir_acta), 0)
             ) order by i.orden, i.id)
      from contrato_anexo_items i where i.contrato_id = v.id), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.detalle_acta(p_acta_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v record;
  v_valor numeric;
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
  -- Valor vigente cuando se hizo o editó el acta: un otrosí posterior no
  -- cambia el estado del contrato de un acta vieja.
  v_valor := public._valor_contrato(v.contrato_id, greatest(v.created_at, coalesce(v.editada_at, v.created_at)));

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
    'contrato_valor', v_valor, 'objeto', v.objeto, 'tipo_contrato', v.contrato_tipo, 'anexo_tipo', v.anexo_tipo,
    'proyecto_codigo', v.proyecto_codigo, 'proyecto_nombre', v.proyecto_nombre, 'proyecto_ciudad', v.proyecto_ciudad,
    'empresa_nombre', v.empresa_nombre, 'empresa_nit', v.empresa_nit,
    'contratista_id', v.contratista_id, 'contratista_nombre', v.contratista_nombre,
    'contratista_tipo_persona', v.contratista_tipo_persona,
    'contratista_documento', v.contratista_documento, 'contratista_representante', v.contratista_representante,
    -- Lo que usan las actas ANTERIORES a esta (número menor, por aprobar +
    -- aprobadas): el estado del contrato del acta no cambia con actas posteriores.
    'otras_actas', (select coalesce(sum(o.valor_bruto), 0) from actas o
                     where o.contrato_id = v.contrato_id and o.numero < v.numero and o.estado <> 'rechazada'),
    -- Avance acumulado ANTES de esta acta (actas anteriores no rechazadas). Un
    -- acta sin porcentaje cuenta lo que cobró como % del valor del contrato.
    'avance_anterior', (select case when v_valor = v.contrato_valor
                                      then coalesce(sum(coalesce(o.porcentaje_avance,
                                                                 round(o.valor_bruto * 100 / nullif(v.contrato_valor, 0), 4))), 0)
                                    else coalesce(round(sum(o.valor_bruto) * 100 / nullif(v_valor, 0), 4), 0) end
                          from actas o
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
      where i.contrato_id = v.contrato_id
        -- Las actividades de un otrosí solo desde que se aprobó (un acta vieja no cambia).
        and (i.otrosi_id is null
             or exists (select 1 from otrosis ot where ot.id = i.otrosi_id
                         and ot.aprobado_at <= greatest(v.created_at, coalesce(v.editada_at, v.created_at))))), '[]'::jsonb),
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
