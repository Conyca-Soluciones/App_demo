-- Pendientes del Paquete H (decisiones del usuario, 2026-11-12/13).
-- Ya aplicada en producción con el número 20270101002700; se renumeró al unir
-- con main, que usó ese número para quitar los resúmenes de correo.
--
-- 1. Otrosí: "Depositar a otro tercero", como en el contrato (20270101000600).
--    Se elige un tercero de Terceros y una de sus cuentas. Se guarda en
--    otrosis.titular_tercero_id / cuenta_tercero_id con las funciones envoltorio
--    crear_otrosi_con_titular / reenviar_otrosi_con_titular (llaman a las de
--    siempre y guardan el tercero en la misma transacción, con _titular_valido).
--    Al APROBARSE el otrosí, un disparador pasa ese tercero y esa cuenta al
--    contrato: las actas nuevas los traen por omisión. Sin la casilla, el
--    contrato no cambia. No aplica a contratos que se pagan por PSE.
-- 2. Póliza obligatoria cuando hay anticipo, también en la base (antes solo lo
--    revisaba la pantalla): _fijar_requiere_poliza.
-- 3. Aviso antes de aprobar un otrosí de quién firma como representante legal
--    (o qué falta): representante_que_firma_otrosi, envoltorio público de
--    _representante_que_firma_otrosi sin la imagen.
--
-- Va ANTES del código. Se puede correr más de una vez.

-- 1. Otrosí: depositar a otro tercero ------------------------------------------
alter table public.otrosis
  add column if not exists titular_tercero_id uuid references public.terceros(id),
  add column if not exists cuenta_tercero_id uuid references public.terceros_cuentas(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'otrosis_titular_cuenta_check') then
    alter table public.otrosis add constraint otrosis_titular_cuenta_check
      check ((titular_tercero_id is null) = (cuenta_tercero_id is null));
  end if;
end $$;

