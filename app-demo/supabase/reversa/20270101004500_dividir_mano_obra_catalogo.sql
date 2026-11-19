-- Reversa de 20270101004500_dividir_mano_obra_catalogo.sql: vuelve la versión
-- de 20270101004400 (nombres sin categoría elegida; lo que no está en el
-- catálogo va a Aprobación de mano de obra).

begin;
set local lock_timeout = '10s';

drop function if exists public.dividir_mano_obra_item(uuid, jsonb);

create or replace function public.dividir_mano_obra_item(p_item uuid, p_trabajos text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v record;
  v_info jsonb;
  v_excel text;
  v_lote uuid;
  v_nombres text[] := '{}';
  v_claves text[] := '{}';
  v_nombre text;
  v_cat uuid;
  v_sol uuid;
  v_rev uuid;
  v_ia uuid;
  v_sols uuid[];
  v_en_catalogo integer := 0;
  v_por_aprobar integer := 0;
begin
  if v_uid is null or not public.tiene_accion(v_uid, 'editar_presupuestos') then
    raise exception 'No tienes permiso para editar presupuestos.';
  end if;

  select pi.id, pi.codigo, pi.unidad, pi.apu_id, pi.presupuesto_id into v
    from presupuesto_items pi where pi.id = p_item for update;
  if not found then
    raise exception 'El ítem no existe.';
  end if;

  v_info := public.info_division_mano_obra(p_item);
  if v_info->>'motivo' is not null then
    raise exception '%', v_info->>'motivo';
  end if;
  if (v_info->>'dividida')::boolean then
    raise exception 'La mano de obra del ítem % ya está dividida: júntala otra vez antes de dividirla de nuevo.', v.codigo;
  end if;

  foreach v_nombre in array coalesce(p_trabajos, '{}') loop
    v_nombre := regexp_replace(trim(coalesce(v_nombre, '')), '\s+', ' ', 'g');
    if v_nombre = '' then
      raise exception 'Escribe el nombre de cada trabajo.';
    end if;
    if length(v_nombre) > 200 then
      raise exception 'El nombre "%" es muy largo (máximo 200 caracteres).', left(v_nombre, 40);
    end if;
    if public._clave_actividad(v_nombre) = any (v_claves) then
      raise exception 'Hay dos trabajos con el nombre "%".', v_nombre;
    end if;
    v_claves := v_claves || public._clave_actividad(v_nombre);
    v_nombres := v_nombres || v_nombre;
  end loop;
  if coalesce(array_length(v_nombres, 1), 0) < 2 then
    raise exception 'Escribe al menos dos trabajos.';
  end if;
  if array_length(v_nombres, 1) > 15 then
    raise exception 'Máximo 15 trabajos por ítem.';
  end if;

  select string_agg(distinct r.descripcion_original, ' · '), (array_agg(r.lote_import_id))[1]
    into v_excel, v_lote
    from apu_import_revision r
   where r.presupuesto_item_id = p_item and r.tipo = 'MO' and r.estado <> 'dividido';
  v_excel := coalesce(v_excel, 'Mano de obra del APU');
  v_lote := coalesce(v_lote, (select r.lote_import_id from apu_import_revision r where r.presupuesto_item_id = p_item limit 1),
                     gen_random_uuid());

  -- Las líneas del Excel quedan divididas (sueltas de su solicitud y de su
  -- línea del APU); las solicitudes pendientes que solo servían a ellas se borran.
  select array_agg(distinct r.solicitud_mano_obra_id) filter (where r.solicitud_mano_obra_id is not null)
    into v_sols
    from apu_import_revision r
   where r.presupuesto_item_id = p_item and r.tipo = 'MO' and r.estado <> 'dividido';
  update apu_import_revision r
     set estado = 'dividido', solicitud_mano_obra_id = null, item_apu_id = null
   where r.presupuesto_item_id = p_item and r.tipo = 'MO' and r.estado <> 'dividido';
  delete from solicitudes_mano_obra s
   where s.id = any (coalesce(v_sols, '{}')) and s.estado = 'pendiente'
     and not exists (select 1 from apu_import_revision r2 where r2.solicitud_mano_obra_id = s.id);
  delete from item_apu where apu_id = v.apu_id and mano_obra_categoria_id is not null;

  foreach v_nombre in array v_nombres loop
    insert into apu_import_revision (lote_import_id, presupuesto_item_id, apu_id, descripcion_original, tipo, unidad,
                                     cantidad, candidatos, estado, dividida_de)
    values (v_lote, p_item, v.apu_id, v_nombre, 'MO', v.unidad, 1, '[]'::jsonb, 'pendiente', v_excel)
    returning id into v_rev;

    select moc.id into v_cat
      from mano_obra_categorias moc
     where public._clave_actividad(moc.categoria) = public._clave_actividad(v_nombre)
       and public._clave_unidad(moc.unidad) = public._clave_unidad(v.unidad)
       and moc.valor_unitario is not null
     order by moc.created_at, moc.id
     limit 1;

    if v_cat is not null then
      insert into item_apu (apu_id, mano_obra_categoria_id, cantidad, rendimiento, tipo)
      values (v.apu_id, v_cat, 1, 1, 'MO')
      returning id into v_ia;
      update apu_import_revision
         set estado = 'resuelto', mano_obra_categoria_id_asignado = v_cat, item_apu_id = v_ia
       where id = v_rev;
      v_en_catalogo := v_en_catalogo + 1;
    else
      select s.id into v_sol
        from solicitudes_mano_obra s
       where s.estado = 'pendiente'
         and public._clave_actividad(s.descripcion) = public._clave_actividad(v_nombre)
         and public._clave_unidad(s.unidad) = public._clave_unidad(v.unidad)
         and public._ambito_item(s.presupuesto_item_id) = public._ambito_item(p_item)
       order by s.created_at, s.id
       limit 1;
      if v_sol is null then
        insert into solicitudes_mano_obra (descripcion, solicitado_por, presupuesto_item_id, unidad, estado)
        values (v_nombre, v_uid, p_item, v.unidad, 'pendiente')
        returning id into v_sol;
      end if;
      update apu_import_revision
         set estado = 'solicitud_pendiente', solicitud_mano_obra_id = v_sol
       where id = v_rev;
      v_por_aprobar := v_por_aprobar + 1;
    end if;
    v_cat := null;
    v_sol := null;
  end loop;

  perform public.recalcular_valor_apus(array[v.apu_id]);
  perform public._anotar_historial('presupuesto', v.presupuesto_id, 'mano_obra_dividida',
    jsonb_build_object('codigo', v.codigo, 'excel', v_excel, 'trabajos', to_jsonb(v_nombres)));

  return jsonb_build_object('trabajos', array_length(v_nombres, 1), 'en_catalogo', v_en_catalogo,
                            'por_aprobar', v_por_aprobar);
end;
$function$;

grant execute on function public.dividir_mano_obra_item(uuid, text[]) to authenticated;

commit;
