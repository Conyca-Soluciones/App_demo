-- Requisiciones técnicas sin aprobación (decisión del usuario, 2026-11-07).
--
-- Se saca del flujo la aprobación de requisiciones por Subgerencia técnica:
-- una requisición normal nace APROBADA y pasa de una vez a Requisiciones por
-- comprar; el control queda en la orden de compra (Aprobación de pagos). Las
-- extraordinarias NO cambian: las sigue aprobando Gerencia.
--
-- 1. crear_requisicion inserta las líneas en 'aprobado' (parche de texto sobre
--    la versión viva, falla si no encuentra el texto).
-- 2. cancelar_requisicion: quien la hizo la cancela mientras esté pendiente
--    (extraordinarias) o aprobada sin ninguna línea en una OC vigente.
-- 3. Se quita la pestaña Aprobación de requisiciones de todos los roles. Las
--    acciones aprobar_pedidos / desaprobar_pedidos se dejan: aprobar_pedidos
--    también da lectura en políticas (pedidos_insumos, presupuestos, maestro).
-- Se puede correr más de una vez.

-- 1. -------------------------------------------------------------------------
do $$
declare
  d text := pg_get_functiondef('public.crear_requisicion(jsonb,date,boolean,text,text)'::regprocedure);
  a1 text := 'fecha_requerida, urgente, observaciones, soporte_url, solicitado_por)
  select v_id, x.presupuesto_item_id, x.item_apu_id, x.insumo_id, x.cantidad,
         p_fecha_requerida, coalesce(p_urgente, false), v_obs, p_soporte_url, v_uid
';
  b1 text := 'fecha_requerida, urgente, observaciones, soporte_url, solicitado_por, estado, resuelto_at)
  select v_id, x.presupuesto_item_id, x.item_apu_id, x.insumo_id, x.cantidad,
         p_fecha_requerida, coalesce(p_urgente, false), v_obs, p_soporte_url, v_uid, ''aprobado'', now()
';
begin
  d := replace(d, E'\r\n', E'\n');
  if position(b1 in d) > 0 then
    return;
  end if;
  if position(a1 in d) = 0 then
    raise exception 'crear_requisicion no tiene el texto esperado.';
  end if;
  execute replace(d, a1, b1);
end $$;

-- 2. -------------------------------------------------------------------------
create or replace function public.cancelar_requisicion(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_h record;
  v_motivo text := nullif(trim(p_motivo), '');
  v_n int;
begin
  if v_motivo is null then raise exception 'El motivo de cancelación es obligatorio.'; end if;

  select * into v_h from requisiciones where id = p_id for update;
  if not found then raise exception 'La requisición no existe.'; end if;
  if v_h.solicitado_por is distinct from v_uid then
    raise exception 'Solo quien hizo la requisición puede cancelarla.';
  end if;

  perform 1 from pedidos_insumos where grupo_pedido_id = p_id for update;
  if exists (select 1 from pedidos_insumos where grupo_pedido_id = p_id and estado not in ('pendiente', 'aprobado', 'cancelado'))
     or not exists (select 1 from pedidos_insumos where grupo_pedido_id = p_id and estado in ('pendiente', 'aprobado')) then
    raise exception 'Esta requisición ya no se puede cancelar.';
  end if;
  if exists (select 1 from ordenes_compra_items oci
               join ordenes_compra oc on oc.id = oci.orden_compra_id
               join pedidos_insumos p on p.id = oci.pedido_insumo_id
              where p.grupo_pedido_id = p_id and oc.estado not in ('cancelada', 'rechazada')) then
    raise exception 'La requisición ya está en una orden de compra: no se puede cancelar.';
  end if;

  update pedidos_insumos
     set estado = 'cancelado', cancelado_por = v_uid, cancelado_at = now(), motivo_cancelacion = v_motivo
   where grupo_pedido_id = p_id and estado in ('pendiente', 'aprobado');
  get diagnostics v_n = row_count;

  perform public._evento_requisicion(p_id, 'cancelada', v_motivo, jsonb_build_object('insumos', v_n));
end;
$function$;

-- 3. -------------------------------------------------------------------------
delete from public.rol_permisos
 where permiso = 'tab.tecnico.aprobar_pedidos';
