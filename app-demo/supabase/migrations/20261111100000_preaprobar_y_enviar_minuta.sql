-- Pre-aprobar y enviar la minuta a Subgerencia en un solo paso (decisión del
-- usuario: antes eran dos botones y no se entendía a dónde iba el contrato).
-- Jurídica pulsa "Pre-aprobar y enviar a Subgerencia": la solicitud pasa a
-- 'aprobada' y su minuta (p_datos, armada por la app) a 'en_revision' en la
-- misma transacción; si algo falla, no cambia nada. Reutiliza las dos
-- funciones existentes, que validan permiso, proyecto y estado cada una.
-- enviar_minuta_contrato sigue sirviendo para enviar otra vez una minuta
-- devuelta (y para pre-aprobadas que nunca se enviaron).
-- Se puede correr más de una vez.

create or replace function public.preaprobar_y_enviar_minuta(p_id uuid, p_datos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.resolver_solicitud_contrato(p_id, 'aprobar', null);
  perform public.enviar_minuta_contrato(p_id, p_datos);
end;
$$;
revoke all on function public.preaprobar_y_enviar_minuta(uuid, jsonb) from public, anon;
grant execute on function public.preaprobar_y_enviar_minuta(uuid, jsonb) to authenticated;
