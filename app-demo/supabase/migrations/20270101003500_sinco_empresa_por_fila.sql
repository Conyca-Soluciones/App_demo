-- Cuadros de SINCO: cada pago con la empresa de SU fila (columna GRUPO EMPRESARIAL), no la
-- del proyecto (decisión del usuario, 2026-11-13; en el cuadro de compras un mismo proyecto
-- trae filas de varias empresas). Si el grupo no existe en Empresas, el cuadro no se carga;
-- si la fila no trae grupo, se usa la empresa del proyecto.
-- Proyectos y empresas se reconocen comparando solo letras y números sin tilde
-- (_clave_sinco): los cuadros traen letras perdidas ("BATER�AS", "ANTIOQUE�\u0091A").
-- Parches por texto exacto sobre cargar_cuadro_sinco. Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $f$
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
$f$;

-- Letras (sin tilde) y números; "$" = "&".
create or replace function public._clave_sinco(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(upper(translate(coalesce(p, ''), '$', '&')), '[^A-Z0-9&]', '', 'g')
$$;

select pg_temp._parche('public.cargar_cuadro_sinco(text,jsonb,uuid[],boolean)'::regprocedure,
  $a$  v_por_proyecto jsonb := '{}';
begin$a$,
  $b$  v_por_proyecto jsonb := '{}';
  v_empresas jsonb;
begin$b$);

select pg_temp._parche('public.cargar_cuadro_sinco(text,jsonb,uuid[],boolean)'::regprocedure,
  $a$    from (select public._norm_texto_sinco(codigo) k, id from public.proyectos
          union all
          select public._norm_texto_sinco(public._con_ceros(numero, 3) || '-' || codigo), id from public.proyectos) x$a$,
  $b$    from (select public._clave_sinco(codigo) k, id from public.proyectos
          union all
          select public._clave_sinco(public._con_ceros(numero, 3) || '-' || codigo), id from public.proyectos) x$b$);

select pg_temp._parche('public.cargar_cuadro_sinco(text,jsonb,uuid[],boolean)'::regprocedure,
  $a$  -- Revisión (nada se escribe).
$a$,
  $b$  -- Empresas por razón social (la del GRUPO EMPRESARIAL de cada fila).
  select coalesce(jsonb_object_agg(k, id), '{}') into v_empresas
    from (select distinct on (public._clave_sinco(razon_social)) public._clave_sinco(razon_social) k, id
            from public.empresas order by public._clave_sinco(razon_social), razon_social) x
   where k <> '';

  -- Revisión (nada se escribe).
$b$);

select pg_temp._parche('public.cargar_cuadro_sinco(text,jsonb,uuid[],boolean)'::regprocedure,
  $a$    v_clave := public._norm_texto_sinco(v_f->>'proyecto');$a$,
  $b$    v_clave := public._clave_sinco(v_f->>'proyecto');$b$);

select pg_temp._parche('public.cargar_cuadro_sinco(text,jsonb,uuid[],boolean)'::regprocedure,
  $a$    if btrim(coalesce(v_f->>'factura_nombre', '')) = '' then$a$,
  $b$    if btrim(coalesce(v_f->>'grupo', '')) <> '' and not (v_empresas ? public._clave_sinco(v_f->>'grupo')) then
      v_errores := v_errores || jsonb_build_object('orden', v_f->'orden',
        'mensaje', 'El grupo empresarial "' || btrim(v_f->>'grupo') || '" no existe en Empresas de 360.');
      continue;
    end if;
    if btrim(coalesce(v_f->>'factura_nombre', '')) = '' then$b$);

select pg_temp._parche('public.cargar_cuadro_sinco(text,jsonb,uuid[],boolean)'::regprocedure,
  $a$    v_proy := (v_proys->>public._norm_texto_sinco(v_f->>'proyecto'))::uuid;$a$,
  $b$    v_proy := (v_proys->>public._clave_sinco(v_f->>'proyecto'))::uuid;$b$);

select pg_temp._parche('public.cargar_cuadro_sinco(text,jsonb,uuid[],boolean)'::regprocedure,
  $a$    select empresa_id into v_empresa from public.proyectos where id = v_proy;$a$,
  $b$    -- La empresa de la fila; sin grupo, la del proyecto.
    v_empresa := coalesce((v_empresas->>public._clave_sinco(v_f->>'grupo'))::uuid,
                          (select empresa_id from public.proyectos where id = v_proy));$b$);

commit;
