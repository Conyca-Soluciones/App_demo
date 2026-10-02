-- Auditoría de seguridad (2026-10-02). Lo que se podía hacer llamando la API
-- directamente, sin pasar por las pantallas:
--
--  1. vincular_apus_masivo: cualquier usuario con sesión podía cambiarle el
--     APU (y con eso el precio) a CUALQUIER ítem de presupuesto de cualquier
--     proyecto. Ahora exige poder editar el proyecto de cada ítem.
--  2. resumen_ejecucion_proyecto / resumen_capitulos_proyecto: devolvían lo
--     presupuestado y lo comprado de cualquier proyecto (el "solo admin" vivía
--     en la Server Action). Ahora exigen la pestaña Visualización y ver el
--     proyecto.
--  3. Funciones internas que solo llaman otras funciones privilegiadas: sin
--     EXECUTE para usuarios (_recalcular_estado_entrega escribe en
--     ordenes_compra). email_por_username no la usa nadie y revelaba correos.
--  4. Funciones de disparador: sin EXECUTE (los disparadores siguen
--     funcionando; llamarlas por la API no tiene uso).
--  5. _tmp_auditoria_buscar: copia vieja de una auditoría, expuesta por la API
--     sin RLS. Se activa RLS sin políticas (nadie la lee por la API). No se
--     borra.
--  6. search_path fijo en las funciones que no lo tenían.

-- ---------------------------------------------------------------- 1
create or replace function public.vincular_apus_masivo(vinculos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if jsonb_typeof(vinculos) is distinct from 'array' then
    raise exception 'Datos inválidos.';
  end if;
  -- Cada ítem debe existir y ser de un proyecto que el usuario puede editar.
  if exists (
    select 1
    from jsonb_array_elements(vinculos) v
    left join presupuesto_items pi on pi.id = (v->>'item_id')::uuid
    left join presupuestos pr on pr.id = pi.presupuesto_id
    where pi.id is null or not public.usuario_puede_editar_proyecto(auth.uid(), pr.proyecto_id)
  ) then
    raise exception 'No tienes permiso para editar uno de los ítems del presupuesto.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(vinculos) v
    where v->>'apu_id' is not null and not exists (select 1 from apu a where a.id = (v->>'apu_id')::uuid)
  ) then
    raise exception 'Uno de los APU no existe.';
  end if;

  update public.presupuesto_items pi
     set apu_id = (v->>'apu_id')::uuid
    from jsonb_array_elements(vinculos) as v
   where pi.id = (v->>'item_id')::uuid;
end;
$$;
revoke all on function public.vincular_apus_masivo(jsonb) from public, anon;
grant execute on function public.vincular_apus_masivo(jsonb) to authenticated;

-- ---------------------------------------------------------------- 2
-- Las consultas originales quedan como _base (sin acceso directo) y el nombre
-- público pasa a ser una envoltura que revisa permisos.
alter function public.resumen_ejecucion_proyecto(uuid) rename to _resumen_ejecucion_proyecto_base;
alter function public.resumen_capitulos_proyecto(uuid) rename to _resumen_capitulos_proyecto_base;
revoke all on function public._resumen_ejecucion_proyecto_base(uuid) from public, anon, authenticated;
revoke all on function public._resumen_capitulos_proyecto_base(uuid) from public, anon, authenticated;

create or replace function public.resumen_ejecucion_proyecto(p_proyecto_id uuid)
returns table(
  insumo_id uuid, insumo_codigo integer, insumo_descripcion text, insumo_um text,
  cantidad_presupuestada numeric, valor_presupuestado numeric, cantidad_pedida numeric,
  cantidad_comprada numeric, valor_comprado numeric, cantidad_salida numeric, valor_salida numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.tiene_pestana(auth.uid(), 'admin.visualizacion')
          and public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id)) then
    raise exception 'No tienes permiso para ver la ejecución de este proyecto.';
  end if;
  return query select * from public._resumen_ejecucion_proyecto_base(p_proyecto_id);
end;
$$;

create or replace function public.resumen_capitulos_proyecto(p_proyecto_id uuid)
returns table(capitulo_id uuid, capitulo_nombre text, valor_presupuestado numeric, valor_comprado numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.tiene_pestana(auth.uid(), 'admin.visualizacion')
          and public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id)) then
    raise exception 'No tienes permiso para ver la ejecución de este proyecto.';
  end if;
  return query select * from public._resumen_capitulos_proyecto_base(p_proyecto_id);
end;
$$;
revoke all on function public.resumen_ejecucion_proyecto(uuid) from public, anon;
revoke all on function public.resumen_capitulos_proyecto(uuid) from public, anon;
grant execute on function public.resumen_ejecucion_proyecto(uuid) to authenticated;
grant execute on function public.resumen_capitulos_proyecto(uuid) to authenticated;

-- El aviso de "insumo sobre presupuesto" (disparador al aprobar una orden de
-- compra) usaba resumen_ejecucion_proyecto: con el chequeo nuevo, la orden de
-- un usuario de Compras sin la pestaña Visualización habría fallado. Usa la
-- consulta base (corre dentro de la base, no a nombre de quien consulta).
create or replace function public.notificar_insumo_sobre_presupuesto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fila record;
  pct_sobre numeric;
  titulo text;
  mensaje text;
begin
  for fila in
    select r.insumo_descripcion, r.valor_presupuestado, r.valor_comprado
    from public._resumen_ejecucion_proyecto_base(new.proyecto_id) r
    where r.insumo_id in (
      select distinct pe.insumo_id
      from ordenes_compra_items oci
      join pedidos_insumos pe on pe.id = oci.pedido_insumo_id
      where oci.orden_compra_id = new.id
    )
    and r.valor_presupuestado > 0
    and r.valor_comprado > r.valor_presupuestado
  loop
    pct_sobre := (fila.valor_comprado / fila.valor_presupuestado - 1) * 100;
    titulo := case when pct_sobre >= 10 then 'Insumo con sobrecosto (+10%)' else 'Insumo sobre presupuesto' end;
    mensaje := fila.insumo_descripcion || ': comprado $' || round(fila.valor_comprado)::text ||
      ' vs. presupuestado $' || round(fila.valor_presupuestado)::text ||
      ' (' || round(pct_sobre, 1) || '% por encima). Orden de compra #' || new.numero || '.';

    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    select p.id, 'insumo_sobre_presupuesto', 'orden_compra', new.id, titulo, mensaje
    from perfiles p
    where public.tiene_accion(p.id, 'aprobar_oc');
  end loop;

  return new;
end;
$$;

-- ---------------------------------------------------------------- 3
revoke all on function public._recalcular_estado_entrega(uuid) from public, anon, authenticated;
revoke all on function public._disponible_insumo_proyecto(uuid, uuid) from public, anon, authenticated;
revoke all on function public._recibido_linea_oc(uuid) from public, anon, authenticated;
revoke all on function public.precio_promedio_compra_insumo(uuid) from public, anon, authenticated;
revoke all on function public.email_por_username(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4 y 6
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
  end loop;

  for f in
    select p.oid::regprocedure as firma
    from pg_proc p
    left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    where p.pronamespace = 'public'::regnamespace
      and d.objid is null -- no las de extensiones (pg_trgm)
      and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public', f.firma);
  end loop;
end $$;

-- ---------------------------------------------------------------- 5
alter table public._tmp_auditoria_buscar enable row level security;
