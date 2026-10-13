-- Aprobación de actas y cupo del contrato (2026-10-14).
-- Requiere 20261110000000_actas_contratos.sql.
--
-- 1. Cupo: las actas de un contrato no pueden sumar más que su valor. Toda acta
--    que no esté rechazada (por aprobar o aprobada) consume cupo; rechazar una
--    lo devuelve. crear_acta lo revisa con el contrato bloqueado.
-- 2. Aprobación de actas (pestaña contratos.aprobar_actas, acción
--    aprobar_actas): listar, ver el detalle y aprobar o rechazar (con motivo)
--    las actas por aprobar. Por defecto: Gerencia.
-- Se puede correr más de una vez.

-- ---------------------------------------------------------------- ver actas
-- Las ve quien elabora (contratos.cortes) o quien aprueba (contratos.aprobar_actas).
create or replace function public.puede_ver_actas(p_proyecto_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select (public.tiene_pestana(auth.uid(), 'contratos.cortes')
          or public.tiene_pestana(auth.uid(), 'contratos.aprobar_actas'))
     and public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id)
$function$;

-- ---------------------------------------------------------------- cupo
-- Lo que ya usan las actas del contrato (por aprobar + aprobadas).
create or replace function public._consumido_actas_contrato(p_contrato_id uuid)
 returns numeric
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(sum(a.total), 0) from actas a where a.contrato_id = p_contrato_id and a.estado <> 'rechazada'
$function$;
revoke all on function public._consumido_actas_contrato(uuid) from public, anon, authenticated;

-- Pesos en formato colombiano para los mensajes ("$1.250.000,50").
create or replace function public._pesos_texto(p numeric)
 returns text
 language sql
 immutable
as $function$
  select '$' || translate(to_char(round(p, 2), 'FM999,999,999,999,990.00'), ',.', '.,')
$function$;

-- crear_acta igual que antes + el tope del cupo.
create or replace function public.crear_acta(p_contrato_id uuid, p_lineas jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_contrato record;
  v_version uuid;
  v_acta uuid;
  v_numero integer;
  v_orden integer := 0;
  v_total numeric := 0;
  v_disponible numeric;
  v_item record;
  v_linea record;
  v_cantidad numeric;
  v_base numeric;
  v_iva numeric;
  d jsonb;
begin
  if not public.tiene_accion(auth.uid(), 'elaborar_actas') then
    raise exception 'No tienes permiso para elaborar actas.';
  end if;

  -- Bloquea el contrato: dos actas a la vez no sacan el mismo número ni se
  -- pasan juntas del cupo.
  select c.id, c.estado, c.proyecto_id, c.valor into v_contrato from contratos c where c.id = p_contrato_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v_contrato.proyecto_id) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  if v_contrato.estado <> 'aprobada' then
    raise exception 'Solo se hacen actas de contratos aprobados.';
  end if;

  if jsonb_typeof(coalesce(p_lineas, 'null')) is distinct from 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos una línea al acta.';
  end if;
  if jsonb_array_length(p_lineas) > 20 then
    raise exception 'Un acta tiene como máximo 20 líneas.';
  end if;
  if (select count(distinct (e->>'presupuesto_item_id') || '|' || (e->>'item_apu_id')) from jsonb_array_elements(p_lineas) e)
     <> jsonb_array_length(p_lineas) then
    raise exception 'Hay una línea repetida (mismo ítem e insumo).';
  end if;

  v_disponible := v_contrato.valor - public._consumido_actas_contrato(p_contrato_id);
  select p.version_actual_id into v_version from presupuestos p where p.proyecto_id = v_contrato.proyecto_id;

  select coalesce(max(a.numero), 0) + 1 into v_numero from actas a where a.contrato_id = p_contrato_id;
  insert into actas (contrato_id, numero, total, creado_por)
  values (p_contrato_id, v_numero, 0, auth.uid())
  returning id into v_acta;

  for d in select * from jsonb_array_elements(p_lineas) loop
    v_orden := v_orden + 1;
    begin
      v_cantidad := (d->>'cantidad')::numeric;
    exception when others then
      raise exception 'La cantidad de la línea % no es un número.', v_orden;
    end;
    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'La cantidad de la línea % debe ser mayor que cero.', v_orden;
    end if;

    select pi.id, pi.codigo, pi.descripcion into v_item
    from presupuesto_items pi
    where pi.id = (d->>'presupuesto_item_id')::uuid and pi.version_id = v_version;
    if not found then
      raise exception 'El ítem de la línea % no es del presupuesto vigente del proyecto.', v_orden;
    end if;

    select l.* into v_linea from public._lineas_apu_para_acta(v_item.id) l
    where l.item_apu_id = (d->>'item_apu_id')::uuid;
    if not found then
      raise exception 'El insumo de la línea % no es del APU del ítem %.', v_orden, v_item.codigo;
    end if;
    if v_linea.precio is null then
      raise exception 'El insumo de la línea % no tiene precio.', v_orden;
    end if;

    v_base := round(v_cantidad * v_linea.precio, 2);
    v_iva := round(v_base * v_linea.iva_porcentaje / 100, 2);
    v_total := v_total + v_base + v_iva;

    insert into acta_lineas (acta_id, orden, presupuesto_item_id, item_apu_id, item_codigo, item_descripcion,
                             insumo_codigo, insumo_descripcion, unidad, cantidad, precio, iva_porcentaje,
                             base_iva, iva, total)
    values (v_acta, v_orden, v_item.id, v_linea.item_apu_id, v_item.codigo, v_item.descripcion,
            v_linea.insumo_codigo, v_linea.descripcion, v_linea.unidad, v_cantidad, v_linea.precio,
            v_linea.iva_porcentaje, v_base, v_iva, v_base + v_iva);
  end loop;

  if v_total > v_disponible then
    raise exception 'El acta suma % y el saldo del contrato es %. Las actas no pueden superar el valor del contrato.',
      public._pesos_texto(v_total), public._pesos_texto(greatest(v_disponible, 0));
  end if;

  update actas set total = v_total where id = v_acta;
  return jsonb_build_object('id', v_acta, 'numero', v_numero);
