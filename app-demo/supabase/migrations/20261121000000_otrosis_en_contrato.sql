-- ---------------------------------------------------------------------------
-- Rastro del otrosí en el contrato (2026-10-20, pedido del usuario): quien
-- busca un contrato tiene que ver que tiene otrosí y poder abrirlo.
--   * _puede_ver_otrosis: además de las pestañas de otrosí, las que ya dejan
--     ver contratos (por grupos, generales, pre-aprobación, aprobación, actas,
--     control del proyecto). Solo lectura: crear, editar y resolver siguen
--     exigiendo sus acciones.
--   * otrosis_de_contrato(contrato): los otrosí de un contrato con su estado.
--   * otrosis_aprobados(contratos): columna calculada para las listas
--     (`select ..., otrosis_aprobados`).
-- ---------------------------------------------------------------------------

create or replace function public._puede_ver_otrosis(p_uid uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select public.tiene_pestana(p_uid, 'contratos.solicitar_otrosi')
      or public.tiene_pestana(p_uid, 'contratos.aprobar_otrosi')
      or public.tiene_pestana(p_uid, 'contratos.solicitar')
      or public.tiene_pestana(p_uid, 'contratos.contratos')
      or public.tiene_pestana(p_uid, 'contratos.preaprobacion')
      or public.tiene_pestana(p_uid, 'contratos.aprobar_minutas')
      or public.tiene_pestana(p_uid, 'contratos.cortes')
      or public.tiene_pestana(p_uid, 'contratos.aprobar_actas')
      or public.tiene_pestana(p_uid, 'admin.visualizacion')
$$;
revoke all on function public._puede_ver_otrosis(uuid) from public, anon, authenticated;

create or replace function public.otrosis_de_contrato(p_contrato_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public._puede_ver_otrosis(v_uid)
     or not exists (select 1 from contratos c
                     where c.id = p_contrato_id and c.proyecto_id in (select public.proyectos_visibles(v_uid))) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', o.id, 'numero', o.numero, 'estado', o.estado,
             'clausulas', (select string_agg(e->>'clausula', ' · ') from jsonb_array_elements(o.modificaciones) e),
             'solicitado_por_nombre', sp.nombre, 'created_at', o.created_at, 'aprobado_at', o.aprobado_at
           ) order by o.numero nulls last, o.created_at)
      from otrosis o
      left join perfiles sp on sp.id = o.solicitado_por
     where o.contrato_id = p_contrato_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.otrosis_de_contrato(uuid) from public, anon;
grant execute on function public.otrosis_de_contrato(uuid) to authenticated;

-- Columna calculada de PostgREST: solo la ve quien ya puede leer la fila del
-- contrato (RLS de contratos); cuenta por el índice idx_otrosis_contrato.
create or replace function public.otrosis_aprobados(c public.contratos)
returns integer
language sql
stable security definer
set search_path = public
as $$
  select count(*)::integer from otrosis o where o.contrato_id = c.id and o.estado = 'aprobada'
$$;
revoke all on function public.otrosis_aprobados(public.contratos) from public, anon;
grant execute on function public.otrosis_aprobados(public.contratos) to authenticated;
