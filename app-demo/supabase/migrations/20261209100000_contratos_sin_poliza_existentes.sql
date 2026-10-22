-- ---------------------------------------------------------------------------
-- Contratos ya aprobados que, con la regla nueva de pólizas (20261208000000),
-- no la requieren (decisión del usuario, 2026-10-22): CJ-10-2026 (alquiler de
-- vehículo, póliza pendiente) y CJ-1-2026 (arrendamiento, póliza recibida en
-- revisión de Jurídica). Pasan a "Sin póliza (no aplica)": se les pueden hacer
-- actas. La póliza subida del CJ-1 que estaba por revisar se cierra como
-- devuelta con el motivo, para que salga de Aprobación de pólizas (el archivo
-- queda). Va después de 20261208000000. Se puede correr dos veces.
-- ---------------------------------------------------------------------------

update public.contrato_polizas p
   set estado = 'devuelta',
       motivo = 'El contrato no requiere póliza (decisión del 22/10/2026).',
       resuelta_at = now()
  from public.contratos c
 where c.id = p.contrato_id
   and c.numero_contrato in ('CJ-10-2026', 'CJ-1-2026')
   and c.tipo not in ('obra', 'mano_obra')
   and p.estado = 'por_revisar';

update public.contratos
   set requiere_poliza = false,
       poliza_estado = 'no_aplica'
 where numero_contrato in ('CJ-10-2026', 'CJ-1-2026')
   and tipo not in ('obra', 'mano_obra')
   and poliza_estado in ('pendiente', 'recibida');

insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
select 'contrato', c.id, 'poliza_no_aplica', null,
       'El contrato no requiere póliza (decisión del 22/10/2026).', '{}'::jsonb
  from public.contratos c
 where c.numero_contrato in ('CJ-10-2026', 'CJ-1-2026')
   and c.poliza_estado = 'no_aplica'
   and not exists (select 1 from public.historial_eventos h
                    where h.entidad_tipo = 'contrato' and h.entidad_id = c.id and h.evento = 'poliza_no_aplica');