end;
$function$;
revoke all on function public.crear_acta(uuid, jsonb) from public, anon;
grant execute on function public.crear_acta(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- listar para aprobación
-- Todas las actas de los proyectos que el usuario ve; p_estado null = todas.
create or replace function public.listar_actas_aprobacion(p_estado text default null, p_proyecto_id uuid default null)
 returns table(acta_id uuid, numero integer, estado text, total numeric, created_at timestamptz,
               creado_por_nombre text, contrato_id uuid, numero_contrato text, contrato_valor numeric,
               proyecto_codigo text, proyecto_nombre text, contratista_nombre text,
               resuelto_por_nombre text, resuelto_at timestamptz)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if not public.tiene_pestana(auth.uid(), 'contratos.aprobar_actas') then
    raise exception 'No tienes permiso para ver la aprobación de actas.';
  end if;

  return query
  select a.id, a.numero, a.estado, a.total, a.created_at, pc.nombre,
         c.id, c.numero_contrato, c.valor, p.codigo, p.nombre, k.nombre,
         pr.nombre, a.resuelto_at
  from actas a
  join contratos c on c.id = a.contrato_id
  join proyectos p on p.id = c.proyecto_id
  join contratistas k on k.id = c.contratista_id
  left join perfiles pc on pc.id = a.creado_por
  left join perfiles pr on pr.id = a.resuelto_por
  where public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
    and (p_estado is null or a.estado = p_estado)
    and (p_proyecto_id is null or c.proyecto_id = p_proyecto_id)
  -- Las que esperan: primero las más antiguas (orden de llegada).
  order by a.created_at, a.id
  limit 1000;
end;
$function$;
revoke all on function public.listar_actas_aprobacion(text, uuid) from public, anon;
grant execute on function public.listar_actas_aprobacion(text, uuid) to authenticated;

-- ---------------------------------------------------------------- detalle
-- El acta con su contrato, el cupo y sus líneas (para Elaboración y Aprobación).
create or replace function public.detalle_acta(p_acta_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v record;
begin
  select a.*, c.proyecto_id, c.numero_contrato, c.numero as contrato_numero, c.valor as contrato_valor,
         c.objeto, c.tipo, p.codigo as proyecto_codigo, p.nombre as proyecto_nombre,
         k.nombre as contratista_nombre,
         k.tipo_documento || ' ' || k.numero_documento || coalesce('-' || k.digito_verificacion, '') as contratista_documento,
         pc.nombre as creado_por_nombre, pr.nombre as resuelto_por_nombre
    into v
  from actas a
  join contratos c on c.id = a.contrato_id
  join proyectos p on p.id = c.proyecto_id
  join contratistas k on k.id = c.contratista_id
  left join perfiles pc on pc.id = a.creado_por
  left join perfiles pr on pr.id = a.resuelto_por
  where a.id = p_acta_id;
  if not found or not public.puede_ver_actas(v.proyecto_id) then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;

  return jsonb_build_object(
    'id', v.id, 'numero', v.numero, 'estado', v.estado, 'total', v.total,
    'created_at', v.created_at, 'creado_por_nombre', v.creado_por_nombre,
    'resuelto_at', v.resuelto_at, 'resuelto_por_nombre', v.resuelto_por_nombre,
    'motivo_resolucion', v.motivo_resolucion,
    'contrato_id', v.contrato_id, 'numero_contrato', coalesce(v.numero_contrato, 'Solicitud N° ' || v.contrato_numero),
    'contrato_valor', v.contrato_valor, 'objeto', v.objeto, 'tipo', v.tipo,
    'proyecto_codigo', v.proyecto_codigo, 'proyecto_nombre', v.proyecto_nombre,
    'contratista_nombre', v.contratista_nombre, 'contratista_documento', v.contratista_documento,
    -- Lo que usan las DEMÁS actas del contrato (por aprobar + aprobadas).
    'otras_actas', (select coalesce(sum(o.total), 0) from actas o
                     where o.contrato_id = v.contrato_id and o.id <> v.id and o.estado <> 'rechazada'),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'orden', l.orden, 'item_codigo', l.item_codigo, 'item_descripcion', l.item_descripcion,
               'insumo_codigo', l.insumo_codigo, 'insumo_descripcion', l.insumo_descripcion, 'unidad', l.unidad,
               'cantidad', l.cantidad, 'precio', l.precio, 'iva_porcentaje', l.iva_porcentaje,
               'base_iva', l.base_iva, 'iva', l.iva, 'total', l.total) order by l.orden)
      from acta_lineas l where l.acta_id = v.id), '[]'::jsonb)
  );
