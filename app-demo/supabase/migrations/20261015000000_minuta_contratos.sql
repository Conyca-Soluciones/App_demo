-- Minuta del contrato (Contratos › Pre-aprobación).
--
-- Jurídica completa en la app los campos de la plantilla de la minuta (hoy:
-- GJ-F-003, contrato de mano de obra) y descarga el PDF. Lo editado se guarda
-- como jsonb en contratos.minuta_datos (la estructura la define
-- lib/minuta-mano-obra.ts); null = todavía no se ha editado y la app la arma
-- con los datos de la solicitud.
-- Guardar exige la acción aprobar_contratos, ver el proyecto y que la
-- solicitud no esté rechazada.

alter table public.contratos
  add column if not exists minuta_datos jsonb,
  add column if not exists minuta_actualizada_at timestamptz,
  add column if not exists minuta_actualizada_por uuid references public.perfiles(id);
create index if not exists idx_contratos_minuta_actualizada_por on public.contratos (minuta_actualizada_por);

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

  select id, proyecto_id, estado into v_contrato from contratos where id = p_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v_contrato.proyecto_id) then
    raise exception 'La solicitud no existe o no tienes acceso.';
  end if;
  if v_contrato.estado = 'rechazada' then
    raise exception 'La solicitud fue rechazada: su minuta ya no se edita.';
  end if;

  update contratos
     set minuta_datos = p_datos,
         minuta_actualizada_at = now(),
         minuta_actualizada_por = auth.uid()
   where id = p_id;
end;
$$;
revoke all on function public.guardar_minuta_contrato(uuid, jsonb) from public, anon;
grant execute on function public.guardar_minuta_contrato(uuid, jsonb) to authenticated;
