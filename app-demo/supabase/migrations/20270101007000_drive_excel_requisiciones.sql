-- Drive: Excel semanal de requisiciones en vez de los anexos (decisiones del
-- usuario, 2026-11-25).
--
-- Sigue a 20270101006900.
-- - Los anexos de las requisiciones (bucket "requisiciones") ya NO se copian a
--   Drive: el disparador los salta. Lo que ya se copió se queda.
-- - Cada lunes a las 00:30 (Colombia), la función "subir-drive" arma UN Excel POR
--   PROYECTO con las requisiciones CREADAS la semana anterior (lunes a domingo,
--   hora de Colombia), una fila por insumo, con las columnas del Excel del Registro
--   de requisiciones más Anexos (cuántos y el enlace fijo de la app). Va en
--   Proyectos/<proyecto>/Requisiciones/<año> - Semana NN/Requisiciones <año> -
--   Semana NN.xlsx. Si se vuelve a generar la misma semana, reemplaza el archivo
--   (drive_informes guarda su id de Drive).
-- - requisiciones_semana_drive(lunes) entrega los datos (solo service_role).
-- Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

-- 1. Los anexos de requisiciones ya no entran a la cola --------------------------

create or replace function public._drive_encolar_objeto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.name is not distinct from old.name and new.version is not distinct from old.version then
    return null;
  end if;
  if new.name like '%.emptyFolderPlaceholder' or coalesce(new.is_delete_marker, false) then
    return null;
  end if;
  -- Requisiciones: va el Excel semanal, no cada anexo (20270101007000).
  if new.bucket_id = 'requisiciones' then
    return null;
  end if;
  begin
    insert into public.drive_cola (bucket, ruta) values (new.bucket_id, new.name)
    on conflict (bucket, ruta) do update
       set estado = 'pendiente', intentos = 0, siguiente_intento = now(), ultimo_error = null, creado_en = now()
     where public.drive_cola.estado <> 'subiendo';
  exception when others then
    null;  -- la copia a Drive nunca hace fallar una subida
  end;
  return null;
end;
$$;

-- Anexos que estaban esperando en la cola: ya no se suben.
update public.drive_cola
   set estado = 'omitido', ultimo_error = 'Requisiciones: va el Excel semanal, no los anexos.'
 where bucket = 'requisiciones' and estado in ('pendiente', 'error');

-- 2. Informes ya subidos (para reemplazar en vez de duplicar) ----------------------

create table if not exists public.drive_informes (
  clave text primary key,      -- 'requisiciones:<proyecto_id>:<lunes>'
  drive_file_id text not null,
  actualizado_en timestamptz not null default now()
);
alter table public.drive_informes enable row level security;
revoke all on public.drive_informes from anon, authenticated;
grant all on public.drive_informes to service_role;

-- 3. Datos del Excel de una semana -------------------------------------------------

-- Requisiciones creadas del lunes p_lunes al domingo siguiente (hora de Colombia),
-- agrupadas por proyecto: [{proyecto_id, destino, filas: [...]}]. La cantidad va en
-- la unidad de compra, como el Excel del Registro (cantidadEnCompra).
create or replace function public.requisiciones_semana_drive(p_lunes date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lunes date := p_lunes - (extract(isodow from p_lunes)::int - 1);  -- por si no llega un lunes
  v_semana text := to_char(v_lunes, 'IYYY') || ' - Semana ' || to_char(v_lunes, 'IW');
  v_url text := (select rtrim(a.url_app, '/') from public.ajustes_correo a where a.id);
begin
  return jsonb_build_object(
    'lunes', v_lunes,
    'semana', v_semana,
    'url_app', v_url,
    'proyectos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'proyecto_id', x.proyecto_id,
               'destino', public._drive_resultado(x.proyecto_id, array['Requisiciones', v_semana],
                                                  'Requisiciones ' || v_semana || '.xlsx'),
               'filas', x.filas))
        from (
          select r.proyecto_id,
                 jsonb_agg(jsonb_build_object(
                   'id', r.id,
                   'codigo', coalesce(r.codigo, 'N° ' || r.numero),
                   'proyecto', concat_ws(' — ', r.proyecto_codigo, r.proyecto_nombre),
                   'solicitado_por', coalesce(r.solicitante_nombre, ''),
                   'insumo_codigo', mi.codigo,
                   'insumo', coalesce(mi.descripcion, '(insumo eliminado)'),
                   'unidad', coalesce(mi.u_m, p.unidad, ''),
                   'cantidad', round(p.cantidad / case when coalesce(p.factor_unidad, 1) > 0 then coalesce(p.factor_unidad, 1) else 1 end, 6),
                   'fecha_requisicion', (r.created_at at time zone 'America/Bogota')::date,
                   'fecha_requerida', r.fecha_requerida,
                   'fecha_estimada', r.fecha_estimada,
                   'estado', r.estado,
                   'estado_compra', r.estado_compra,
                   'tipo', case when r.extraordinaria then 'Extraordinaria'
                                when coalesce(r.administrativa, false) then 'Administrativa' else 'Normal' end,
                   'anexos', (select count(*) from public.requisicion_anexos a where a.requisicion_id = r.id)
                 ) order by r.created_at, r.id, p.created_at, p.id) as filas
            from public.requisiciones_vista r
            join public.pedidos_insumos p on p.grupo_pedido_id = r.id
            left join public.maestro_insumos mi on mi.id = p.insumo_id
           where r.created_at >= (v_lunes::timestamp at time zone 'America/Bogota')
             and r.created_at < ((v_lunes + 7)::timestamp at time zone 'America/Bogota')
           group by r.proyecto_id
        ) x), '[]'::jsonb));
end;
$$;

revoke all on function public.requisiciones_semana_drive(date) from public, anon, authenticated;
grant execute on function public.requisiciones_semana_drive(date) to service_role;

-- 4. pg_cron: lunes 05:30 UTC = 00:30 en Colombia (la semana que acaba de cerrar) --

select cron.schedule('informe-requisiciones-drive', '30 5 * * 1', $cron$
  select net.http_post(
           url := a.url_funcion,
           headers := '{"Content-Type": "application/json"}'::jsonb,
           body := '{"informe": "requisiciones"}'::jsonb,
           timeout_milliseconds := 120000)
    from public.ajustes_drive a
   where a.id and a.activo and a.url_funcion is not null and a.unidad_id is not null;
$cron$);

commit;
