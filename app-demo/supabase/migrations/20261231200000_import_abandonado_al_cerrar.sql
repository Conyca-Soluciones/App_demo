-- Import de presupuesto abandonado: se descarta apenas se vuelve a abrir.
--
-- Antes, si alguien cerraba o recargaba la pestaña a mitad del import, al
-- volver había que esperar hasta 2 minutos (el plazo sin latido de
-- descartar_import_abandonado) y mientras tanto se veía la versión a medias
-- con sus avisos. Ahora la página, al cerrarse con un import corriendo, avisa
-- (POST /presupuestos/import-abandonado, keepalive) y esta función deja el
-- latido vencido: el siguiente descartar_import_abandonado lo borra de una.
-- Si el aviso no llega (sin red, navegador cerrado de golpe) sigue el plazo
-- de 2 minutos de siempre.
-- Se puede correr más de una vez.

create or replace function public.abandonar_import_presupuesto(p_presupuesto_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_proyecto uuid;
  v_version uuid;
begin
  select proyecto_id, version_actual_id into v_proyecto, v_version
    from presupuestos where id = p_presupuesto_id;
  if v_version is null then
    return;
  end if;
  if not public.usuario_puede_editar_proyecto(auth.uid(), v_proyecto) then
    raise exception 'No tienes permiso para editar este presupuesto.';
  end if;
  update presupuesto_versiones
     set import_latido_at = now() - interval '1 day'
   where id = v_version
     and import_latido_at is not null;
end;
$$;

revoke all on function public.abandonar_import_presupuesto(uuid) from public, anon;
grant execute on function public.abandonar_import_presupuesto(uuid) to authenticated;
