-- Salidas registradas: lista paginada para verlas, editarlas y anularlas.
--
-- No había ninguna pantalla para ver las salidas de un proyecto: una salida
-- equivocada no se podía corregir, y eso además impedía anular la entrada de
-- ese insumo ("anula primero las salidas", sin dónde hacerlo). Editar y anular
-- ya existían en la base (editar_salida_almacen / anular_salida_almacen); falta
-- la lista. listar_salidas_proyecto (sin uso) traía las últimas 200 sin avisar.
--
-- Una página a la vez (la pantalla pide una fila de más para saber si hay
-- siguiente), con filtros en la base. Índice para el orden por fecha dentro
-- del proyecto. Se puede correr más de una vez.

create index if not exists idx_salidas_insumos_proyecto_creada
  on public.salidas_insumos (proyecto_id, created_at desc, id desc);

create or replace function public.listar_salidas_registradas(
  p_proyecto_id uuid,
  p_insumo text default null,          -- código exacto o parte de la descripción
  p_desde date default null,           -- fecha de la salida, inclusive
  p_hasta date default null,
  p_incluir_anuladas boolean default true,
  p_limite integer default 51,
  p_offset integer default 0
)
returns table (
  id uuid,
  fecha date,
  created_at timestamptz,
  insumo_codigo integer,
  insumo_descripcion text,
  insumo_um text,
  cantidad numeric,
  cantidad_original numeric,
  retira text,
  observaciones text,
  registrado_por_nombre text,
  editada_at timestamptz,
  editada_por_nombre text,
  anulada_at timestamptz,
  anulada_por_nombre text,
  motivo_anulacion text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_insumo text := nullif(btrim(p_insumo), '');
begin
  if not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes permiso para ver las salidas de este proyecto.';
  end if;

  return query
  select s.id, s.fecha, s.created_at, mi.codigo, mi.descripcion, mi.u_m, s.cantidad,
         s.cantidad_original, s.retira, s.observaciones, pr.nombre,
         s.editada_at, pe.nombre, s.anulada_at, pa.nombre, s.motivo_anulacion
    from salidas_insumos s
    join maestro_insumos mi on mi.id = s.insumo_id
    left join perfiles pr on pr.id = s.registrado_por
    left join perfiles pe on pe.id = s.editada_por
    left join perfiles pa on pa.id = s.anulada_por
   where s.proyecto_id = p_proyecto_id
     and (p_incluir_anuladas or s.anulada_at is null)
     and (p_desde is null or s.fecha >= p_desde)
     and (p_hasta is null or s.fecha <= p_hasta)
     and (v_insumo is null
          or mi.codigo::text = v_insumo
          or mi.descripcion ilike '%' || v_insumo || '%')
   order by s.created_at desc, s.id desc
   limit least(greatest(coalesce(p_limite, 51), 1), 201)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.listar_salidas_registradas(uuid, text, date, date, boolean, integer, integer) from public, anon;
grant execute on function public.listar_salidas_registradas(uuid, text, date, date, boolean, integer, integer) to authenticated;