-- p_titular = {tercero_id, cuenta_id}; null o sin tercero = no cambia el tercero
-- del contrato. El mismo contratista = sin tercero aparte.
create or replace function public._fijar_titular_otrosi(p_id uuid, p_titular jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contrato uuid;
  v_metodo text;
  v_factura uuid;
  v_tercero uuid;
  v_cuenta uuid;
begin
  select o.contrato_id, c.metodo_pago, k.tercero_id
    into v_contrato, v_metodo, v_factura
    from public.otrosis o
    join public.contratos c on c.id = o.contrato_id
    join public.contratistas k on k.id = c.contratista_id
   where o.id = p_id;
  if not found then
    raise exception 'El otrosí no existe.';
  end if;
  if jsonb_typeof(coalesce(p_titular, 'null'::jsonb)) = 'object' and nullif(p_titular ->> 'tercero_id', '') is not null then
    if v_metodo = 'pse' then
      raise exception 'El contrato se paga por PSE: no aplica depositar a otro tercero.';
    end if;
    select o_titular, o_cuenta into v_tercero, v_cuenta from public._titular_valido(p_titular, v_factura);
  end if;
  update public.otrosis set titular_tercero_id = v_tercero, cuenta_tercero_id = v_cuenta where id = p_id;
end;
$$;
revoke all on function public._fijar_titular_otrosi(uuid, jsonb) from public, anon, authenticated;

create or replace function public.crear_otrosi_con_titular(
  p_contrato_id uuid, p_modificaciones jsonb, p_justificacion text,
  p_nueva_fecha_fin date default null, p_nuevo_valor numeric default null,
  p_actividades jsonb default '[]'::jsonb, p_titular jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  v_id := public.crear_otrosi(p_contrato_id, p_modificaciones, p_justificacion, p_nueva_fecha_fin, p_nuevo_valor, p_actividades);
  perform public._fijar_titular_otrosi(v_id, p_titular);
  return v_id;
end;
$$;
revoke all on function public.crear_otrosi_con_titular(uuid, jsonb, text, date, numeric, jsonb, jsonb) from public, anon;
grant execute on function public.crear_otrosi_con_titular(uuid, jsonb, text, date, numeric, jsonb, jsonb) to authenticated;

create or replace function public.reenviar_otrosi_con_titular(
  p_id uuid, p_modificaciones jsonb, p_justificacion text,
  p_nueva_fecha_fin date default null, p_nuevo_valor numeric default null,
  p_actividades jsonb default '[]'::jsonb, p_titular jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.reenviar_otrosi(p_id, p_modificaciones, p_justificacion, p_nueva_fecha_fin, p_nuevo_valor, p_actividades);
  perform public._fijar_titular_otrosi(p_id, p_titular);
end;
$$;
revoke all on function public.reenviar_otrosi_con_titular(uuid, jsonb, text, date, numeric, jsonb, jsonb) from public, anon;
grant execute on function public.reenviar_otrosi_con_titular(uuid, jsonb, text, date, numeric, jsonb, jsonb) to authenticated;

-- El tercero y la cuenta (número enmascarado) del otrosí, para el formulario y
-- el detalle. Mismo formato que titular_de_contrato. null = no cambia.
create or replace function public.titular_de_otrosi(p_otrosi_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public._puede_ver_otrosis(auth.uid())
     or not exists (select 1 from public.otrosis o
                     where o.id = p_otrosi_id and public.usuario_puede_ver_proyecto(auth.uid(), o.proyecto_id)) then
    raise exception 'El otrosí no existe o no tienes acceso.';
  end if;
  select jsonb_build_object(
           'tercero_id', t.id, 'razon_social', t.razon_social, 'tipo_documento', t.tipo_documento,
           'numero_documento', t.numero_documento, 'dv', t.dv,
           'cuenta_id', cu.id, 'banco', b.nombre, 'tipo_cuenta', cu.tipo_cuenta,
           'numero_cuenta', repeat('•', greatest(length(cu.numero_cuenta) - 4, 0)) || right(cu.numero_cuenta, 4),
           'verificada', cu.estado = 'ACTIVO')
    into v
    from public.otrosis o
    join public.terceros t on t.id = o.titular_tercero_id
    join public.terceros_cuentas cu on cu.id = o.cuenta_tercero_id
    join public.bancos b on b.id = cu.banco_id
   where o.id = p_otrosi_id;
  return v;
end;
$$;
revoke all on function public.titular_de_otrosi(uuid) from public, anon;
grant execute on function public.titular_de_otrosi(uuid) to authenticated;

-- Al aprobarse el otrosí con tercero aparte, el contrato queda con ese tercero.
create or replace function public._otrosi_titular_a_contrato()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'aprobada' and old.estado is distinct from 'aprobada' and new.titular_tercero_id is not null then
    update public.contratos
       set titular_tercero_id = new.titular_tercero_id,
           cuenta_tercero_id = new.cuenta_tercero_id
     where id = new.contrato_id
       and metodo_pago is distinct from 'pse';
    insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('contrato', new.contrato_id, 'titular_otrosi', coalesce(auth.uid(), new.aprobado_por),
            jsonb_build_object('otrosi_id', new.id, 'numero', new.numero, 'tercero_id', new.titular_tercero_id));
  end if;
  return null;
end;
$$;
revoke all on function public._otrosi_titular_a_contrato() from public, anon, authenticated;

drop trigger if exists trg_otrosi_titular_a_contrato on public.otrosis;
create trigger trg_otrosi_titular_a_contrato
  after update of estado on public.otrosis
  for each row execute function public._otrosi_titular_a_contrato();

-- 2. Póliza obligatoria con anticipo ------------------------------------------
create or replace function public._fijar_requiere_poliza(p_id uuid, p_datos jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.contratos c
     set requiere_poliza = c.tipo in ('obra', 'mano_obra')
                           or (coalesce(c.tiene_anticipo, false) and coalesce(c.anticipo_porcentaje, 0) > 0)
                           or coalesce((p_datos->>'requiere_poliza')::boolean, true)
   where c.id = p_id;
$$;

-- 3. Aviso de la firma del representante legal en el otrosí -------------------
create or replace function public.representante_que_firma_otrosi(p_otrosi_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public._puede_ver_otrosis(auth.uid())
     or not exists (select 1 from public.otrosis o
                     where o.id = p_otrosi_id and public.usuario_puede_ver_proyecto(auth.uid(), o.proyecto_id)) then
    raise exception 'El otrosí no existe o no tienes acceso.';
  end if;
  return public._representante_que_firma_otrosi(p_otrosi_id) - 'imagen';
end;
$$;
revoke all on function public.representante_que_firma_otrosi(uuid) from public, anon;
grant execute on function public.representante_que_firma_otrosi(uuid) to authenticated;
