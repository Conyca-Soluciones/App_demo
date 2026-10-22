-- Actas: "El titular de la cuenta es otro tercero" (pedido del usuario,
-- 2026-10-22), como en las requisiciones administrativas por transferencia.
--
-- Al elaborar el acta se elige el tercero que factura (se propone el inscrito
-- en Terceros con el documento del contratista) y, si la cuenta es de otra
-- persona, se marca la casilla y se busca al titular en Terceros; la cuenta es
-- del titular. Se guarda en el acta (pago_tercero_id, pago_cuenta_id; el
-- titular es el dueño de la cuenta) y _pago_de_acta lo usa al crear o
-- actualizar el pago. Sin elección, todo sigue como antes: tercero = documento
-- del contratista y cuenta = su única cuenta verificada (o la elige A&F).
--
-- crear_acta y editar_acta se parchean sobre su versión VIVA (reemplazo de
-- texto exacto; falla si no lo encuentra).

alter table public.actas
  add column if not exists pago_tercero_id uuid references public.terceros(id) on delete set null,
  add column if not exists pago_cuenta_id uuid references public.terceros_cuentas(id) on delete set null;

-- 1. Guardar la elección (datos del formulario: pago_tercero_id,
-- pago_titular_id, pago_cuenta_id). Sin la clave pago_tercero_id (otra
-- pantalla), no cambia nada.

