-- Soporte individual de los pagos marcados como pagados sin dispersor (PSE en el
-- Consolidado y "otro medio" en Realizar Pagos), como el del dispersor (decisión del
-- usuario, 2026-11-13). La app genera el PDF al marcarlos, lo sube al bucket
-- dispersores (pse/soportes/<pago>/...) y lo registra con guardar_soportes_pago_manual.
-- El comprobante que se adjunta sigue aparte (pago_comprobante_*).
-- Solo agrega; parches por texto exacto. Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  p_a := replace(p_a, E'\r\n', E'\n');
  p_b := replace(p_b, E'\r\n', E'\n');
  if position(p_b in d) > 0 then
    return;
  end if;
  if position(p_a in d) = 0 then
    raise exception '% no tiene el texto esperado: %', p_fn, left(p_a, 120);
  end if;
  execute replace(d, p_a, p_b);
end;
$$;

alter table public.pagos add column if not exists pago_soporte_ruta text;
alter table public.pagos add column if not exists pago_soporte_nombre text;

-- Registra los PDF generados: [{pago_id, ruta, nombre}]. Solo pagos pagados sin
-- dispersor que la persona ve, con la acción que corresponde.
create or replace function public.guardar_soportes_pago_manual(p_soportes jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pse boolean := public.tiene_accion(auth.uid(), 'pagar_pse');
  v_otro boolean := public.tiene_accion(auth.uid(), 'generar_dispersores');
  v_s jsonb;
  v_pago uuid;
  v_ruta text;
  v_n integer := 0;
begin
  if not (v_pse or v_otro) then
    raise exception 'No autorizado -- no tienes permiso para pagar estos pagos.';
  end if;
  if jsonb_typeof(p_soportes) is distinct from 'array' or jsonb_array_length(p_soportes) > 3000 then
    raise exception 'Lista de soportes no válida.';
  end if;
  for v_s in select value from jsonb_array_elements(p_soportes) loop
    v_pago := (v_s ->> 'pago_id')::uuid;
    v_ruta := v_s ->> 'ruta';
    if v_ruta is null or v_ruta not like 'pse/soportes/' || v_pago::text || '/%' then
      raise exception 'El soporte no se subió bien.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'dispersores' and o.name = v_ruta) then
      raise exception 'No se encontró el soporte subido.';
    end if;
    update public.pagos g
       set pago_soporte_ruta = v_ruta, pago_soporte_nombre = left(coalesce(nullif(btrim(v_s ->> 'nombre'), ''), 'soporte.pdf'), 200)
     where g.id = v_pago and g.estado = 'dispersado' and g.dispersion_id is null and g.pagado_manual_por is not null
       and g.consolidado_id in (select public._consolidados_visibles(auth.uid()))
       and case when public.pago_es_pse(g) then v_pse else v_otro end;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.guardar_soportes_pago_manual(jsonb) from public, anon;
grant execute on function public.guardar_soportes_pago_manual(jsonb) to authenticated;

-- "El pago no salió": el soporte deja de valer.
select pg_temp._parche('public.deshacer_pago_pse(uuid[],text)'::regprocedure,
  $a$pago_comprobante_ruta = null, pago_comprobante_nombre = null, pago_comprobante_mime = null$a$,
  $b$pago_comprobante_ruta = null, pago_comprobante_nombre = null, pago_comprobante_mime = null,
         pago_soporte_ruta = null, pago_soporte_nombre = null$b$);

-- Storage: el soporte se lee como el comprobante (quien ve el pago) y no se borra si está en uso.
drop policy if exists dispersores_comprobante_pse_select on storage.objects;
create policy dispersores_comprobante_pse_select on storage.objects for select to authenticated
  using (bucket_id = 'dispersores' and (storage.foldername(name))[1] = 'pse'
         and (name in (select p.pago_comprobante_ruta from public.pagos p where p.pago_comprobante_ruta is not null)
              or name in (select p.pago_soporte_ruta from public.pagos p where p.pago_soporte_ruta is not null)));
drop policy if exists dispersores_comprobante_pse_delete on storage.objects;
create policy dispersores_comprobante_pse_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dispersores' and (storage.foldername(name))[1] = 'pse'
         and (select public.tiene_accion((select auth.uid()), 'pagar_pse'))
         and name not in (select p.pago_comprobante_ruta from public.pagos p where p.pago_comprobante_ruta is not null)
         and name not in (select p.pago_soporte_ruta from public.pagos p where p.pago_soporte_ruta is not null));

commit;
