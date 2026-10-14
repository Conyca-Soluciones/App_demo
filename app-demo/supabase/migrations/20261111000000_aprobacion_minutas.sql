-- Aprobación de minutas por Subgerencia (Contratos › Aprobación de minutas).
--
-- Después de pre-aprobar la solicitud (contratos.estado = 'aprobada'),
-- Jurídica arma la minuta y la ENVÍA a Subgerencia. Subgerencia la aprueba o
-- la devuelve con motivo. El estado de la minuta va en su propia columna
-- (contratos.minuta_estado), el de la solicitud no cambia:
--   null         -> Jurídica la está armando
--   en_revision  -> enviada, esperando a Subgerencia (Jurídica ya no la edita)
--   devuelta     -> Subgerencia la devolvió con motivo; Jurídica la corrige y la
--                   envía otra vez
--   aprobada     -> definitiva: el contrato recibe su número CJ-<n>-<año> y ya
--                   se le pueden hacer actas
-- Al enviar se guarda la minuta COMPLETA (lo calculado + lo editado) en
-- minuta_datos: Subgerencia aprueba exactamente lo que se envió, aunque después
-- cambien los datos del contratista o del proyecto.
--
-- Permisos: pestaña contratos.aprobar_minutas y acción aprobar_minutas (rol
-- nuevo de sistema "Subgerencia"). Enviar es la acción aprobar_contratos
-- (Jurídica), igual que editar la minuta.
-- Se puede correr más de una vez.

-- ---------------------------------------------------------------- columnas
alter table public.contratos
  add column if not exists minuta_estado text,
  add column if not exists minuta_enviada_at timestamptz,
  add column if not exists minuta_enviada_por uuid references public.perfiles(id),
  add column if not exists minuta_resuelta_at timestamptz,
  add column if not exists minuta_resuelta_por uuid references public.perfiles(id),
  -- Motivo de la última devolución (el historial guarda todos).
  add column if not exists minuta_motivo text;

alter table public.contratos drop constraint if exists contratos_minuta_estado_check;
alter table public.contratos add constraint contratos_minuta_estado_check
  check (minuta_estado is null or minuta_estado in ('en_revision', 'devuelta', 'aprobada'));

create index if not exists idx_contratos_minuta_enviada_por on public.contratos (minuta_enviada_por);
create index if not exists idx_contratos_minuta_resuelta_por on public.contratos (minuta_resuelta_por);
create index if not exists idx_contratos_minuta_estado on public.contratos (minuta_estado) where minuta_estado is not null;

-- Los contratos que ya estaban aprobados (con número CJ, alguno con actas)
-- quedan con la minuta aprobada para no romper sus actas.
update public.contratos
   set minuta_estado = 'aprobada', minuta_resuelta_at = coalesce(resuelto_at, now())
 where estado = 'aprobada' and numero_contrato is not null and minuta_estado is null;

-- ---------------------------------------------------------------- número de contrato
-- Antes se asignaba al pre-aprobar la solicitud; ahora al aprobar la minuta
-- (año de la aprobación, hora Colombia).
create or replace function public._asignar_numero_contrato()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.estado = 'aprobada' and new.minuta_estado = 'aprobada' and new.numero_contrato is null then
    new.numero_contrato := 'CJ-' || new.numero || '-'
      || extract(year from (coalesce(new.minuta_resuelta_at, now()) at time zone 'America/Bogota'))::int;
  end if;
  return new;
end;
$$;

drop trigger if exists contratos_numero_contrato on public.contratos;
create trigger contratos_numero_contrato
  before insert or update of estado, minuta_estado on public.contratos
  for each row execute function public._asignar_numero_contrato();

-- ---------------------------------------------------------------- notificaciones
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check
  check (tipo = any (array[
    'pedido_rechazado', 'pedido_aprobado', 'orden_compra_rechazada', 'orden_compra_aprobada',
    'insumo_sobre_presupuesto', 'orden_compra_precio_sobre_efectivo',
    'contrato_por_revisar', 'contrato_aprobado', 'contrato_devuelto', 'contrato_rechazado',
    'acta_aprobada', 'acta_rechazada',
    'minuta_por_revisar', 'minuta_aprobada', 'minuta_devuelta'
  ])) not valid;

-- ---------------------------------------------------------------- rol, pestaña y acción
insert into public.roles (clave, nombre, es_sistema, orden)
values ('subgerencia', 'Subgerencia', true, 52)
on conflict (clave) do nothing;

insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
from public.roles r
cross join (values ('tab.contratos.aprobar_minutas'), ('accion.aprobar_minutas')) as p(permiso)
where r.clave = 'subgerencia'
on conflict do nothing;

