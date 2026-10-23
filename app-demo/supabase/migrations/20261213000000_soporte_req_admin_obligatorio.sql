-- Requisiciones administrativas: el soporte de cada ítem (factura o cuenta de
-- cobro) pasa a ser OBLIGATORIO (decisión del usuario, 2026-10-23). Antes era
-- opcional (20261212000000). Vale al crear, modificar y corregir: los ítems de
-- requisiciones viejas sin soporte lo piden al modificarlas.
-- _guardar_requisicion_admin ya llama esta validación por cada ítem.

create or replace function public._validar_soporte_req_admin(p_soporte jsonb, p_fila text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ruta text := nullif(btrim(coalesce(p_soporte ->> 'ruta', '')), '');
begin
  if v_ruta is null then
    raise exception '%adjunta el soporte (factura o cuenta de cobro).', p_fila;
  end if;
  if coalesce(p_soporte ->> 'tipo', '') not in ('factura', 'cuenta_cobro') then
    raise exception '%el soporte debe ser una factura o una cuenta de cobro.', p_fila;
  end if;
  if btrim(coalesce(p_soporte ->> 'nombre', '')) = '' then
    raise exception '%falta el nombre del archivo del soporte.', p_fila;
  end if;
  -- El archivo es de quien guarda (solo quien hizo la requisición la modifica).
  if split_part(v_ruta, '/', 1) <> auth.uid()::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'requisiciones_admin' and o.name = v_ruta) then
    raise exception '%no se encontró el archivo del soporte: vuelve a adjuntarlo.', p_fila;
  end if;
end;
$$;
revoke all on function public._validar_soporte_req_admin(jsonb, text) from public, anon, authenticated;
