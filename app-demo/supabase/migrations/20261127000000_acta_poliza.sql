-- ---------------------------------------------------------------------------
-- Acta de aprobación de pólizas (plantilla GJ-F-013 versión 03, 23/06/2026;
-- 2026-10-21, pedido del usuario). Jurídica la llena al lado de la póliza en
-- Aprobación de pólizas: sale prellenada con lo que ya está en el sistema
-- (contrato, objeto, contratista, empresa, supervisor = director que pidió el
-- contrato y su correo, amparos de la minuta, fecha, quien aprueba) y cada
-- dato se puede editar. Se guarda en contrato_polizas.acta_datos; aprobar la
-- póliza exige el acta (la de pantalla o la guardada) y la deja fija.
-- Requiere 20261126000000_polizas.sql.
-- ---------------------------------------------------------------------------

alter table public.contrato_polizas add column if not exists acta_datos jsonb;
alter table public.contrato_polizas add column if not exists acta_actualizada_at timestamptz;
alter table public.contrato_polizas add column if not exists acta_actualizada_por uuid references public.perfiles(id);

-- Lo mínimo para aprobar: aseguradora y al menos un amparo con nombre.
create or replace function public._validar_acta_poliza(p_acta jsonb)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_acta is null or jsonb_typeof(p_acta) <> 'object' then
    raise exception 'Llena el acta de aprobación de la póliza antes de aprobarla.';
  end if;
  if length(p_acta::text) > 100000 then
    raise exception 'El acta es muy grande.';
  end if;
  if nullif(trim(coalesce(p_acta->>'aseguradora', '')), '') is null then
    raise exception 'Escribe en el acta la aseguradora que expidió la póliza.';
  end if;
  if jsonb_typeof(p_acta->'amparos') is distinct from 'array'
     or not exists (select 1 from jsonb_array_elements(p_acta->'amparos') e
                     where nullif(trim(coalesce(e->>'amparo', '')), '') is not null) then
    raise exception 'Escribe en el acta al menos un amparo de la póliza.';
  end if;
end;
$$;

