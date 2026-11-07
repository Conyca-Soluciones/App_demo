-- =============================================================================
-- Firmas que faltaban y fin vigente del contrato (pruebas 2026-11-06).
--
-- 1. Las actas y las OC se aprueban aunque quien firma no haya registrado "Mi
--    firma" (para no trabar pagos): queda su nombre sin la imagen. Decisión del
--    usuario: cuando esa persona registre su firma, se pone en los documentos
--    que firmó sin imagen y el PDF se vuelve a congelar (todas las firmas del
--    documento reciben código nuevo: el PDF congelado se guarda por el código de
--    la firma principal, así que el siguiente que lo abra lo congela otra vez y
--    la huella vieja deja de verificar). Las pólizas, contratos y otrosí no
--    entran: esos exigen la firma al aprobar.
-- 2. fecha_fin_vigente(contratos): columna calculada con la fecha fin que vale
--    (la de la última prórroga aprobada por otrosí). La usa el detalle del
--    contrato en pantalla para el aviso de vencido; antes miraba solo la fecha
--    inicial y un contrato prorrogado salía vencido.
-- =============================================================================

create or replace function public._completar_firmas_pendientes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc record;
begin
  if new.imagen is null then
    return null;
  end if;
  for v_doc in
    select distinct f.entidad, f.entidad_id
      from documento_firmas f
     where f.perfil_id = new.perfil_id
       and f.imagen is null
       and f.entidad in ('acta', 'orden_compra')
  loop
    update documento_firmas
       set imagen = new.imagen
     where entidad = v_doc.entidad and entidad_id = v_doc.entidad_id
       and perfil_id = new.perfil_id and imagen is null;
    update documento_firmas
       set codigo = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
     where entidad = v_doc.entidad and entidad_id = v_doc.entidad_id;
  end loop;
  return null;
end;
$$;

revoke all on function public._completar_firmas_pendientes() from public, anon, authenticated;

drop trigger if exists trg_completar_firmas_pendientes on public.firmas_usuario;
create trigger trg_completar_firmas_pendientes
  after insert or update of imagen on public.firmas_usuario
  for each row execute function public._completar_firmas_pendientes();

create or replace function public.fecha_fin_vigente(c public.contratos)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select public._fecha_fin_contrato(c.id)
$$;

revoke all on function public.fecha_fin_vigente(public.contratos) from public, anon;
grant execute on function public.fecha_fin_vigente(public.contratos) to authenticated;
