-- Pólizas sin acta en PDF ni firma (decisión del usuario, 2026-11-12).
--
-- Antes Jurídica llenaba el acta GJ-F-013 y se generaba un PDF firmado: servía
-- solo para avisar que la póliza estaba aprobada. Ahora eso lo hace la app.
-- Jurídica sigue llenando los mismos datos (aseguradora, amparos, certificado
-- de pago...) en contrato_polizas.acta_datos y aprueba, pero ya no se firma ni
-- se genera el documento. resolver_poliza no cambia (sigue exigiendo
-- aseguradora y al menos un amparo).
--
-- 1. Se quita el disparador que copiaba la firma de Jurídica al aprobar (la
--    exigía: sin firma registrada no dejaba aprobar).
-- 2. reemplazar_poliza: el ingeniero cambia el archivo mientras la póliza está
--    por revisar (antes solo podía subir otra si Jurídica la devolvía).
--
-- Se puede correr más de una vez.

drop trigger if exists trg_firmar_poliza_aprobada on public.contrato_polizas;

-- Devuelve la ruta del archivo anterior para que la app lo borre (la política
-- del bucket solo deja borrar archivos que ya no son póliza de nadie).
create or replace function public.reemplazar_poliza(
  p_poliza_id uuid, p_ruta text, p_nombre_archivo text, p_tamano bigint, p_mime text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  o record;
begin
  if not public.tiene_pestana(v_uid, 'contratos.polizas') then
    raise exception 'No tienes permiso para subir pólizas.';
  end if;
  select x.id, x.contrato_id, x.proyecto_id, x.estado, x.ruta, x.nombre_archivo
    into o from contrato_polizas x where x.id = p_poliza_id for update;
  if not found or not public.usuario_puede_ver_proyecto(v_uid, o.proyecto_id) then
    raise exception 'La póliza no existe o no tienes acceso.';
  end if;
  if o.estado <> 'por_revisar' then
    raise exception 'Esta póliza ya la revisó Jurídica: no se puede cambiar (actualiza la página).';
  end if;
  if p_ruta is null or split_part(p_ruta, '/', 1) <> o.contrato_id::text then
    raise exception 'El archivo no es de este contrato.';
  end if;
  if p_mime is null or p_mime not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'La póliza tiene que ser PDF, JPG o PNG.';
  end if;
  if p_tamano is null or p_tamano <= 0 or p_tamano > 10485760 then
    raise exception 'El archivo no puede pasar de 10 MB.';
  end if;
  if nullif(trim(coalesce(p_nombre_archivo, '')), '') is null or length(p_nombre_archivo) > 300 then
    raise exception 'El nombre del archivo no es válido.';
  end if;
  if not exists (select 1 from storage.objects s where s.bucket_id = 'polizas' and s.name = p_ruta) then
    raise exception 'No se encontró el archivo de la póliza. Vuelve a adjuntarlo.';
  end if;

  update contrato_polizas
     set ruta = p_ruta, nombre_archivo = trim(p_nombre_archivo), tamano = p_tamano, mime = p_mime,
         subida_por = v_uid, created_at = now()
   where id = p_poliza_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('contrato', o.contrato_id, 'poliza_reemplazada', v_uid,
          jsonb_build_object('poliza_id', p_poliza_id, 'archivo', trim(p_nombre_archivo), 'anterior', o.nombre_archivo));
  return o.ruta;
end;
$$;
revoke all on function public.reemplazar_poliza(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.reemplazar_poliza(uuid, text, text, bigint, text) to authenticated;
