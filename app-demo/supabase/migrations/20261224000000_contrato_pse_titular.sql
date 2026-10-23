-- Contrato por PSE: casilla "El titular tiene otro nombre" con el nombre del
-- titular (decisión del usuario, 2026-10-23). Sin la casilla, el titular es el
-- contratista. Se guarda en contratos.pse_titular_nombre (solo en PSE) y A&F lo
-- ve en el pago de cada acta.

alter table public.contratos add column if not exists pse_titular_nombre text;

-- Mismo _fijar_pago_contrato de 20261220000000 + el titular.
create or replace function public._fijar_pago_contrato(p_id uuid, p_datos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metodo text := nullif(p_datos ->> 'metodo_pago', '');
  v_obs text := nullif(btrim(coalesce(p_datos ->> 'pago_observaciones', '')), '');
  v_titular text := nullif(btrim(regexp_replace(coalesce(p_datos ->> 'pse_titular_nombre', ''), '\s+', ' ', 'g')), '');
begin
  if v_metodo is null then
    return;
  end if;
  if v_metodo not in ('transferencia', 'pse') then
    raise exception 'El método de pago debe ser Transferencia o PSE.';
  end if;
  if v_metodo = 'pse' and v_obs is null then
    raise exception 'Escribe en observaciones la información para pagar por PSE.';
  end if;
  if v_metodo = 'pse' and coalesce((p_datos ->> 'pse_titular_distinto')::boolean, false) then
    if v_titular is null or length(v_titular) < 3 then
      raise exception 'Escribe el nombre del titular del pago PSE.';
    end if;
  else
    v_titular := null;
  end if;
  update public.contratos
     set metodo_pago = v_metodo,
         pago_observaciones = case when v_metodo = 'pse' then v_obs end,
         pse_titular_nombre = v_titular
   where id = p_id;
end;
$$;
revoke all on function public._fijar_pago_contrato(uuid, jsonb) from public, anon, authenticated;
