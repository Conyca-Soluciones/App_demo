-- Notificaciones de solicitudes de contrato por revisar: solo a Legal y Líder
-- Legal (decisión del usuario). Antes iban a todo el que pudiera aprobar,
-- y los Administradores (que tienen todas las acciones) recibían una por cada
-- solicitud. Se mantiene que el rol tenga la acción aprobar_contratos y que la
-- persona vea el proyecto: avisar a quien no puede actuar no sirve.

create or replace function public._notificar_aprobadores_contrato(p_contrato_id uuid, p_titulo text, p_mensaje text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  select pf.id, 'contrato_por_revisar', 'contrato', c.id, p_titulo, p_mensaje
  from contratos c
  cross join perfiles pf
  join roles r on r.id = pf.rol_id
  where c.id = p_contrato_id
    and r.clave in ('legal', 'lider_legal')
    and pf.id is distinct from auth.uid()
    and public.tiene_accion(pf.id, 'aprobar_contratos')
    and public.usuario_puede_ver_proyecto(pf.id, c.proyecto_id)
$$;
revoke all on function public._notificar_aprobadores_contrato(uuid, text, text) from public, anon, authenticated;
