-- Modalidades, paso 3 (2026-11-16; sigue a 20270101003900).
--
-- 1. items_presupuesto_para_contrato devuelve también la modalidad del ítem,
--    para que el formulario de contratos deje en gris los ítems que no van en
--    ese tipo de contrato (la base ya lo exige con _motivo_item_no_listo).
--    Cambia el tipo de retorno: se borra y se crea otra vez (mismos permisos).
-- 2. Cambiar el % de todo costo del proyecto (Admin › Proyectos) recalcula los
--    ítems a todo costo de la versión vigente que todavía no tienen
--    requisiciones ni contratos. Los que ya tienen se quedan con el valor de
--    antes. Quitar el % con ítems a todo costo da error.
--
-- Va ANTES del código (el formulario lee la columna modalidad). Reversa en
-- supabase/reversa/.

begin;
set local lock_timeout = '10s';

drop function if exists public.items_presupuesto_para_contrato(uuid);
create function public.items_presupuesto_para_contrato(p_proyecto_id uuid)
returns table(presupuesto_item_id uuid, codigo text, descripcion text, unidad text, cantidad numeric,
              valor_unitario numeric, valor_mano_obra numeric, contratado numeric, disponible numeric,
              modalidad text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_presupuesto uuid;
  v_version uuid;
begin
  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para solicitar contratos.';
  end if;
  if not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes acceso a este proyecto.';
  end if;

  select p.id, p.version_actual_id into v_presupuesto, v_version
  from presupuestos p where p.proyecto_id = p_proyecto_id;
  if v_version is null then
    return;
  end if;

  return query
  with contratado as (
    select p2.codigo, sum(ai.cantidad - ai.cantidad_reducida) as total
    from contrato_anexo_items ai
    join contratos c on c.id = ai.contrato_id
    join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
    where p2.presupuesto_id = v_presupuesto and c.estado <> 'rechazada'
    group by p2.codigo
  ),
  -- Mano de obra + herramienta menor por unidad (como recalcular_valor_apus),
  -- más la línea fija de mano de obra de la modalidad (20270101003900).
  mo as (
    select pi.id,
           round(coalesce(sum(moc.valor_unitario), 0) * (1 + coalesce(sum(ia.porcentaje_mano_obra / 100.0), 0))
             + coalesce(sum(ia.valor_fijo) filter (where ia.concepto_fijo in ('mano_obra_subcontrato', 'mano_obra_administracion')), 0), 2) as valor
    from presupuesto_items pi
    join item_apu ia on ia.apu_id = pi.apu_id
    left join mano_obra_categorias moc on moc.id = ia.mano_obra_categoria_id
    where pi.version_id = v_version
    group by pi.id
  )
  select pi.id, pi.codigo, pi.descripcion, pi.unidad, pi.cantidad, pi.valor_unitario,
         least(coalesce(mo.valor, 0), pi.valor_unitario),
         coalesce(c.total, 0),
         greatest(pi.cantidad - coalesce(c.total, 0), 0),
         pi.modalidad
  from presupuesto_items pi
  left join contratado c on c.codigo = pi.codigo
  left join mo on mo.id = pi.id
  where pi.version_id = v_version
    and pi.cantidad > 0
    and pi.valor_unitario > 0
  order by pi.codigo, pi.id;
end;
$$;
revoke all on function public.items_presupuesto_para_contrato(uuid) from public, anon;
grant execute on function public.items_presupuesto_para_contrato(uuid) to authenticated, service_role;

create or replace function public._proyecto_tope_todo_costo_cambio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid;
begin
  for v in
    select pi.id
      from presupuestos p
      join presupuesto_items pi on pi.version_id = p.version_actual_id
     where p.proyecto_id = new.id
       and pi.modalidad = 'todo_costo'
       and not (select i.con_movimientos from public._info_modalidad_item(pi.id) i)
     order by pi.codigo
  loop
    perform public._aplicar_modalidad_item(v, 'todo_costo');
  end loop;
  return null;
end;
$$;
revoke all on function public._proyecto_tope_todo_costo_cambio() from public, anon, authenticated;

drop trigger if exists trg_proyecto_tope_todo_costo on public.proyectos;
create trigger trg_proyecto_tope_todo_costo
  after update of tope_todo_costo_pct on public.proyectos
  for each row
  when (old.tope_todo_costo_pct is distinct from new.tope_todo_costo_pct)
  execute function public._proyecto_tope_todo_costo_cambio();

commit;