-- ---------------------------------------------------------------- RLS
-- Quien tiene la pestaña ve los contratos de sus proyectos (y con eso sus
-- líneas y documentos, cuyas políticas miran el contrato) y los datos y
-- documentos generales del contratista.
drop policy if exists contratos_select on public.contratos;
create policy contratos_select on public.contratos for select to authenticated
  using (
    (
      (select public.tiene_pestana((select auth.uid()), 'contratos.solicitar'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.contratos'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_minutas'))
    )
    and proyecto_id in (select public.proyectos_visibles((select auth.uid())))
  );

drop policy if exists contratistas_select on public.contratistas;
create policy contratistas_select on public.contratistas for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'contratos.contratistas'))
    or (select public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion'))
    or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_minutas'))
    or (select public.tiene_accion((select auth.uid()), 'gestionar_contratistas'))
    or (select public.tiene_accion((select auth.uid()), 'solicitar_contratos'))
  );

drop policy if exists contratista_documentos_select on public.contratista_documentos;
create policy contratista_documentos_select on public.contratista_documentos for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'contratos.contratistas'))
    or (select public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion'))
    or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_minutas'))
    or (select public.tiene_accion((select auth.uid()), 'gestionar_contratistas'))
    or (select public.tiene_accion((select auth.uid()), 'solicitar_contratos'))
  );

drop policy if exists contratistas_archivos_select on storage.objects;
create policy contratistas_archivos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'contratistas'
    and (
      (select public.tiene_pestana((select auth.uid()), 'contratos.contratistas'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_minutas'))
      or (select public.tiene_accion((select auth.uid()), 'gestionar_contratistas'))
    )
  );

-- Historial: también lo ve quien tiene la pestaña de Subgerencia.
create or replace function public.historial_entidad(p_tipo text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  if p_tipo = 'orden_compra' then
    select (public.rol_compras(auth.uid()) or public.usuario_puede_ver_proyecto(auth.uid(), o.proyecto_id))
      into v_ok from public.ordenes_compra o where o.id = p_id;
  elsif p_tipo = 'pedido' then
    select (public.usuario_tiene_acceso_a_item(p.presupuesto_item_id) or public.rol_compras(auth.uid()))
      into v_ok from public.pedidos_insumos p where p.id = p_id;
  elsif p_tipo = 'requisicion' then
    select exists (
      select 1 from public.pedidos_insumos p
      where p.grupo_pedido_id = p_id
        and (public.usuario_tiene_acceso_a_item(p.presupuesto_item_id)
             or public.rol_compras(auth.uid())
             or public.tiene_accion(auth.uid(), 'aprobar_pedidos'))
    ) into v_ok;
  elsif p_tipo = 'contrato' then
    select (
      public.tiene_pestana(auth.uid(), 'contratos.solicitar')
      or public.tiene_pestana(auth.uid(), 'contratos.preaprobacion')
      or public.tiene_pestana(auth.uid(), 'contratos.contratos')
      or public.tiene_pestana(auth.uid(), 'contratos.aprobar_minutas')
    ) and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
      into v_ok from public.contratos c where c.id = p_id;
  else
    raise exception 'Tipo de historial desconocido.';
  end if;

  if not coalesce(v_ok, false) then
    raise exception 'No tienes permiso para ver este historial.';
  end if;

  if p_tipo = 'requisicion' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre,
               'motivo', h.motivo,
               'datos', case when h.entidad_tipo = 'pedido'
                             then coalesce(h.datos, '{}'::jsonb) || jsonb_build_object('insumo', mi.descripcion)
                             else h.datos end,
               'created_at', h.created_at
             ) order by h.created_at, h.id)
        from public.historial_eventos h
        left join public.perfiles pf on pf.id = h.usuario_id
        left join public.pedidos_insumos pe on h.entidad_tipo = 'pedido' and pe.id = h.entidad_id
        left join public.maestro_insumos mi on mi.id = pe.insumo_id
       where (h.entidad_tipo = 'requisicion' and h.entidad_id = p_id)
          or (h.entidad_tipo = 'pedido' and h.evento = 'rechazado_por_compras'
              and pe.grupo_pedido_id = p_id)
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre,
             'motivo', h.motivo, 'datos', h.datos, 'created_at', h.created_at
           ) order by h.created_at, h.id)
      from public.historial_eventos h
      left join public.perfiles pf on pf.id = h.usuario_id
     where h.entidad_tipo = p_tipo and h.entidad_id = p_id
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- editar la minuta
-- Solo mientras Jurídica la arma o la corrige (no en revisión ni aprobada).
create or replace function public.guardar_minuta_contrato(p_id uuid, p_datos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contrato record;
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_contratos') then
    raise exception 'No tienes permiso para editar la minuta.';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'La minuta no es válida.';
  end if;
  if octet_length(p_datos::text) > 200000 then
    raise exception 'La minuta es demasiado grande.';
  end if;

  select id, proyecto_id, estado, minuta_estado into v_contrato from contratos where id = p_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v_contrato.proyecto_id) then
    raise exception 'La solicitud no existe o no tienes acceso.';
  end if;
  if v_contrato.estado = 'rechazada' then
    raise exception 'La solicitud fue rechazada: su minuta ya no se edita.';
  end if;
  if v_contrato.minuta_estado = 'en_revision' then
    raise exception 'La minuta está en revisión de Subgerencia: no se puede editar hasta que la aprueben o la devuelvan.';
  end if;
  if v_contrato.minuta_estado = 'aprobada' then
    raise exception 'La minuta ya fue aprobada por Subgerencia y no se edita.';
  end if;

  update contratos
     set minuta_datos = p_datos,
         minuta_actualizada_at = now(),
         minuta_actualizada_por = auth.uid()
   where id = p_id;
