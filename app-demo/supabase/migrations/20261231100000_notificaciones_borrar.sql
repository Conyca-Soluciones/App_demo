-- Campanita (decisión del usuario, 2026-11-05): las no leídas arriba y las
-- leídas al final; cada quien puede borrar SUS notificaciones (una, o todas
-- las leídas). Antes no había política de borrado (nadie podía borrar).
-- Se puede correr dos veces. Va después de 20261231000000.

drop policy if exists notificaciones_delete_propias on public.notificaciones;
create policy notificaciones_delete_propias on public.notificaciones
  for delete to authenticated
  using (usuario_id = (select auth.uid()));

-- Orden de la campanita: no leídas primero, cada grupo de la más nueva a la más vieja.
create index if not exists idx_notificaciones_usuario_leida_fecha
  on public.notificaciones (usuario_id, leida, created_at desc);
