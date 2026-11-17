-- Modalidades, paso 4 (2026-11-16; sigue a 20270101004000): Excel de
-- modalidades sobre el presupuesto actual.
--
-- 1. info_modalidades_version(versión): los ítems hoja de la versión con lo que
--    hace falta para llenar el Excel (modalidad actual, mano de obra oficial,
--    si tiene insumos o mano de obra, % de herramienta menor del APU y si ya
--    tiene requisiciones o contratos). Solo quien edita presupuestos y ve el
--    proyecto.
-- 2. _info_modalidad_item: una línea "Es herramienta menor" (No aplica con
--    tipo EQUIPO, paso 3) ya no cuenta como insumo. Sin esto, una tala con la
--    motosierra marcada pasaba a "con insumos" y su mano de obra iba al
--    catálogo.
--
-- Solo agrega. Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

create or replace function public._info_modalidad_item(p_item uuid)
returns table(tiene_mano_obra boolean, con_insumos boolean, con_movimientos boolean, es_hoja boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from apu_import_revision r where r.presupuesto_item_id = pi.id and r.tipo = 'MO')
      or exists (select 1 from item_apu ia
                  where ia.apu_id in (pi.apu_id, pi.apu_guardado_id)
                    and (ia.mano_obra_categoria_id is not null
                         or ia.concepto_fijo in ('mano_obra_subcontrato', 'mano_obra_administracion'))),
    exists (select 1 from apu_import_revision r where r.presupuesto_item_id = pi.id and r.tipo = 'INSUMO')
      or exists (select 1 from item_apu ia
                  where ia.apu_id in (pi.apu_id, pi.apu_guardado_id)
                    and (ia.insumo_id is not null
                         or (ia.no_aplica is not null and ia.tipo is distinct from 'EQUIPO'))),
    exists (select 1 from pedidos_insumos pe
              join presupuesto_items p2 on p2.id = pe.presupuesto_item_id
             where p2.presupuesto_id = pi.presupuesto_id and p2.codigo = pi.codigo
               and pe.estado in ('pendiente', 'aprobado'))
      or exists (select 1 from contrato_anexo_items ai
                   join contratos c on c.id = ai.contrato_id
                   join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
                  where p2.presupuesto_id = pi.presupuesto_id and p2.codigo = pi.codigo
                    and c.estado <> 'rechazada'),
    not exists (select 1 from presupuesto_items h where h.padre_id = pi.id)
  from presupuesto_items pi
  where pi.id = p_item
$$;
revoke all on function public._info_modalidad_item(uuid) from public, anon, authenticated;

create or replace function public.info_modalidades_version(p_version_id uuid)
returns table(presupuesto_item_id uuid, codigo text, descripcion text, unidad text, precio_original numeric,
              modalidad text, mano_obra_oficial numeric, herramienta_menor_pct numeric,
              herramienta_menor_apu numeric, tiene_mano_obra boolean, con_insumos boolean,
              con_movimientos boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_proyecto uuid;
begin
  if v_uid is null or not public.tiene_accion(v_uid, 'editar_presupuestos') then
    raise exception 'No tienes permiso para editar presupuestos.';
  end if;
  select p.proyecto_id into v_proyecto
    from presupuesto_versiones v join presupuestos p on p.id = v.presupuesto_id
   where v.id = p_version_id;
  if v_proyecto is null or not public.usuario_puede_ver_proyecto(v_uid, v_proyecto) then
    raise exception 'El presupuesto no existe o no tienes acceso.';
  end if;

  return query
  select pi.id, pi.codigo, pi.descripcion, pi.unidad, pi.precio_original,
         pi.modalidad, pi.mano_obra_oficial, pi.herramienta_menor_pct,
         (select sum(ia.porcentaje_mano_obra) from item_apu ia
           where ia.apu_id in (pi.apu_id, pi.apu_guardado_id) and ia.porcentaje_mano_obra is not null),
         i.tiene_mano_obra, i.con_insumos, i.con_movimientos
    from presupuesto_items pi
    cross join lateral public._info_modalidad_item(pi.id) i
   where pi.version_id = p_version_id
     and i.es_hoja
   order by pi.codigo, pi.id;
end;
$$;
revoke all on function public.info_modalidades_version(uuid) from public, anon;
grant execute on function public.info_modalidades_version(uuid) to authenticated;

commit;
