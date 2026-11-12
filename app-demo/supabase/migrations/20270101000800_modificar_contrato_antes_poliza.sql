-- Modificar un contrato antes de que se apruebe su póliza (decisión del
-- usuario, 2026-11-12). Se modifica la solicitud o la minuta, y vuelve a
-- aprobarse:
--
-- * Solicitud (quien la pidió, acción solicitar_contratos):
--   reabrir_solicitud_contrato(id, motivo) la deja DEVUELTA (el mismo "Corregir
--   y reenviar" de siempre) -> Pre-aprobación (Jurídica) -> Subgerencia.
-- * Minuta (Jurídica, acción aprobar_contratos): reabrir_minuta_contrato(id,
--   motivo) la deja DEVUELTA a Jurídica (se edita y "Enviar otra vez a
--   Subgerencia").
--
-- Se puede mientras: la solicitud esté por revisar o pre-aprobada, la póliza
-- NO esté aprobada, el contrato no esté liquidado y no tenga actas ni otrosí
-- (que no estén rechazados). Un contrato sin póliza ("no aplica") se puede
-- hasta que tenga su primera acta.
--
-- Al reabrir: se conserva el número CJ y lo que Jurídica escribió en la minuta;
-- se borra la aprobación de la minuta y la firma del representante (se vuelve a
-- firmar al aprobar; el PDF congelado se rehace porque cambia el código de la
-- firma); la póliza vuelve a calcularse al aprobar (una por revisar queda
-- devuelta con el motivo).
--
-- Se puede correr más de una vez.

-- null = se puede modificar; si no, el motivo.
create or replace function public._motivo_contrato_no_modificable(p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
begin
  select k.estado, k.poliza_estado, k.liquidado_at into c from contratos k where k.id = p_id;
  if not found then
    return 'El contrato no existe.';
  end if;
  if c.estado not in ('pre_aprobacion', 'aprobada') then
    return 'Solo se modifica un contrato por revisar o pre-aprobado.';
  end if;
  if c.liquidado_at is not null then
    return 'El contrato ya está liquidado.';
  end if;
  if c.poliza_estado = 'aprobada' then
    return 'La póliza del contrato ya está aprobada: el cambio se hace con un otrosí.';
  end if;
  if exists (select 1 from actas a where a.contrato_id = p_id and a.estado <> 'rechazada') then
    return 'El contrato ya tiene actas: el cambio se hace con un otrosí.';
  end if;
  if exists (select 1 from otrosis o where o.contrato_id = p_id and o.estado <> 'rechazada') then
    return 'El contrato ya tiene otrosí.';
  end if;
  return null;
end;
$$;
revoke all on function public._motivo_contrato_no_modificable(uuid) from public, anon, authenticated;

-- Para la pantalla (decide si muestra los botones). Misma regla.
create or replace function public.contrato_modificable(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_proyecto uuid;
  v_solicitante uuid;
  v_motivo text;
begin
  select proyecto_id, solicitado_por into v_proyecto, v_solicitante from contratos where id = p_id;
  if v_proyecto is null or not public.usuario_puede_ver_proyecto(auth.uid(), v_proyecto) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  v_motivo := public._motivo_contrato_no_modificable(p_id);
  return jsonb_build_object('modificable', v_motivo is null, 'motivo', v_motivo,
                            'es_solicitante', v_solicitante is not distinct from auth.uid());
end;
$$;
revoke all on function public.contrato_modificable(uuid) from public, anon;
grant execute on function public.contrato_modificable(uuid) to authenticated;

-- Lo común a las dos: quita la aprobación de la minuta, la firma y la póliza.
create or replace function public._reabrir_aprobaciones_contrato(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update contrato_polizas
     set estado = 'devuelta', motivo = 'El contrato se modificó: ' || p_motivo,
         resuelta_por = auth.uid(), resuelta_at = now()
   where contrato_id = p_id and estado = 'por_revisar';
  delete from documento_firmas where entidad = 'contrato' and entidad_id = p_id;
  update contratos
     set poliza_estado = null,
         minuta_resuelta_at = null,
         minuta_resuelta_por = null
   where id = p_id;
end;
$$;
revoke all on function public._reabrir_aprobaciones_contrato(uuid, text) from public, anon, authenticated;

create or replace function public.reabrir_solicitud_contrato(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_razon text;
begin
  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para modificar solicitudes de contrato.';
  end if;
  select k.id, k.proyecto_id, k.solicitado_por, coalesce(k.numero_contrato, k.codigo) as numero
    into c from contratos k where k.id = p_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  if c.solicitado_por is distinct from auth.uid() then
    raise exception 'Solo quien pidió el contrato puede modificar la solicitud.';
  end if;
  if v_motivo is null then
    raise exception 'Escribe qué vas a modificar.';
  end if;
  v_razon := public._motivo_contrato_no_modificable(p_id);
  if v_razon is not null then
    raise exception '%', v_razon;
  end if;

  perform public._reabrir_aprobaciones_contrato(p_id, v_motivo);
  update contratos
     set estado = 'devuelta',
         motivo_resolucion = 'Modificación pedida por quien lo solicitó: ' || v_motivo,
         resuelto_por = auth.uid(), resuelto_at = now(),
         minuta_estado = null, minuta_enviada_at = null, minuta_enviada_por = null, minuta_motivo = null
   where id = p_id;
  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo)
  values ('contrato', p_id, 'solicitud_reabierta', auth.uid(), v_motivo);
end;
$$;
revoke all on function public.reabrir_solicitud_contrato(uuid, text) from public, anon;
grant execute on function public.reabrir_solicitud_contrato(uuid, text) to authenticated;

create or replace function public.reabrir_minuta_contrato(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_razon text;
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_contratos') then
    raise exception 'No tienes permiso para modificar minutas.';
  end if;
  select k.id, k.proyecto_id, k.estado, k.minuta_estado into c from contratos k where k.id = p_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  if c.estado <> 'aprobada' or c.minuta_estado not in ('en_revision', 'aprobada') then
    raise exception 'La minuta no está en Subgerencia ni aprobada: ya se puede editar.';
  end if;
  if v_motivo is null then
    raise exception 'Escribe qué vas a modificar.';
  end if;
  v_razon := public._motivo_contrato_no_modificable(p_id);
  if v_razon is not null then
    raise exception '%', v_razon;
  end if;

  perform public._reabrir_aprobaciones_contrato(p_id, v_motivo);
  update contratos
     set minuta_estado = 'devuelta',
         minuta_motivo = 'Jurídica la reabrió para modificarla: ' || v_motivo
   where id = p_id;
  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo)
  values ('contrato', p_id, 'minuta_reabierta', auth.uid(), v_motivo);
end;
$$;
revoke all on function public.reabrir_minuta_contrato(uuid, text) from public, anon;
grant execute on function public.reabrir_minuta_contrato(uuid, text) to authenticated;
