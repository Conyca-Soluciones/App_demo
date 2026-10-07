-- Import de presupuesto abandonado: se descarta y hay que volver a subirlo.
--
-- El import con hoja APU lo dirige el navegador, en tandas de 40 ítems (unos
-- 8 s cada una). Si la página se cierra o se recarga a mitad, se detiene y
-- el presupuesto queda con una parte de los ítems sin APU (pasó en la prueba
-- de volumen: 240 de 1.500). Decisión del usuario: avisar antes de salir y,
-- si igual se sale, descartar lo subido para que el import empiece de cero.
--
-- 1. presupuesto_versiones.import_latido_at: la página que importa lo
--    actualiza cada 10 s (latido_import_presupuesto) y lo limpia al terminar.
--    Lleno y con más de 45 s sin latido = import abandonado.
-- 2. descartar_import_abandonado: al abrir el presupuesto, si la versión
--    actual tiene un import abandonado lo borra en una sola transacción:
--    la versión con sus ítems, APU, líneas de revisión y precios de
--    transporte; si era la única versión, el presupuesto completo. La versión
--    anterior vuelve a ser la actual. No borra nada si ya hay requisiciones o
--    contratos sobre esos ítems (no debería pasar durante un import).
--
-- Se puede correr más de una vez.

alter table public.presupuesto_versiones
  add column if not exists import_latido_at timestamptz;

-- ------------------------------------------------------------------ latido
create or replace function public.latido_import_presupuesto(p_presupuesto_id uuid, p_activo boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_proyecto uuid;
  v_version uuid;
begin
  select proyecto_id, version_actual_id into v_proyecto, v_version
    from presupuestos where id = p_presupuesto_id;
  if v_version is null then
    return;
  end if;
  if not public.usuario_puede_editar_proyecto(auth.uid(), v_proyecto) then
    raise exception 'No tienes permiso para editar este presupuesto.';
  end if;
  update presupuesto_versiones
     set import_latido_at = case when p_activo then now() end
   where id = v_version;
end;
$$;

revoke all on function public.latido_import_presupuesto(uuid, boolean) from public, anon;
grant execute on function public.latido_import_presupuesto(uuid, boolean) to authenticated;

-- ------------------------------------------------- descartar el abandonado
-- Devuelve {estado}: 'ninguno' | 'en_curso' (+ segundos para considerarlo
-- abandonado) | 'con_movimientos' (no se borró) | 'descartado' (+
-- presupuesto_borrado, version).
create or replace function public.descartar_import_abandonado(p_presupuesto_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pres record;
  v_ver record;
  v_anterior uuid;
  v_apus uuid[];
  v_espera constant interval := interval '45 seconds';
begin
  select id, proyecto_id, version_actual_id into v_pres
    from presupuestos where id = p_presupuesto_id
     for update;
  if not found or v_pres.version_actual_id is null then
    return jsonb_build_object('estado', 'ninguno');
  end if;

  select id, numero, nombre, import_latido_at into v_ver
    from presupuesto_versiones where id = v_pres.version_actual_id;
  if v_ver.import_latido_at is null then
    return jsonb_build_object('estado', 'ninguno');
  end if;
  if v_ver.import_latido_at > now() - v_espera
     or not public.usuario_puede_editar_proyecto(auth.uid(), v_pres.proyecto_id) then
    return jsonb_build_object(
      'estado', 'en_curso',
      'segundos', greatest(1, ceil(extract(epoch from (v_ver.import_latido_at + v_espera - now()))))
    );
  end if;

  if exists (select 1 from pedidos_insumos pe join presupuesto_items pi on pi.id = pe.presupuesto_item_id
              where pi.version_id = v_ver.id)
     or exists (select 1 from contrato_anexo_items ca join presupuesto_items pi on pi.id = ca.presupuesto_item_id
                 where pi.version_id = v_ver.id) then
    update presupuesto_versiones set import_latido_at = null where id = v_ver.id;
    return jsonb_build_object('estado', 'con_movimientos');
  end if;

  -- Los ítems arrastran (cascade) líneas de revisión, precios de transporte y
  -- solicitudes pendientes; los APU se borran después (presupuesto_items.apu_id
  -- no tiene cascade) y arrastran item_apu.
  select coalesce(array_agg(distinct apu_id) filter (where apu_id is not null), '{}')
    into v_apus
    from presupuesto_items where version_id = v_ver.id;

  delete from presupuesto_items where version_id = v_ver.id;
  delete from apu a
   where a.id = any(v_apus)
     and not exists (select 1 from presupuesto_items pi where pi.apu_id = a.id);

  select id into v_anterior
    from presupuesto_versiones
   where presupuesto_id = v_pres.id and id <> v_ver.id
   order by numero desc
   limit 1;

  if v_anterior is null then
    delete from presupuestos where id = v_pres.id; -- cascade: la versión
    return jsonb_build_object('estado', 'descartado', 'presupuesto_borrado', true, 'version', v_ver.nombre);
  end if;

  update presupuestos set version_actual_id = v_anterior where id = v_pres.id;
  delete from presupuesto_versiones where id = v_ver.id;
  return jsonb_build_object('estado', 'descartado', 'presupuesto_borrado', false, 'version', v_ver.nombre);
end;
$$;

revoke all on function public.descartar_import_abandonado(uuid) from public, anon;
grant execute on function public.descartar_import_abandonado(uuid) to authenticated;
