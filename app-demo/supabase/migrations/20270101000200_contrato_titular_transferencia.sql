-- Contrato por Transferencia: casilla "Depositar a otro tercero" (decisión del
-- usuario, 2026-11-12). Se elige un tercero inscrito en Terceros y una de sus
-- cuentas; las actas NUEVAS del contrato lo traen por omisión (el acta lo
-- guarda en actas.titular_tercero_id / cuenta_tercero_id como siempre, y de
-- ahí sale la cuenta del pago). Sin la casilla, la cuenta del contratista.
-- PSE sigue igual (solo el nombre, pse_titular_nombre); la casilla ahora se
-- llama igual en las dos.
--
-- Va ANTES del código: el detalle del contrato llama titular_de_contrato.
-- Se puede correr más de una vez.

alter table public.contratos
  add column if not exists titular_tercero_id uuid references public.terceros(id),
  add column if not exists cuenta_tercero_id uuid references public.terceros_cuentas(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contratos_titular_cuenta_check') then
    alter table public.contratos add constraint contratos_titular_cuenta_check
      check ((titular_tercero_id is null) = (cuenta_tercero_id is null));
  end if;
end $$;

create index if not exists idx_contratos_titular_tercero on public.contratos (titular_tercero_id) where titular_tercero_id is not null;
create index if not exists idx_contratos_cuenta_tercero on public.contratos (cuenta_tercero_id) where cuenta_tercero_id is not null;

-- Mismo _fijar_pago_contrato de 20261224000000 + el tercero de la transferencia
-- (p_datos.titular = {tercero_id, cuenta_id}; null o sin tercero = el contratista).
-- _titular_valido revisa que el tercero esté en Terceros y la cuenta sea suya y
-- no esté inactiva; si es el mismo contratista, queda sin titular aparte.
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
  v_factura uuid;
  v_otro_tercero uuid;
  v_otra_cuenta uuid;
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

  if v_metodo = 'transferencia' and jsonb_typeof(p_datos -> 'titular') = 'object' then
    select k.tercero_id into v_factura
      from public.contratos c
      join public.contratistas k on k.id = c.contratista_id
     where c.id = p_id;
    select o_titular, o_cuenta into v_otro_tercero, v_otra_cuenta
      from public._titular_valido(p_datos -> 'titular', v_factura);
  end if;

  update public.contratos
     set metodo_pago = v_metodo,
         pago_observaciones = case when v_metodo = 'pse' then v_obs end,
         pse_titular_nombre = v_titular,
         titular_tercero_id = v_otro_tercero,
         cuenta_tercero_id = v_otra_cuenta
   where id = p_id;
end;
$$;
revoke all on function public._fijar_pago_contrato(uuid, jsonb) from public, anon, authenticated;

-- El tercero y la cuenta (número enmascarado) para el formulario, el detalle del
-- contrato y el acta nueva. Mismo formato que titular_de_acta. null = cuenta del
-- contratista. Terceros solo lo lee A&F: por eso va por función.
create or replace function public.titular_de_contrato(p_contrato_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not exists (select 1 from public.contratos c
                  where c.id = p_contrato_id and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  select jsonb_build_object(
           'tercero_id', t.id, 'razon_social', t.razon_social, 'tipo_documento', t.tipo_documento,
           'numero_documento', t.numero_documento, 'dv', t.dv,
           'cuenta_id', cu.id, 'banco', b.nombre, 'tipo_cuenta', cu.tipo_cuenta,
           'numero_cuenta', repeat('•', greatest(length(cu.numero_cuenta) - 4, 0)) || right(cu.numero_cuenta, 4),
           'verificada', cu.estado = 'ACTIVO')
    into v
    from public.contratos c
    join public.terceros t on t.id = c.titular_tercero_id
    join public.terceros_cuentas cu on cu.id = c.cuenta_tercero_id
    join public.bancos b on b.id = cu.banco_id
   where c.id = p_contrato_id
     and c.metodo_pago is distinct from 'pse';
  return v;
end;
$$;
revoke all on function public.titular_de_contrato(uuid) from public, anon;
grant execute on function public.titular_de_contrato(uuid) to authenticated;
