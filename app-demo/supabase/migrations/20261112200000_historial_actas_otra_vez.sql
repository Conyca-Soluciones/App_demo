-- historial_entidad: vuelve a aceptar 'acta'. La 20261112100000_visualizacion_ver_contratos
-- (rama main, Sofia) la recreó con admin.visualizacion pero sin la rama de
-- actas que agregó 20261112000000_actas_sobre_contrato (el detalle del acta
-- mostraba "Tipo de historial desconocido"). Esta versión junta las dos.
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