create or replace function public._fijar_cuenta_pago_acta(p_acta_id uuid, p_datos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tercero uuid;
  v_titular uuid;
  v_cuenta uuid;
  v_dueno uuid;
  v_estado text;
begin
  if p_datos is null or not (p_datos ? 'pago_tercero_id') then
    return;
  end if;
  v_tercero := nullif(p_datos->>'pago_tercero_id', '')::uuid;
  v_titular := nullif(p_datos->>'pago_titular_id', '')::uuid;
  v_cuenta := nullif(p_datos->>'pago_cuenta_id', '')::uuid;
  if v_titular = v_tercero then
    v_titular := null;
  end if;

  if v_tercero is null then
    if v_titular is not null or v_cuenta is not null then
      raise exception 'Elige el tercero que factura.';
    end if;
    update public.actas set pago_tercero_id = null, pago_cuenta_id = null where id = p_acta_id;
    return;
  end if;

  if not exists (select 1 from public.terceros where id = v_tercero) then
    raise exception 'El tercero que factura no existe.';
  end if;
  if v_titular is not null then
    if not exists (select 1 from public.terceros where id = v_titular) then
      raise exception 'El titular de la cuenta no existe.';
    end if;
    if v_cuenta is null then
      raise exception 'Elige la cuenta del titular.';
    end if;
  end if;
  if v_cuenta is not null then
    select c.tercero_id, c.estado into v_dueno, v_estado from public.terceros_cuentas c where c.id = v_cuenta;
    if not found or v_dueno <> coalesce(v_titular, v_tercero) then
      raise exception 'La cuenta no es del titular elegido.';
    end if;
    if v_estado = 'INACTIVO' then
      raise exception 'La cuenta está inactiva: elige otra.';
    end if;
  end if;

  update public.actas set pago_tercero_id = v_tercero, pago_cuenta_id = v_cuenta where id = p_acta_id;
end;
$$;
revoke all on function public._fijar_cuenta_pago_acta(uuid, jsonb) from public, anon, authenticated;

-- 2. El pago usa la elección del acta. Igual a la versión viva salvo el bloque
-- del tercero y la cuenta.

create or replace function public._pago_de_acta(p_acta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_valor numeric;
  v_tercero uuid;
  v_cuenta uuid;
  v_concepto text;
  v_pago uuid;
begin
  select a.id, a.numero, a.tipo, a.estado, a.neto, a.pago_tercero_id, a.pago_cuenta_id, c.proyecto_id,
         coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero) as numero_contrato,
         k.numero_documento, k.nombre as contratista_nombre, py.empresa_id, e.consolidado_id
    into v
  from actas a
  join contratos c on c.id = a.contrato_id
  join contratistas k on k.id = c.contratista_id
  left join proyectos py on py.id = c.proyecto_id
  left join empresas e on e.id = py.empresa_id
  where a.id = p_acta_id;
  if not found or v.estado <> 'pendiente' then
    return;
  end if;

  select g.id into v_pago from pagos g where g.acta_id = p_acta_id and g.estado = 'solicitado'
   order by g.creado_en desc limit 1;
  v_valor := round(v.neto, 0);

  if v_valor <= 0 then
    if v_pago is not null then
      update pagos set estado = 'anulado', anulado_en = now(),
                       motivo_anulacion = 'El neto del acta quedó en cero o negativo.'
       where id = v_pago;
    end if;
    perform public._aprobar_acta(p_acta_id, auth.uid(), null);
    return;
  end if;

  if not exists (select 1 from acta_soportes s where s.acta_id = p_acta_id and s.tipo in ('factura', 'cuenta_cobro')) then
    raise exception 'Adjunta el soporte de pago (factura o cuenta de cobro del contratista): el acta con pago lo exige.';
  end if;

  -- Tercero: el elegido en el acta o, si no, el del documento del contratista.
  -- Cuenta: la elegida (puede ser de otro titular) o, si no, la única
  -- verificada del tercero.
  v_tercero := v.pago_tercero_id;
  v_cuenta := v.pago_cuenta_id;
  if v_tercero is null then
    select t.id into v_tercero from terceros t where t.numero_documento = v.numero_documento limit 1;
  end if;
  if v_tercero is not null and v_cuenta is null then
    select tc.id into v_cuenta from terceros_cuentas tc
     where tc.tercero_id = v_tercero and tc.estado = 'ACTIVO'
       and (select count(*) from terceros_cuentas x where x.tercero_id = v_tercero and x.estado = 'ACTIVO') = 1;
  end if;
  v_concepto := upper(case v.tipo when 'final' then 'Acta final' when 'liquidacion' then 'Acta de liquidación' else 'Acta' end)
                || ' N° ' || v.numero || ' - CONTRATO ' || v.numero_contrato || ' - ' || upper(v.contratista_nombre);

  if v_pago is not null then
    if v.pago_tercero_id is not null then
      -- Lo elegido en el acta manda. Sin cuenta elegida se conserva la que ya
      -- tenía el pago (p. ej. la que puso A&F) si el tercero no cambió.
      update pagos
         set valor = v_valor, concepto = v_concepto, solicitado_en = now(),
             cuenta_tercero_id = case when v.pago_cuenta_id is not null then v.pago_cuenta_id
                                      when tercero_id = v_tercero then coalesce(cuenta_tercero_id, v_cuenta)
                                      else v_cuenta end,
             tercero_id = v_tercero
       where id = v_pago;
    else
      -- Una cuenta de otro tercero solo pudo venir de un titular elegido antes
      -- en el acta (A&F solo asigna cuentas del mismo tercero): si se quitó,
      -- vuelve a la cuenta automática.
      update pagos set valor = v_valor, concepto = v_concepto, solicitado_en = now(),
                       tercero_id = coalesce(tercero_id, v_tercero),
                       cuenta_tercero_id = case
                         when exists (select 1 from terceros_cuentas x
                                       where x.id = pagos.cuenta_tercero_id and x.tercero_id is distinct from pagos.tercero_id)
                           then (select tc.id from terceros_cuentas tc
                                  where tc.tercero_id = coalesce(pagos.tercero_id, v_tercero) and tc.estado = 'ACTIVO'
                                    and (select count(*) from terceros_cuentas y
                                          where y.tercero_id = coalesce(pagos.tercero_id, v_tercero) and y.estado = 'ACTIVO') = 1)
                         else coalesce(cuenta_tercero_id, v_cuenta) end
       where id = v_pago;
    end if;
  else
    insert into pagos (fuente, acta_id, tipo, proyecto_id, empresa_id, consolidado_id, tercero_id,
                       cuenta_tercero_id, concepto, valor, estado, solicitado_en)
    values ('acta', p_acta_id, 'unico', v.proyecto_id, v.empresa_id, v.consolidado_id, v_tercero, v_cuenta,
            v_concepto, v_valor, 'solicitado', now())
    returning id into v_pago;
  end if;
  perform public._pago_actualizar_novedad(v_pago);
end;
$$;
revoke all on function public._pago_de_acta(uuid) from public, anon, authenticated;

-- 3. crear_acta y editar_acta guardan la elección antes de crear el pago.

do $$
declare
  v_firma regprocedure;
  v_def text;
  v_viejo constant text := 'perform public._pago_de_acta(p_acta_id);';
  v_nuevo constant text := 'perform public._fijar_cuenta_pago_acta(p_acta_id, p_datos);' || chr(10)
                           || '  perform public._pago_de_acta(p_acta_id);';
begin
  foreach v_firma in array array[
    'public.crear_acta(uuid,uuid,jsonb,jsonb)'::regprocedure,
    'public.editar_acta(uuid,jsonb,jsonb,uuid[])'::regprocedure
  ] loop
    v_def := pg_get_functiondef(v_firma);
    if position('_fijar_cuenta_pago_acta' in v_def) > 0 then
      continue;
    end if;
    if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
      raise exception 'No se encontró una sola vez "%" en %: revisar la versión viva.', v_viejo, v_firma;
    end if;
    execute replace(v_def, v_viejo, v_nuevo);
  end loop;
end $$;

-- 4. Para el formulario: el tercero sugerido (documento del contratista) y lo
-- elegido en el acta que se edita (tercero, titular si es otro, cuenta).

create or replace function public.cuenta_pago_acta(p_contrato_id uuid, p_acta_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_proyecto uuid;
  v_documento text;
  v_res jsonb;
begin
  if not public.tiene_pestana(v_uid, 'contratos.cortes') then
    raise exception 'No autorizado.';
  end if;
  select c.proyecto_id, k.numero_documento into v_proyecto, v_documento
    from contratos c join contratistas k on k.id = c.contratista_id
   where c.id = p_contrato_id;
  if not found or not public.usuario_puede_ver_proyecto(v_uid, v_proyecto) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;

  select jsonb_build_object(
    'sugerido', (select jsonb_build_object('id', t.id, 'razon_social', t.razon_social, 'tipo_documento', t.tipo_documento,
                                           'numero_documento', t.numero_documento, 'dv', t.dv)
                   from terceros t where t.numero_documento = v_documento order by t.id limit 1),
    'elegido', (select case when a.pago_tercero_id is null then null else jsonb_build_object(
                  'tercero', jsonb_build_object('id', t.id, 'razon_social', t.razon_social, 'tipo_documento', t.tipo_documento,
                                                'numero_documento', t.numero_documento, 'dv', t.dv),
                  'titular', case when ti.id is not null and ti.id <> t.id then
                               jsonb_build_object('id', ti.id, 'razon_social', ti.razon_social, 'tipo_documento', ti.tipo_documento,
                                                  'numero_documento', ti.numero_documento, 'dv', ti.dv) end,
                  'cuenta_id', a.pago_cuenta_id) end
                  from actas a
                  left join terceros t on t.id = a.pago_tercero_id
                  left join terceros_cuentas cu on cu.id = a.pago_cuenta_id
                  left join terceros ti on ti.id = cu.tercero_id
                 where a.id = p_acta_id and a.contrato_id = p_contrato_id))
    into v_res;
  return v_res;
end;
$$;
revoke all on function public.cuenta_pago_acta(uuid, uuid) from public, anon;
grant execute on function public.cuenta_pago_acta(uuid, uuid) to authenticated;
