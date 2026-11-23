-- Eliminar un soporte de la orden de compra (2026-11-23, decisión del usuario).
--
-- Además de "Añadir soporte" y "Cambiar" (20270101005800), Compras puede eliminar un
-- soporte, con las mismas reglas: acción Comprar y el proyecto de la orden, y mientras
-- ningún pago de la orden esté liquidado ni pagado. La orden no se queda sin soporte:
-- el último no se elimina (se cambia). Historial: soporte_eliminado.
-- Devuelve la ruta del archivo; la app lo borra del bucket. Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

create or replace function public.eliminar_soporte_orden(p_soporte_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s orden_compra_soportes%rowtype;
begin
  select * into v_s from orden_compra_soportes where id = p_soporte_id;
  if not found then
    raise exception 'El soporte no existe.';
  end if;
  perform public._exigir_soportes_orden_editables(v_s.orden_compra_id);
  if (select count(*) from orden_compra_soportes where orden_compra_id = v_s.orden_compra_id) <= 1 then
    raise exception 'La orden no puede quedar sin soporte: usa "Cambiar" para reemplazarlo.';
  end if;
  delete from orden_compra_soportes where id = p_soporte_id;
  perform public._anotar_historial('orden_compra', v_s.orden_compra_id, 'soporte_eliminado',
    jsonb_build_object('archivo', v_s.nombre_archivo, 'tipo', v_s.tipo));
  return v_s.ruta;
end;
$$;

revoke all on function public.eliminar_soporte_orden(uuid) from public;
grant execute on function public.eliminar_soporte_orden(uuid) to authenticated;

commit;
