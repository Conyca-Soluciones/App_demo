-- Contratos de obra y de mano de obra solo con ítems listos (decisión del
-- usuario, 2026-11-13).
--
-- El tope del valor unitario sale del valor del ítem HOY (o de su mano de obra).
-- Con líneas del APU todavía pendientes ese valor está incompleto (en el
-- Malecón, 229 ítems con pendientes se podían contratar; ej. 4.1.21.4 Zapata con
-- tope $426 contra $966.219 oficial). Ahora:
-- - Mano de obra: no se contrata un ítem cuya MANO DE OBRA está pendiente (que
--   falten insumos no importa: el tope es la mano de obra).
-- - Obra (todo costo): no se contrata un ítem con CUALQUIER línea del APU sin
--   resolver.
-- Pendiente = línea del import en 'pendiente', 'solicitud_pendiente' o
-- 'rechazado' (rechazada todavía no tiene con qué reemplazarse).
--
-- _motivo_item_no_listo da el motivo (null = listo); pendientes_items_contrato
-- lo da al formulario; _guardar_solicitud_contrato lo exige (parche de texto
-- sobre la versión viva). Los demás tipos de contrato no cambian.
--
-- Todo en una transacción. Se puede correr más de una vez.

begin;

create or replace function public._motivo_item_no_listo(p_presupuesto_item_id uuid, p_tipo text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_tipo = 'mano_obra' and exists (
           select 1 from public.apu_import_revision r
            where r.presupuesto_item_id = p_presupuesto_item_id and r.tipo = 'MO'
              and r.estado in ('pendiente', 'solicitud_pendiente', 'rechazado'))
      then 'falta aprobar la mano de obra de su APU'
    when p_tipo = 'obra' then (
      select case when count(*) > 0 then 'su APU tiene ' || count(*) || ' línea(s) sin resolver' end
        from public.apu_import_revision r
       where r.presupuesto_item_id = p_presupuesto_item_id
         and r.estado in ('pendiente', 'solicitud_pendiente', 'rechazado'))
  end
$$;
revoke all on function public._motivo_item_no_listo(uuid, text) from public, anon, authenticated;

-- Para el formulario: ítems de la versión vigente con líneas sin resolver.
create or replace function public.pendientes_items_contrato(p_proyecto_id uuid)
returns table(presupuesto_item_id uuid, pendientes integer, mano_obra_pendiente boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para solicitar contratos.';
  end if;
  if not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes acceso a este proyecto.';
  end if;
  return query
  select r.presupuesto_item_id, count(*)::integer, bool_or(r.tipo = 'MO')
    from public.apu_import_revision r
    join public.presupuesto_items pi on pi.id = r.presupuesto_item_id
    join public.presupuestos p on p.version_actual_id = pi.version_id
   where p.proyecto_id = p_proyecto_id
     and r.estado in ('pendiente', 'solicitud_pendiente', 'rechazado')
   group by r.presupuesto_item_id
   order by r.presupuesto_item_id;
end;
$$;
revoke all on function public.pendientes_items_contrato(uuid) from public, anon;
grant execute on function public.pendientes_items_contrato(uuid) to authenticated;

do $$
declare
  d text := pg_get_functiondef('public._guardar_solicitud_contrato'::regproc);
  a text := E'      v_tope := public._tope_valor_unitario_item(v_pi.id, v_tipo);\n';
  b text := E'      -- Obra y mano de obra: solo ítems listos (20270101003600).\n'
         || E'      if public._motivo_item_no_listo(v_pi.id, v_tipo) is not null then\n'
         || E'        raise exception ''El ítem % no se puede contratar todavía: %.'', v_pi.codigo, public._motivo_item_no_listo(v_pi.id, v_tipo);\n'
         || E'      end if;\n'
         || a;
begin
  d := replace(d, E'\r\n', E'\n');
  if position('_motivo_item_no_listo' in d) > 0 then
    return;
  end if;
  if position(a in d) = 0 then
    raise exception '_guardar_solicitud_contrato no tiene el texto esperado.';
  end if;
  execute replace(d, a, b);
end $$;

commit;