end;
$$;

-- ---------------------------------------------------------------- enviar
-- Jurídica envía la minuta completa (p_datos) a Subgerencia: la guarda y pasa
-- a 'en_revision' en la misma transacción.
create or replace function public.enviar_minuta_contrato(p_id uuid, p_datos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_reenvio boolean;
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_contratos') then
    raise exception 'No tienes permiso para enviar la minuta.';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'La minuta no es válida.';
  end if;
  if octet_length(p_datos::text) > 200000 then
    raise exception 'La minuta es demasiado grande.';
  end if;

  select id, numero, estado, proyecto_id, minuta_estado into v from contratos where id = p_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v.proyecto_id) then
    raise exception 'La solicitud no existe o no tienes acceso.';
  end if;
  if v.estado <> 'aprobada' then
    raise exception 'Solo se envía a Subgerencia la minuta de una solicitud pre-aprobada.';
  end if;
  if v.minuta_estado = 'en_revision' then
    raise exception 'La minuta ya está en revisión de Subgerencia (actualiza la página).';
  end if;
  if v.minuta_estado = 'aprobada' then
    raise exception 'La minuta ya fue aprobada por Subgerencia.';
  end if;
  v_reenvio := v.minuta_estado = 'devuelta';

  update contratos
     set minuta_datos = p_datos,
         minuta_actualizada_at = now(),
         minuta_actualizada_por = auth.uid(),
         minuta_estado = 'en_revision',
         minuta_enviada_at = now(),
         minuta_enviada_por = auth.uid(),
         minuta_resuelta_at = null,
         minuta_resuelta_por = null
   where id = p_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id)
  values ('contrato', p_id, case when v_reenvio then 'minuta_reenviada' else 'minuta_enviada' end, auth.uid());

  -- A quienes aprueban minutas y ven el proyecto (no a los Administradores,
  -- igual que los avisos de pre-aprobación). Una sola inserción.
  insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  select pf.id, 'minuta_por_revisar', 'contrato', p_id,
         case when v_reenvio then 'Minuta corregida' else 'Minuta por aprobar' end,
         'Minuta de la solicitud N° ' || v.numero || ' por aprobar.'
  from perfiles pf
  left join roles r on r.id = pf.rol_id
  where pf.id is distinct from auth.uid()
    and r.clave is distinct from 'administrador'
    and public.tiene_accion(pf.id, 'aprobar_minutas')
    and public.usuario_puede_ver_proyecto(pf.id, v.proyecto_id);
