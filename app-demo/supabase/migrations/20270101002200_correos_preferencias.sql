-- Correos de 360 desde la app (2026-11-12): sin tocar SQL a mano.
--   - Admin › Usuarios y accesos: casilla "Correos" por persona y el
--     interruptor general "Envío de correos de 360" (ajustes_correo.activo).
--   - Cada usuario, en su menú: "Recibir avisos por correo".
-- Solo agrega funciones. Reversa: borrar estas cuatro funciones.

begin;

-- Admin: el interruptor general y la preferencia de cada persona.
create or replace function public.estado_correos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.es_admin(auth.uid()) then
    raise exception 'No autorizado -- solo el Administrador.';
  end if;
  return jsonb_build_object(
    'activo', coalesce((select a.activo from public.ajustes_correo a where a.id), false),
    'usuarios', coalesce((select jsonb_object_agg(p.id, p.correo_avisos) from public.perfiles p), '{}'::jsonb));
end;
$$;

-- La propia preferencia, o la de otro si es Administrador.
create or replace function public.fijar_correo_avisos(p_usuario_id uuid, p_valor text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión.';
  end if;
  if p_usuario_id is distinct from auth.uid() and not public.es_admin(auth.uid()) then
    raise exception 'No autorizado -- solo el Administrador cambia los correos de otra persona.';
  end if;
  if p_valor not in ('inmediato', 'nunca') then
    raise exception 'Valor no válido.';
  end if;
  update public.perfiles set correo_avisos = p_valor where id = p_usuario_id;
  if not found then
    raise exception 'El usuario no existe.';
  end if;
end;
$$;

create or replace function public.mi_correo_avisos()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.correo_avisos from public.perfiles p where p.id = auth.uid()
$$;

create or replace function public.fijar_envio_correos(p_activo boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_admin(auth.uid()) then
    raise exception 'No autorizado -- solo el Administrador.';
  end if;
  update public.ajustes_correo set activo = coalesce(p_activo, false) where id;
end;
$$;

revoke all on function public.estado_correos() from public, anon;
revoke all on function public.fijar_correo_avisos(uuid, text) from public, anon;
revoke all on function public.mi_correo_avisos() from public, anon;
revoke all on function public.fijar_envio_correos(boolean) from public, anon;
grant execute on function public.estado_correos() to authenticated;
grant execute on function public.fijar_correo_avisos(uuid, text) to authenticated;
grant execute on function public.mi_correo_avisos() to authenticated;
grant execute on function public.fijar_envio_correos(boolean) to authenticated;

commit;
