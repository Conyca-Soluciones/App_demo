-- ---------------------------------------------------------------------------
-- Ver el contrato desde Solicitud de otrosí (2026-10-20, pedido del usuario).
-- El ingeniero puede no tener las pestañas que dejan leer `contratos`: esta
-- función le da lo que necesita el PDF del contrato (la minuta aprobada, o la
-- hoja del contrato general) a quien tiene una pestaña de otrosí y ve el
-- proyecto, solo de contratos con la minuta aprobada. Mismo formato que la
-- fila de SELECT_HOJA_CONTRATO_GENERAL (lib/contrato-general-hoja.ts) más
-- clase y minuta_datos.
-- ---------------------------------------------------------------------------

create or replace function public.contrato_para_ver_otrosi(p_contrato_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_res jsonb;
begin
  if not public._puede_ver_otrosis(v_uid) then
    raise exception 'No tienes permiso para ver contratos desde otrosí.';
  end if;
  select jsonb_build_object(
           'numero', c.numero, 'numero_contrato', c.numero_contrato, 'tipo', c.tipo, 'clase', c.clase,
           'tipo_detalle', c.tipo_detalle, 'estado', c.estado, 'minuta_estado', c.minuta_estado,
           'valor', c.valor, 'fecha_inicio', c.fecha_inicio, 'fecha_fin', c.fecha_fin, 'forma_pago', c.forma_pago,
           'retencion_garantia_pct', c.retencion_garantia_pct, 'retencion_anticipo_pct', c.retencion_anticipo_pct,
           'retencion_fic_pct', c.retencion_fic_pct, 'referencia', c.referencia, 'objeto', c.objeto,
           'observaciones', c.observaciones, 'enviado_at', c.enviado_at, 'resuelto_at', c.resuelto_at,
           'minuta_resuelta_at', c.minuta_resuelta_at, 'minuta_datos', c.minuta_datos,
           'solicitante', jsonb_build_object('nombre', ps.nombre),
           'resolutor', jsonb_build_object('nombre', pr.nombre),
           'minuta_resolutor', jsonb_build_object('nombre', pm.nombre),
           'proyecto', jsonb_build_object('codigo', p.codigo, 'nombre', p.nombre, 'ciudad', p.ciudad,
                         'empresa', jsonb_build_object('nit', e.nit, 'razon_social', e.razon_social)),
           'contratista', jsonb_build_object('nombre', k.nombre, 'tipo_documento', k.tipo_documento,
                         'numero_documento', k.numero_documento, 'digito_verificacion', k.digito_verificacion,
                         'direccion', k.direccion, 'telefono', k.telefono, 'correo', k.correo, 'ciudad', k.ciudad)
         )
    into v_res
    from contratos c
    join proyectos p on p.id = c.proyecto_id
    left join empresas e on e.id = p.empresa_id
    join contratistas k on k.id = c.contratista_id
    left join perfiles ps on ps.id = c.solicitado_por
    left join perfiles pr on pr.id = c.resuelto_por
    left join perfiles pm on pm.id = c.minuta_resuelta_por
   where c.id = p_contrato_id
     and c.estado = 'aprobada'
     and c.minuta_estado = 'aprobada'
     and c.proyecto_id in (select public.proyectos_visibles(v_uid));
  if v_res is null then
    raise exception 'El contrato no existe, no está aprobado o no tienes acceso.';
  end if;
  return v_res;
end;
$$;
revoke all on function public.contrato_para_ver_otrosi(uuid) from public, anon;
grant execute on function public.contrato_para_ver_otrosi(uuid) to authenticated;
