-- ---------------------------------------------------------------------------
-- Cambio de cuenta bancaria con pagos en curso: que quede a la vista
-- (revisión por roles 2026-10-22, E2 y E3; decisión del usuario: opción A).
--
-- Un pago no copia el número de cuenta: apunta a la cuenta del tercero. Quien
-- puede verificar (Financiera, Gerencia) cambia el número de una cuenta ACTIVA
-- y sigue ACTIVA: los pagos ya aprobados o liquidados salían al número nuevo
-- sin rastro en el pago. Se mantiene que Financiera la puede cambiar sin otra
-- aprobación ("ellos tienen la info"), pero ahora:
--  - cada pago sin dispersar que use esa cuenta recibe el evento
--    `cuenta_modificada` en su historial (de qué a qué, quién) y queda marcado
--    (`pagos.cuenta_modificada`) con una novedad que se ve en Aprobación de
--    pagos y en el Consolidado, hasta que A&F vuelva a confirmar la cuenta del
--    pago (Asignar tercero / cuenta);
--  - si la cuenta pasa a PENDIENTE o INACTIVO, la novedad de sus pagos se
--    recalcula (antes se quedaba vacía hasta que alguien tocara el pago).
-- Se puede correr dos veces.
-- ---------------------------------------------------------------------------

alter table public.pagos add column if not exists cuenta_modificada jsonb;
comment on column public.pagos.cuenta_modificada is
  'Si la cuenta del tercero cambió de banco, tipo o número con el pago en curso: {de, a, por, en}. Se limpia al confirmar la cuenta del pago (asignar_tercero_pago).';

-- Novedad: + cuenta cambiada; inactiva ya no dice "pendiente de verificar".
create or replace function public._pago_novedad(p_pago_id uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select nullif(btrim(concat_ws(' ',
    case when p.empresa_id is null
      then 'El proyecto no tiene una empresa asignada.'
      when p.consolidado_id is null
      then 'La empresa no tiene consolidado asignado.' end,
    case when r.metodo = 'pse' then null
      when p.tercero_id is null
      then 'No hay un tercero registrado para este pago.'
      when p.cuenta_tercero_id is null
      then 'Falta elegir la cuenta bancaria del tercero.'
      when c.estado = 'INACTIVO'
      then 'La cuenta bancaria del tercero está inactiva.'
      when c.estado is distinct from 'ACTIVO'
      then 'La cuenta bancaria del tercero está pendiente de verificar.' end,
    case when p.cuenta_modificada is not null
      then 'La cuenta bancaria cambió después de solicitar el pago ('
           || coalesce(p.cuenta_modificada->>'de', '?') || ' → '
           || coalesce(p.cuenta_modificada->>'a', '?')
           || '): confírmala en el Consolidado (botón Tercero) antes de pagar.' end
  )), '')
  from public.pagos p
  left join public.terceros_cuentas c on c.id = p.cuenta_tercero_id
  left join public.requisiciones_admin r on r.id = p.requisicion_admin_id
  where p.id = p_pago_id
$function$;

-- Al editar una cuenta: marca, historial y novedad de sus pagos en curso.
create or replace function public._cuenta_tercero_sigue_pagos()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cambio boolean := (new.banco_id, new.tipo_cuenta, new.numero_cuenta)
                      is distinct from (old.banco_id, old.tipo_cuenta, old.numero_cuenta);
  v_de text;
  v_a text;
  v_id uuid;
begin
  if not v_cambio and new.estado is not distinct from old.estado then
    return null;
  end if;

  if v_cambio then
    v_de := coalesce((select b.nombre from public.bancos b where b.id = old.banco_id), 'Banco')
            || ' · ' || old.tipo_cuenta || ' ' || old.numero_cuenta;
    v_a := coalesce((select b.nombre from public.bancos b where b.id = new.banco_id), 'Banco')
           || ' · ' || new.tipo_cuenta || ' ' || new.numero_cuenta;

    insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    select 'pago', p.id, 'cuenta_modificada', auth.uid(),
           jsonb_build_object('cuenta_de', v_de, 'cuenta_a', v_a)
      from public.pagos p
     where p.cuenta_tercero_id = new.id
       and p.estado in ('programado', 'solicitado', 'aprobado', 'liquidado');

    update public.pagos p
       set cuenta_modificada = jsonb_build_object(
             'de', coalesce(p.cuenta_modificada->>'de', v_de), 'a', v_a,
             'por', auth.uid(), 'en', now())
     where p.cuenta_tercero_id = new.id
       and p.estado in ('programado', 'solicitado', 'aprobado', 'liquidado');
  end if;

  for v_id in
    select p.id from public.pagos p
     where p.cuenta_tercero_id = new.id
       and p.estado in ('programado', 'solicitado', 'aprobado', 'liquidado')
  loop
    perform public._pago_actualizar_novedad(v_id);
  end loop;
  return null;
end;
$function$;
revoke all on function public._cuenta_tercero_sigue_pagos() from public, anon, authenticated;

drop trigger if exists trg_cuenta_tercero_sigue_pagos on public.terceros_cuentas;
create trigger trg_cuenta_tercero_sigue_pagos
  after update on public.terceros_cuentas
  for each row execute function public._cuenta_tercero_sigue_pagos();

-- Confirmar la cuenta del pago (Asignar tercero / cuenta) limpia la marca.
create or replace function public.asignar_tercero_pago(p_pago_id uuid, p_tercero_id uuid, p_cuenta_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_estado text;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para gestionar pagos.';
  end if;

  select estado into v_estado from public.pagos where id = p_pago_id for update;
  if not found then
    raise exception 'El pago no existe.';
  end if;
  if v_estado in ('en_dispersion','dispersado','rechazado','anulado') then
    raise exception 'Este pago ya no se puede modificar (%).', v_estado;
  end if;

  if not exists (select 1 from public.terceros where id = p_tercero_id) then
    raise exception 'El tercero no existe.';
  end if;
  if p_cuenta_id is not null and not exists (
    select 1 from public.terceros_cuentas where id = p_cuenta_id and tercero_id = p_tercero_id
  ) then
    raise exception 'La cuenta no pertenece a ese tercero.';
  end if;

  update public.pagos
     set tercero_id = p_tercero_id, cuenta_tercero_id = p_cuenta_id, cuenta_modificada = null
   where id = p_pago_id;
  perform public._pago_actualizar_novedad(p_pago_id);
end;
$function$;

-- Novedades de hoy con la regla nueva (cuentas inactivas).
do $$
declare
  v_id uuid;
begin
  for v_id in
    select p.id from public.pagos p
      join public.terceros_cuentas c on c.id = p.cuenta_tercero_id
     where c.estado = 'INACTIVO'
       and p.estado in ('programado', 'solicitado', 'aprobado', 'liquidado')
  loop
    perform public._pago_actualizar_novedad(v_id);
  end loop;
end $$;
