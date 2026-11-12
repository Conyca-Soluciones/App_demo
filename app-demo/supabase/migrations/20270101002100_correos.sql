-- Correos de 360 (2026-11-12): las notificaciones de la campanita también
-- salen por correo, desde notificaciones@conycasoluciones.com (alias de
-- Google Workspace, API de Gmail con cuenta de servicio; la llave vive en los
-- secretos de la función de Supabase "enviar-correos", nunca en el código).
--
-- 1. perfiles.correo_avisos: 'inmediato' o 'nunca' (por omisión 'nunca': se
--    activa por persona; el resumen diario va después).
-- 2. Cola correos_salientes: un disparador sobre notificaciones encola el
--    correo de quien tenga 'inmediato'. Nada de esto frena la acción que creó
--    el aviso: si encolar falla, el aviso igual se crea.
-- 3. La función de Supabase toma la cola (tomar_correos), envía y marca
--    (marcar_correo); reintenta hasta 5 veces. pg_cron la llama cada minuto
--    con pg_net, solo si hay pendientes.
-- 4. ajustes_correo: la dirección de la app (para "Abrir en 360") y de la
--    función, y un interruptor general (activo).
-- 5. encolar_correo_prueba(correo): para probar desde el editor SQL.
--
-- Solo agrega. Reversa en supabase/reversa/20270101002100_correos.sql.

begin;

create extension if not exists pg_net;

-- 1. Preferencia ------------------------------------------------------------------
alter table public.perfiles add column if not exists correo_avisos text not null default 'nunca';
alter table public.perfiles drop constraint if exists perfiles_correo_avisos_check;
alter table public.perfiles add constraint perfiles_correo_avisos_check check (correo_avisos in ('inmediato', 'nunca'));

-- 4. Ajustes ----------------------------------------------------------------------
create table if not exists public.ajustes_correo (
  id boolean primary key default true check (id),
  activo boolean not null default true,
  url_app text,           -- p. ej. https://app.conycasoluciones.com (sin / al final)
  url_funcion text        -- https://<proyecto>.supabase.co/functions/v1/enviar-correos
);
insert into public.ajustes_correo (id, url_funcion)
values (true, 'https://xqtkhtnqombzfykyxngt.supabase.co/functions/v1/enviar-correos')
on conflict (id) do nothing;
alter table public.ajustes_correo enable row level security;
revoke all on public.ajustes_correo from anon, authenticated;

-- 2. Cola -------------------------------------------------------------------------
create table if not exists public.correos_salientes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.perfiles(id) on delete cascade,
  para text not null,
  asunto text not null,
  titulo text not null,
  mensaje text not null,
  enlace text,
  notificacion_id uuid,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'enviado', 'error')),
  intentos integer not null default 0,
  ultimo_error text,
  creado_en timestamptz not null default now(),
  tomado_en timestamptz,
  enviado_en timestamptz
);
create index if not exists correos_salientes_por_enviar on public.correos_salientes (creado_en)
  where estado in ('pendiente', 'enviando', 'error');
alter table public.correos_salientes enable row level security;
revoke all on public.correos_salientes from anon, authenticated;

create or replace function public._encolar_correo_notificacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_correo text;
  v_ajustes record;
begin
  begin
    select a.activo, a.url_app into v_ajustes from public.ajustes_correo a where a.id;
    if not coalesce(v_ajustes.activo, false) then
      return null;
    end if;
    select u.email into v_correo
      from public.perfiles p join auth.users u on u.id = p.id
     where p.id = new.usuario_id and p.correo_avisos = 'inmediato';
    if v_correo is null then
      return null;
    end if;
    insert into public.correos_salientes (usuario_id, para, asunto, titulo, mensaje, enlace, notificacion_id)
    values (new.usuario_id, v_correo, left('CONYCA 360 · ' || new.titulo, 200), new.titulo, new.mensaje,
            case when v_ajustes.url_app is not null then rtrim(v_ajustes.url_app, '/') || '/notificaciones/' || new.id end,
            new.id);
  exception when others then
    -- El correo nunca frena el aviso de la campanita.
    raise warning 'No se pudo encolar el correo de la notificación %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public._encolar_correo_notificacion() from public, anon, authenticated;

drop trigger if exists trg_correo_notificacion on public.notificaciones;
create trigger trg_correo_notificacion after insert on public.notificaciones
  for each row execute function public._encolar_correo_notificacion();

-- 3. La función de Supabase toma y marca (solo service_role) ------------------------
create or replace function public.tomar_correos(p_limite integer default 20)
returns setof public.correos_salientes
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Los que quedaron "enviando" más de 10 minutos (la función se cayó) vuelven a la cola.
  update public.correos_salientes set estado = 'error', ultimo_error = coalesce(ultimo_error, 'Sin respuesta del envío')
   where estado = 'enviando' and tomado_en < now() - interval '10 minutes';
  return query
    update public.correos_salientes c
       set estado = 'enviando', tomado_en = now(), intentos = c.intentos + 1
     where c.id in (
       select x.id from public.correos_salientes x
        where x.estado = 'pendiente'
           or (x.estado = 'error' and x.intentos < 5 and x.tomado_en < now() - (x.intentos * interval '5 minutes'))
        order by x.creado_en
        limit least(greatest(coalesce(p_limite, 20), 1), 50)
        for update skip locked)
    returning c.*;
end;
$$;

create or replace function public.marcar_correo(p_id uuid, p_ok boolean, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.correos_salientes
     set estado = case when p_ok then 'enviado' else 'error' end,
         enviado_en = case when p_ok then now() end,
         ultimo_error = case when p_ok then null else left(p_error, 1000) end
   where id = p_id;
$$;

revoke all on function public.tomar_correos(integer) from public, anon, authenticated;
revoke all on function public.marcar_correo(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.tomar_correos(integer) to service_role;
grant execute on function public.marcar_correo(uuid, boolean, text) to service_role;

-- pg_cron: cada minuto, solo si hay algo por enviar.
select cron.schedule('enviar-correos', '* * * * *', $cron$
  select net.http_post(
           url := a.url_funcion,
           headers := '{"Content-Type": "application/json"}'::jsonb,
           body := '{}'::jsonb,
           timeout_milliseconds := 30000)
    from public.ajustes_correo a
   where a.id and a.activo and a.url_funcion is not null
     and exists (select 1 from public.correos_salientes c
                  where c.estado = 'pendiente'
                     or (c.estado = 'error' and c.intentos < 5));
$cron$);

-- 5. Prueba desde el editor SQL ---------------------------------------------------
create or replace function public.encolar_correo_prueba(p_correo text)
returns uuid
language sql
security definer
set search_path = public
as $$
  insert into public.correos_salientes (para, asunto, titulo, mensaje, enlace)
  values (p_correo, 'CONYCA 360 · Correo de prueba', 'Correo de prueba',
          'Si ves este correo, 360 ya puede enviar notificaciones por correo.',
          (select rtrim(url_app, '/') || '/pendientes' from public.ajustes_correo where id))
  returning id;
$$;
revoke all on function public.encolar_correo_prueba(text) from public, anon, authenticated;

commit;
