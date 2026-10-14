-- Control del proyecto (pestaña admin.visualizacion): ver el detalle de un
-- contrato del proyecto (botón "Ver" en la pestaña Contratos): sus datos, el
-- nombre del contratista y el historial. Solo LECTURA y solo de los proyectos
-- que la persona ve; no da acceso a los documentos del contratista. Las tablas
-- hijas del contrato (obligaciones, entregables, anexo) miran contratos_select.
-- Recrea las versiones de 20261111000000_aprobacion_minutas.sql con la pestaña
-- de más. Se puede correr más de una vez.

drop policy if exists contratos_select on public.contratos;
create policy contratos_select on public.contratos for select to authenticated
  using (
    (
      (select public.tiene_pestana((select auth.uid()), 'contratos.solicitar'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.contratos'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_minutas'))
      or (select public.tiene_pestana((select auth.uid()), 'admin.visualizacion'))
    )
    and proyecto_id in (select public.proyectos_visibles((select auth.uid())))
  );

drop policy if exists contratistas_select on public.contratistas;
create policy contratistas_select on public.contratistas for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'contratos.contratistas'))
    or (select public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion'))
    or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_minutas'))
    or (select public.tiene_pestana((select auth.uid()), 'admin.visualizacion'))
    or (select public.tiene_accion((select auth.uid()), 'gestionar_contratistas'))
    or (select public.tiene_accion((select auth.uid()), 'solicitar_contratos'))
  );

create or replace function public.historial_entidad(p_tipo text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
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
