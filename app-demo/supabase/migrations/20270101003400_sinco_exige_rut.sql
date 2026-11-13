-- Pagos de cuadros de SINCO: sin el RUT de quien factura no pasan a liquidar (decisión del
-- usuario, 2026-11-13). La carga crea los terceros que no existen sin RUT (el Excel no lo
-- trae); Financiera lo sube en la ventana del pago (Preparación). Novedad "Falta el RUT…"
-- y se recalcula sola al subirlo. Solo pagos de SINCO; parches por texto exacto.
-- Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

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

select pg_temp._parche('public._pago_novedad(uuid)'::regprocedure,
  $a$      then 'Falta el soporte (factura o cuenta de cobro) del cuadro de SINCO.' end,
$a$,
  $b$      then 'Falta el soporte (factura o cuenta de cobro) del cuadro de SINCO.' end,
    case when p.sinco_fila_id is not null and p.tercero_id is not null
              and not exists (select 1 from public.terceros tr where tr.id = p.tercero_id and tr.rut_ruta is not null)
      then 'Falta el RUT de quien factura: súbelo en la ventana del pago antes de enviarlo a liquidar.' end,
$b$);

select pg_temp._parche('public.enviar_pagos_a_liquidar(uuid[])'::regprocedure,
  $a$              or g.sinco_fila_id in (select f.id from public.sinco_filas f where f.soporte_ruta is not null))
$a$,
  $b$              or g.sinco_fila_id in (select f.id from public.sinco_filas f where f.soporte_ruta is not null))
         and (g.sinco_fila_id is null
              or g.tercero_id in (select tr.id from public.terceros tr where tr.rut_ruta is not null))
$b$);

create or replace function public.enviar_pagos_a_liquidar_detalle(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sin_cuenta integer;
  v_sin_soporte integer;
  v_sin_rut integer;
  v_n integer;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para gestionar pagos.';
  end if;
  select count(*) filter (where g.cuenta_tercero_id is null and not public.pago_es_pse(g)),
         count(*) filter (where (g.cuenta_tercero_id is not null or public.pago_es_pse(g))
                            and g.sinco_fila_id is not null
                            and not exists (select 1 from public.sinco_filas f
                                             where f.id = g.sinco_fila_id and f.soporte_ruta is not null)),
         count(*) filter (where (g.cuenta_tercero_id is not null or public.pago_es_pse(g))
                            and g.sinco_fila_id is not null
                            and exists (select 1 from public.sinco_filas f
                                         where f.id = g.sinco_fila_id and f.soporte_ruta is not null)
                            and not exists (select 1 from public.terceros tr
                                             where tr.id = g.tercero_id and tr.rut_ruta is not null))
    into v_sin_cuenta, v_sin_soporte, v_sin_rut
    from public.pagos g
   where g.id = any (coalesce(p_ids, '{}'))
     and g.estado = 'aprobado' and g.liquidacion_estado is null and g.semana is not null
     and (public.tiene_pestana(auth.uid(), 'ayf.aprobacion_pagos')
          or g.consolidado_id in (select public._consolidados_visibles(auth.uid())));
  v_n := public.enviar_pagos_a_liquidar(p_ids);
  return jsonb_build_object('enviados', v_n, 'sin_cuenta', v_sin_cuenta, 'sin_soporte', v_sin_soporte, 'sin_rut', v_sin_rut);
end;
$$;
revoke all on function public.enviar_pagos_a_liquidar_detalle(uuid[]) from public, anon;
grant execute on function public.enviar_pagos_a_liquidar_detalle(uuid[]) to authenticated;

-- Al subir o quitar el RUT, la novedad de los pagos de SINCO de ese tercero se recalcula.
create or replace function public._tercero_rut_novedad_sinco()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  for v_id in
    select g.id from public.pagos g
     where g.tercero_id = new.id and g.sinco_fila_id is not null
       and g.estado = 'aprobado' and g.liquidacion_estado is null
  loop
    perform public._pago_actualizar_novedad(v_id);
  end loop;
  return null;
end;
$$;
revoke all on function public._tercero_rut_novedad_sinco() from public, anon, authenticated;
drop trigger if exists trg_tercero_rut_novedad_sinco on public.terceros;
create trigger trg_tercero_rut_novedad_sinco after update of rut_ruta on public.terceros
  for each row when (new.rut_ruta is distinct from old.rut_ruta)
  execute function public._tercero_rut_novedad_sinco();

-- Los pagos de SINCO que ya estén en Preparación.
select public._pago_actualizar_novedad(g.id)
  from public.pagos g
 where g.sinco_fila_id is not null and g.estado = 'aprobado' and g.liquidacion_estado is null;

commit;