end;
$$;
revoke all on function public.enviar_minuta_contrato(uuid, jsonb) from public, anon;
grant execute on function public.enviar_minuta_contrato(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- aprobar / devolver
create or replace function public.resolver_minuta_contrato(p_id uuid, p_accion text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_numero_contrato text;
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_minutas') then
    raise exception 'No tienes permiso para aprobar minutas.';
  end if;
  if p_accion not in ('aprobar', 'devolver') then
    raise exception 'Acción no válida.';
  end if;
  if p_accion = 'devolver' and v_motivo is null then
    raise exception 'Escribe el motivo.';
  end if;

  -- Bloquea la fila: dos personas no resuelven la misma minuta.
  select id, numero, estado, proyecto_id, minuta_estado, minuta_enviada_por, solicitado_por
    into v from contratos where id = p_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v.proyecto_id) then
    raise exception 'La solicitud no existe o no tienes acceso.';
  end if;
  if v.estado <> 'aprobada' or v.minuta_estado is distinct from 'en_revision' then
    raise exception 'Esta minuta ya no está en revisión (actualiza la página).';
  end if;

  update contratos
     set minuta_estado = case when p_accion = 'aprobar' then 'aprobada' else 'devuelta' end,
         minuta_resuelta_at = now(),
         minuta_resuelta_por = auth.uid(),
         minuta_motivo = case when p_accion = 'aprobar' then minuta_motivo else v_motivo end
   where id = p_id
  returning numero_contrato into v_numero_contrato;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
  values ('contrato', p_id, case when p_accion = 'aprobar' then 'minuta_aprobada' else 'minuta_devuelta' end,
          auth.uid(), v_motivo,
          case when p_accion = 'aprobar' then jsonb_build_object('numero_contrato', v_numero_contrato) end);

  -- A quien la envió (Jurídica: la campanita lleva a Pre-aprobación). Al
  -- aprobar, también a quien pidió el contrato, con el tipo contrato_aprobado
  -- (la campanita lo lleva a Contratos por grupos).
  if v.minuta_enviada_por is not null and v.minuta_enviada_por is distinct from auth.uid() then
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    values (v.minuta_enviada_por,
            case when p_accion = 'aprobar' then 'minuta_aprobada' else 'minuta_devuelta' end,
            'contrato', p_id,
            case when p_accion = 'aprobar' then 'Minuta aprobada' else 'Minuta devuelta' end,
            case when p_accion = 'aprobar'
                 then 'Minuta de la solicitud N° ' || v.numero || ' aprobada por Subgerencia. Contrato ' || v_numero_contrato || '.'
                 else 'Minuta de la solicitud N° ' || v.numero || ' devuelta para corregir. Motivo: ' || v_motivo end);
  end if;
  if p_accion = 'aprobar' and v.solicitado_por is not null
     and v.solicitado_por is distinct from auth.uid()
     and v.solicitado_por is distinct from v.minuta_enviada_por then
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    values (v.solicitado_por, 'contrato_aprobado', 'contrato', p_id, 'Contrato aprobado',
            'Contrato ' || v_numero_contrato || ' (solicitud N° ' || v.numero || '): minuta aprobada por Subgerencia. Ya se le pueden hacer actas.');
  end if;
end;
$$;
revoke all on function public.resolver_minuta_contrato(uuid, text, text) from public, anon;
grant execute on function public.resolver_minuta_contrato(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- actas: solo con minuta aprobada
create or replace function public.buscar_contratistas_para_acta(p_texto text)
returns table(contratista_id uuid, nombre text, documento text, contratos integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
begin
  if not public.tiene_pestana(auth.uid(), 'contratos.cortes') then
    raise exception 'No tienes permiso para ver actas.';
  end if;
  if v_texto is null then
    return;
  end if;

  return query
  select k.id, k.nombre,
         k.tipo_documento || ' ' || k.numero_documento || coalesce('-' || k.digito_verificacion, ''),
         count(*)::int
  from contratistas k
  join contratos c on c.contratista_id = k.id
  where c.estado = 'aprobada' and c.minuta_estado = 'aprobada'
    and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
    and (v_texto = '_' or k.nombre ilike '%' || v_texto || '%' or k.numero_documento ilike '%' || v_texto || '%')
  group by k.id, k.nombre, k.tipo_documento, k.numero_documento, k.digito_verificacion
  order by k.nombre
  limit 50;
end;
$$;

create or replace function public.buscar_contratos_para_acta(p_texto text default null, p_contratista_id uuid default null)
returns table(contrato_id uuid, numero_contrato text, numero bigint, tipo text, objeto text, valor numeric,
              proyecto_codigo text, proyecto_nombre text, contratista_id uuid, contratista_nombre text,
              contratista_documento text, actas integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
begin
  if not public.tiene_pestana(auth.uid(), 'contratos.cortes') then
    raise exception 'No tienes permiso para ver actas.';
  end if;
  if p_contratista_id is null and v_texto is null then
    return;
  end if;

  return query
  select c.id, c.numero_contrato, c.numero, c.tipo, c.objeto, c.valor,
         p.codigo, p.nombre, k.id, k.nombre,
         k.tipo_documento || ' ' || k.numero_documento || coalesce('-' || k.digito_verificacion, ''),
         (select count(*)::int from actas a where a.contrato_id = c.id)
  from contratos c
  join contratistas k on k.id = c.contratista_id
  join proyectos p on p.id = c.proyecto_id
  where c.estado = 'aprobada' and c.minuta_estado = 'aprobada'
    and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
    and (p_contratista_id is null or c.contratista_id = p_contratista_id)
    and (
      v_texto is null or v_texto = '_'
      or c.numero_contrato ilike '%' || v_texto || '%'
      or c.objeto ilike '%' || v_texto || '%'
      or k.nombre ilike '%' || v_texto || '%'
      or k.numero_documento ilike '%' || v_texto || '%'
    )
  order by c.numero desc
  limit 50;
end;
$$;

create or replace function public.crear_acta(p_contrato_id uuid, p_lineas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contrato record;
  v_acta uuid;
  v_numero integer;
  v_disponible numeric;
  v_total numeric;
begin
  if not public.tiene_accion(auth.uid(), 'elaborar_actas') then
    raise exception 'No tienes permiso para elaborar actas.';
  end if;

  -- Bloquea el contrato: dos actas a la vez no sacan el mismo número ni se
  -- pasan juntas del cupo.
  select c.id, c.estado, c.minuta_estado, c.proyecto_id, c.valor into v_contrato
    from contratos c where c.id = p_contrato_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v_contrato.proyecto_id) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  if v_contrato.estado <> 'aprobada' or v_contrato.minuta_estado is distinct from 'aprobada' then
    raise exception 'Solo se hacen actas de contratos con la minuta aprobada por Subgerencia.';
  end if;

  v_disponible := v_contrato.valor - public._consumido_actas_contrato(p_contrato_id);

  select coalesce(max(a.numero), 0) + 1 into v_numero from actas a where a.contrato_id = p_contrato_id;
  insert into actas (contrato_id, numero, total, creado_por)
  values (p_contrato_id, v_numero, 0, auth.uid())
  returning id into v_acta;

  v_total := public._llenar_acta(v_acta, v_contrato.proyecto_id, p_lineas);
  if v_total > v_disponible then
    raise exception 'El acta suma % y el saldo del contrato es %. Las actas no pueden superar el valor del contrato.',
      public._pesos_texto(v_total), public._pesos_texto(greatest(v_disponible, 0));
  end if;

  update actas set total = v_total where id = v_acta;
  return jsonb_build_object('id', v_acta, 'numero', v_numero);
end;
$$;

create or replace function public.editar_acta(p_acta_id uuid, p_lineas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contrato_id uuid;
  v_contrato record;
  v_acta record;
  v_disponible numeric;
  v_total numeric;
begin
  if not public.tiene_accion(auth.uid(), 'elaborar_actas') then
    raise exception 'No tienes permiso para elaborar actas.';
  end if;

  -- Mismo orden de bloqueo que crear_acta: primero el contrato, luego el acta.
  select a.contrato_id into v_contrato_id from actas a where a.id = p_acta_id;
  if v_contrato_id is null then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;
  select c.id, c.estado, c.minuta_estado, c.proyecto_id, c.valor into v_contrato
    from contratos c where c.id = v_contrato_id for update;
  if not public.usuario_puede_ver_proyecto(auth.uid(), v_contrato.proyecto_id) then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;
  select a.id, a.numero, a.estado, a.creado_por into v_acta from actas a where a.id = p_acta_id for update;
  if v_acta.creado_por is distinct from auth.uid() then
    raise exception 'Solo quien hizo el acta % puede editarla.', v_acta.numero;
  end if;
  if v_acta.estado = 'aprobada' then
    raise exception 'El acta % ya está aprobada y no se puede editar (actualiza la página).', v_acta.numero;
  end if;
  if v_contrato.estado <> 'aprobada' or v_contrato.minuta_estado is distinct from 'aprobada' then
    raise exception 'Solo se hacen actas de contratos con la minuta aprobada por Subgerencia.';
  end if;

  -- Cupo sin contar esta acta (si estaba por aprobar, ya estaba sumada).
  v_disponible := v_contrato.valor - public._consumido_actas_contrato(v_contrato.id)
                  + (select case when a.estado = 'pendiente' then a.total else 0 end from actas a where a.id = p_acta_id);

  delete from acta_lineas where acta_id = p_acta_id;
  v_total := public._llenar_acta(p_acta_id, v_contrato.proyecto_id, p_lineas);
  if v_total > v_disponible then
    raise exception 'El acta suma % y el saldo del contrato es %. Las actas no pueden superar el valor del contrato.',
      public._pesos_texto(v_total), public._pesos_texto(greatest(v_disponible, 0));
  end if;

  update actas
     set total = v_total, estado = 'pendiente',
         resuelto_por = null, resuelto_at = null, motivo_resolucion = null,
         editada_at = now(), editada_por = auth.uid()
   where id = p_acta_id;
  return jsonb_build_object('id', p_acta_id, 'numero', v_acta.numero);
end;
$$;