end;
$function$;
revoke all on function public.detalle_acta(uuid) from public, anon;
grant execute on function public.detalle_acta(uuid) to authenticated;

-- ---------------------------------------------------------------- aprobar / rechazar
create or replace function public.resolver_acta(p_acta_id uuid, p_accion text, p_motivo text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v record;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_actas') then
    raise exception 'No tienes permiso para aprobar actas.';
  end if;
  select a.id, a.estado, c.proyecto_id into v
  from actas a join contratos c on c.id = a.contrato_id
  where a.id = p_acta_id
  for update of a;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v.proyecto_id) then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;
  if v.estado <> 'pendiente' then
    raise exception 'Esta acta ya no está por aprobar (actualiza la página).';
  end if;
  if p_accion not in ('aprobar', 'rechazar') then
    raise exception 'Acción no válida.';
  end if;
  if p_accion = 'rechazar' and v_motivo is null then
    raise exception 'Escribe el motivo.';
  end if;

  update actas
     set estado = case when p_accion = 'aprobar' then 'aprobada' else 'rechazada' end,
         resuelto_por = auth.uid(), resuelto_at = now(),
         motivo_resolucion = case when p_accion = 'rechazar' then v_motivo end
   where id = p_acta_id;
end;
$function$;
revoke all on function public.resolver_acta(uuid, text, text) from public, anon;
grant execute on function public.resolver_acta(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- roles
insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
from public.roles r
cross join (values ('tab.contratos.aprobar_actas'), ('accion.aprobar_actas')) as p(permiso)
where r.clave = 'gerencia'
on conflict do nothing;
