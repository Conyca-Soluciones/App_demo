-- "Devolver a Compras" (decisión del usuario, 2026-11-13): Gerencia (acción aprobar_pagos)
-- devuelve una orden de compra ya aprobada para que Compras la modifique, mientras su pago
-- no se haya dispersado. Desde Aprobación de pagos (filtro Todos o Aprobados), abriendo el pago.
-- * Los pagos vivos de la orden se ANULAN (aunque ya se hayan enviado a liquidar o liquidado;
--   conservan su REF como registro) y la orden vuelve a POR APROBAR, marcada como devuelta
--   (ordenes_compra.devuelta_compras_*), sin pago: Compras la modifica ("Modificar" ya ignora
--   los pagos anulados) y eso crea el pago nuevo por aprobar. Al crearse ese pago se quita la marca.
-- * No se devuelve si tiene entradas de almacén, facturas, cierre con faltante o saldo a favor
--   (las mismas reglas de Modificar).
-- * Avisa a quien creó la orden (campanita y correo) y queda en el historial de la orden.
-- Solo agrega. Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';
lock table public.ordenes_compra, public.pagos, public.notificaciones in access exclusive mode;

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $f$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  p_a := replace(p_a, E'\r\n', E'\n');
  p_b := replace(p_b, E'\r\n', E'\n');
  if position(p_b in d) > 0 then
    return;
  end if;
  if position(p_a in d) = 0 then
    raise exception '% no tiene el texto esperado: %', p_fn, left(p_a, 120);
  end if;
  execute replace(d, p_a, p_b);
end;
$f$;

alter table public.ordenes_compra add column if not exists devuelta_compras_at timestamptz;
alter table public.ordenes_compra add column if not exists devuelta_compras_por uuid references public.perfiles(id);
alter table public.ordenes_compra add column if not exists devuelta_compras_motivo text;

-- Tipo de aviso nuevo (se agrega a la lista viva) y por correo.
do $$
declare
  d text;
begin
  select pg_get_constraintdef(oid) into d from pg_constraint where conname = 'notificaciones_tipo_check';
  if d is not null and position('orden_compra_devuelta' in d) = 0 then
    execute 'alter table public.notificaciones drop constraint notificaciones_tipo_check';
    execute 'alter table public.notificaciones add constraint notificaciones_tipo_check '
            || replace(replace(d, ' NOT VALID', ''), 'ARRAY[', 'ARRAY[''orden_compra_devuelta''::text, ') || ' not valid';
  end if;
end;
$$;
update public.ajustes_correo set tipos = array_append(tipos, 'orden_compra_devuelta')
 where id and not ('orden_compra_devuelta' = any (tipos));

-- Al pasar una orden aprobada a pendiente, _oc_estado_pagos le crea un pago nuevo de una
-- vez. Al devolverla a Compras no: el pago nuevo sale cuando Compras la modifique.
select pg_temp._parche('public._oc_estado_pagos()'::regprocedure,
  $a$    if new.estado = 'pendiente_aprobacion' then
      perform public._crear_pagos_orden(new.id);$a$,
  $b$    if new.estado = 'pendiente_aprobacion' and coalesce(current_setting('app.devolviendo_oc', true), '') <> 'on' then
      perform public._crear_pagos_orden(new.id);$b$);

create or replace function public.devolver_orden_a_compras(p_orden_id uuid, p_motivo text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o record;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_n integer;
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_pagos') then
    raise exception 'No autorizado -- solo quien aprueba pagos (Gerencia) devuelve órdenes a Compras.';
  end if;
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'Escribe por qué se devuelve la orden.';
  end if;
  select * into v_o from public.ordenes_compra where id = p_orden_id for update;
  if not found then
    raise exception 'La orden no existe.';
  end if;
  if v_o.estado <> 'aprobada' then
    raise exception 'Solo se devuelve a Compras una orden aprobada.';
  end if;
  perform 1 from public.pagos where orden_compra_id = p_orden_id for update;
  if exists (select 1 from public.pagos where orden_compra_id = p_orden_id and estado = 'dispersado') then
    raise exception 'Un pago de esta orden ya se dispersó: ya no se devuelve a Compras.';
  end if;
  if exists (select 1 from public.orden_compra_facturas f where f.orden_compra_id = p_orden_id and f.anulada_at is null) then
    raise exception 'La orden ya tiene facturas registradas: Compras debe anularlas antes de que se devuelva.';
  end if;
  if v_o.cerrada_faltante_at is not null then
    raise exception 'La orden se cerró con faltante: ya no se devuelve.';
  end if;
  if coalesce(v_o.saldo_favor_aplicado, 0) > 0 then
    raise exception 'La orden usa saldo a favor: no se puede devolver para modificar (Compras debe cancelarla y crearla de nuevo).';
  end if;
  if v_o.estado_entrega <> 'sin_entregar'
     or exists (select 1 from public.entradas_almacen e where e.orden_compra_id = p_orden_id) then
    raise exception 'La orden ya tiene entradas de almacén: ya no se devuelve.';
  end if;

  update public.pagos
     set estado = 'anulado', anulado_en = now(),
         motivo_anulacion = 'Orden devuelta a Compras por Gerencia: ' || v_motivo
   where orden_compra_id = p_orden_id and estado in ('programado', 'solicitado', 'en_espera', 'aprobado');
  get diagnostics v_n = row_count;

  -- El historial lo anota trg_historial_orden_compra (aprobada -> pendiente, con el motivo).
  perform set_config('app.devolviendo_oc', 'on', true);
  update public.ordenes_compra
     set estado = 'pendiente_aprobacion', aprobada_por = null, aprobada_at = null,
         desaprobada_por = auth.uid(), motivo_desaprobacion = 'Devuelta a Compras: ' || v_motivo,
         devuelta_compras_at = now(), devuelta_compras_por = auth.uid(), devuelta_compras_motivo = v_motivo
   where id = p_orden_id;
  perform set_config('app.devolviendo_oc', '', true);

  if v_o.created_by is not null and v_o.created_by <> auth.uid()
     and exists (select 1 from public.perfiles p where p.id = v_o.created_by) then
    insert into public.notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    values (v_o.created_by, 'orden_compra_devuelta', 'orden_compra', p_orden_id,
            'Gerencia devolvió la orden ' || coalesce(v_o.codigo, 'de compra') || ' para modificarla',
            'Motivo: ' || v_motivo || '. Modifícala (botón Modificar en la orden) para enviarla otra vez a aprobación, o cancélala.');
  end if;
  return v_n;
end;
$$;
revoke all on function public.devolver_orden_a_compras(uuid, text) from public, anon;
grant execute on function public.devolver_orden_a_compras(uuid, text) to authenticated;

-- Al crearse el pago nuevo de la orden (Compras la modificó), se quita la marca de devuelta.
create or replace function public._oc_quitar_devuelta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.orden_compra_id is not null then
    update public.ordenes_compra
       set devuelta_compras_at = null, devuelta_compras_por = null, devuelta_compras_motivo = null
     where id = new.orden_compra_id and devuelta_compras_at is not null;
  end if;
  return null;
end;
$$;
revoke all on function public._oc_quitar_devuelta() from public, anon, authenticated;
drop trigger if exists trg_oc_quitar_devuelta on public.pagos;
create trigger trg_oc_quitar_devuelta after insert on public.pagos
  for each row when (new.fuente = 'orden_compra') execute function public._oc_quitar_devuelta();

commit;