-- Todo lo que el acta necesita para llenarse sola.
create or replace function public.datos_acta_poliza(p_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_res jsonb;
begin
  if not public._puede_ver_polizas(v_uid) then
    raise exception 'No tienes permiso para ver pólizas.';
  end if;
  select public._fila_poliza(o.id) || jsonb_build_object(
           'contrato', public._fila_contrato_poliza(o.contrato_id),
           'empresa_nombre', e.razon_social, 'empresa_nit', e.nit,
           'director_nombre', sp.nombre, 'director_correo', u.email::text,
           'contrato_minuta', c.minuta_datos,
           'acta_datos', o.acta_datos, 'acta_actualizada_at', o.acta_actualizada_at,
           'acta_actualizada_por_nombre', ap.nombre,
           'usuario_nombre', (select nombre from perfiles where id = v_uid))
    into v_res
    from contrato_polizas o
    join contratos c on c.id = o.contrato_id
    join proyectos p on p.id = c.proyecto_id
    left join empresas e on e.id = p.empresa_id
    left join perfiles sp on sp.id = c.solicitado_por
    left join auth.users u on u.id = c.solicitado_por
    left join perfiles ap on ap.id = o.acta_actualizada_por
   where o.id = p_id
     and o.proyecto_id in (select public.proyectos_visibles(v_uid));
  if v_res is null then
    raise exception 'La póliza no existe o no tienes acceso.';
  end if;
  return v_res;
end;
$$;
revoke all on function public.datos_acta_poliza(uuid) from public, anon;
grant execute on function public.datos_acta_poliza(uuid) to authenticated;

-- Guardar el acta mientras la póliza está por revisar (Jurídica).
create or replace function public.guardar_acta_poliza(p_id uuid, p_acta jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  o record;
begin
  if not (public.tiene_pestana(v_uid, 'contratos.aprobar_polizas') and public.tiene_accion(v_uid, 'aprobar_contratos')) then
    raise exception 'No tienes permiso para llenar el acta de la póliza.';
  end if;
  if p_acta is null or jsonb_typeof(p_acta) <> 'object' or length(p_acta::text) > 100000 then
    raise exception 'El acta no es válida.';
  end if;
  select id, estado, proyecto_id into o from contrato_polizas where id = p_id for update;
  if not found or not public.usuario_puede_ver_proyecto(v_uid, o.proyecto_id) then
    raise exception 'La póliza no existe o no tienes acceso.';
  end if;
  if o.estado <> 'por_revisar' then
    raise exception 'Esta póliza ya se revisó: su acta no se puede cambiar (actualiza la página).';
  end if;
  update contrato_polizas set acta_datos = p_acta, acta_actualizada_at = now(), acta_actualizada_por = v_uid where id = p_id;
  return now();
end;
$$;
revoke all on function public.guardar_acta_poliza(uuid, jsonb) from public, anon;
grant execute on function public.guardar_acta_poliza(uuid, jsonb) to authenticated;

-- Resolver con el acta (parámetro nuevo al final).
drop function if exists public.resolver_poliza(uuid, text, text);
create or replace function public.resolver_poliza(p_id uuid, p_accion text, p_motivo text default null, p_acta jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  o record;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_contrato text;
  v_acta jsonb;
begin
  if not (public.tiene_pestana(v_uid, 'contratos.aprobar_polizas') and public.tiene_accion(v_uid, 'aprobar_contratos')) then
    raise exception 'No tienes permiso para aprobar pólizas.';
  end if;
  if p_accion not in ('aprobar', 'devolver') then
    raise exception 'Acción no válida.';
  end if;
  if p_accion = 'devolver' and v_motivo is null then
    raise exception 'Escribe el motivo de la devolución.';
  end if;
  if length(coalesce(v_motivo, '')) > 2000 then
    raise exception 'El motivo es muy largo (máximo 2.000 caracteres).';
  end if;

  select x.*, c.numero_contrato, c.numero as contrato_numero, c.solicitado_por into o
    from contrato_polizas x join contratos c on c.id = x.contrato_id
   where x.id = p_id
   for update of x, c;
  if not found or not public.usuario_puede_ver_proyecto(v_uid, o.proyecto_id) then
    raise exception 'La póliza no existe o no tienes acceso.';
  end if;
  if o.estado <> 'por_revisar' then
    raise exception 'Esta póliza ya se revisó (actualiza la página).';
  end if;
  v_contrato := coalesce(o.numero_contrato, 'N° ' || o.contrato_numero);

  -- Aprobar exige el acta de aprobación (la de pantalla o la guardada).
  if p_accion = 'aprobar' then
    v_acta := coalesce(p_acta, o.acta_datos);
    perform public._validar_acta_poliza(v_acta);
  end if;

  update contrato_polizas
     set estado = case when p_accion = 'aprobar' then 'aprobada' else 'devuelta' end,
         motivo = v_motivo, resuelta_por = v_uid, resuelta_at = now(),
         acta_datos = case when p_accion = 'aprobar' then v_acta else acta_datos end,
         acta_actualizada_at = case when p_accion = 'aprobar' then now() else acta_actualizada_at end,
         acta_actualizada_por = case when p_accion = 'aprobar' then v_uid else acta_actualizada_por end
   where id = p_id;
  update contratos
     set poliza_estado = case when p_accion = 'aprobar' then 'aprobada' else 'pendiente' end
   where id = o.contrato_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
  values ('contrato', o.contrato_id, case when p_accion = 'aprobar' then 'poliza_aprobada' else 'poliza_devuelta' end,
          v_uid, v_motivo, jsonb_build_object('poliza_id', p_id, 'archivo', o.nombre_archivo));

  insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  select distinct u, case when p_accion = 'aprobar' then 'poliza_aprobada' else 'poliza_devuelta' end,
         'contrato', o.contrato_id,
         case when p_accion = 'aprobar' then 'Póliza aprobada' else 'Póliza devuelta' end,
         case when p_accion = 'aprobar'
              then 'La póliza del contrato ' || v_contrato || ' fue aprobada: ya se pueden hacer actas.'
              else 'La póliza del contrato ' || v_contrato || ' fue devuelta: súbela otra vez. Motivo: ' || v_motivo end
    from unnest(array[o.subida_por, o.solicitado_por]) u
   where u is not null and u is distinct from v_uid;
end;
$$;
revoke all on function public.resolver_poliza(uuid, text, text, jsonb) from public, anon;
grant execute on function public.resolver_poliza(uuid, text, text, jsonb) to authenticated;
