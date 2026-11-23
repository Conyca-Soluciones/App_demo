-- Datos de la versión vigente para comparar con el Excel antes de crear una
-- versión nueva (2026-11-23, paso 1 de "versión nueva desde el Excel aplicando
-- solo las diferencias"; la comparación está en lib/comparar-version.ts).
--
-- datos_comparar_version(presupuesto): solo lectura. Por cada ítem de la
-- versión vigente: código, descripción, unidad, cantidad, precio oficial, si es
-- hoja, si tiene APU, la modalidad, las líneas del Excel de su APU
-- (apu_import_revision, sin los trabajos de una división ni la mano de obra que
-- agregó la modalidad, en el orden del import) y si tiene requisiciones
-- (pendientes o aprobadas) o contratos (no rechazados) en cualquier versión
-- (por código, como el cupo).
--
-- Va ANTES del código. Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

create or replace function public.datos_comparar_version(p_presupuesto_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_proyecto uuid;
  v_version uuid;
begin
  select proyecto_id, version_actual_id into v_proyecto, v_version from presupuestos where id = p_presupuesto_id;
  if v_uid is null or not found or not usuario_puede_ver_proyecto(v_uid, v_proyecto) then
    raise exception 'El presupuesto no existe o no tienes acceso.';
  end if;
  if v_version is null then return '[]'::jsonb; end if;

  return coalesce((
    with req as (
      select distinct pi.codigo
        from pedidos_insumos p join presupuesto_items pi on pi.id = p.presupuesto_item_id
       where pi.presupuesto_id = p_presupuesto_id and p.estado in ('pendiente', 'aprobado')
    ),
    con as (
      select distinct pi.codigo
        from contrato_anexo_items ai
        join contratos c on c.id = ai.contrato_id
        join presupuesto_items pi on pi.id = ai.presupuesto_item_id
       where pi.presupuesto_id = p_presupuesto_id and c.estado <> 'rechazada'
    ),
    lin as (
      select r.presupuesto_item_id,
             jsonb_agg(jsonb_build_object('tipo', r.tipo, 'descripcion', r.descripcion_original,
                                          'unidad', r.unidad, 'cantidad', r.cantidad)
                       order by r.created_at, r.id) as lineas
        from apu_import_revision r join presupuesto_items pi on pi.id = r.presupuesto_item_id
       where pi.version_id = v_version and r.dividida_de is null and not r.agregada_por_modalidad
       group by r.presupuesto_item_id
    )
    select jsonb_agg(jsonb_build_object(
             'codigo', pi.codigo, 'descripcion', pi.descripcion, 'unidad', pi.unidad,
             'cantidad', pi.cantidad, 'precio_oficial', pi.precio_original,
             'es_hoja', not exists (select 1 from presupuesto_items h where h.padre_id = pi.id),
             'tiene_apu', pi.apu_id is not null, 'modalidad', pi.modalidad,
             'con_requisiciones', pi.codigo in (select codigo from req),
             'con_contratos', pi.codigo in (select codigo from con),
             'lineas', coalesce(lin.lineas, '[]'::jsonb)))
      from presupuesto_items pi
      left join lin on lin.presupuesto_item_id = pi.id
     where pi.version_id = v_version
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.datos_comparar_version(uuid) from public, anon;
grant execute on function public.datos_comparar_version(uuid) to authenticated;

commit;
