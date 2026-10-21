-- Junta las dos versiones de contrato_para_acta que llegaron con el mismo
-- número 20261126000000:
--   * 20261126000000_avance_anterior_actas_sin_porcentaje (rama lcpr): el
--     avance de actas sin porcentaje cuenta lo cobrado como % del valor.
--   * 20261126000000_polizas: devuelve 'poliza_estado', que _guardar_acta usa
--     para no dejar hacer actas sin póliza aprobada.
-- La que corra de última pisa a la otra; si fue la de lcpr, _guardar_acta ve
-- poliza_estado nulo y bloquea TODAS las actas. Esta va después de las dos y
-- trae ambos cambios. detalle_acta no cambia (la de lcpr ya trae lo de otrosí).

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
    -- Pólizas (20261126000000): sin póliza aprobada por Jurídica no hay actas.
    'poliza_estado', v.poliza_estado,
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
