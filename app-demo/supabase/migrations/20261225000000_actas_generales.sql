-- Actas generales (decisión del usuario, 2026-10-23): las actas de los
-- contratos GENERALES funcionan igual que las de Actas por grupos (mismas
-- tablas, funciones, pago en A&F, PDF e historial), en su propia pestaña
-- `contratos.actas_generales` (/contratos/actas-generales). Los contratos
-- generales son de valor global: el acta es por % de ejecución y el pago es el
-- neto de ese %. La retención en garantía de un general es su
-- `retencion_garantia_pct` (0 = sin retención).
-- Va después de las de la rama de Sofia (20261217000000-20261224000000): no toca
-- contrato_para_acta ni _pago_de_acta; las demás se parchan sobre su versión
-- VIVA (reemplazo de texto exacto, falla si no lo encuentra).

-- 1. La pestaña, para los roles que ya hacen o ven actas por grupos.
insert into public.rol_permisos (rol_id, permiso)
select distinct rp.rol_id, 'tab.contratos.actas_generales'
  from public.rol_permisos rp
 where rp.permiso = 'tab.contratos.cortes'
on conflict do nothing;

-- 2. Ver actas: también con Actas generales.
do $$
declare
  d text := pg_get_functiondef('public.puede_ver_actas(uuid)'::regprocedure);
  a text := 'public.tiene_pestana(auth.uid(), ''contratos.aprobar_actas'')';
begin
  if position('actas_generales' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'puede_ver_actas no tiene el texto esperado.'; end if;
  execute replace(d, a, a || ' or public.tiene_pestana(auth.uid(), ''contratos.actas_generales'')');
end $$;

do $$
declare
  d text := pg_get_functiondef('public._puede_ver_otrosis(uuid)'::regprocedure);
  a text := 'public.tiene_pestana(p_uid, ''contratos.cortes'')';
begin
  if position('actas_generales' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception '_puede_ver_otrosis no tiene el texto esperado.'; end if;
  execute replace(d, a, a || ' or public.tiene_pestana(p_uid, ''contratos.actas_generales'')');
end $$;

drop policy if exists actas_select on public.actas;
create policy actas_select on public.actas for select to authenticated
  using (((select public.tiene_pestana((select auth.uid()), 'contratos.cortes'))
          or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_actas'))
          or (select public.tiene_pestana((select auth.uid()), 'contratos.actas_generales')))
         and exists (select 1 from public.contratos c
                      where c.id = actas.contrato_id
                        and c.proyecto_id in (select public.proyectos_visibles((select auth.uid())))));

-- 3. Retención en garantía: la del contrato general es su %.
create or replace function public._retencion_porcentaje_contrato(p_contrato_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
           when c.clase = 'general' then nullif(c.retencion_garantia_pct, 0)
           when coalesce((c.datos_tipo->>'retencion_garantia')::boolean, false)
             then nullif(c.datos_tipo->>'retencion_porcentaje', '')::numeric
         end
  from contratos c where c.id = p_contrato_id
$$;

-- 4. Buscar contratos y contratistas de la clase de la pantalla (por omisión
-- 'grupo', como antes). Cada clase pide su pestaña.
drop function if exists public.buscar_contratistas_para_acta(text);
create function public.buscar_contratistas_para_acta(p_texto text, p_clase text default 'grupo')
returns table(contratista_id uuid, nombre text, documento text, contratos integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
begin
  if p_clase not in ('grupo', 'general') then
    raise exception 'Clase de contrato no válida.';
  end if;
  if not public.tiene_pestana(auth.uid(), case p_clase when 'general' then 'contratos.actas_generales' else 'contratos.cortes' end) then
    raise exception 'No tienes permiso para ver actas.';
  end if;
  if v_texto is null then
    return;
  end if;

  return query
  select k.id, k.nombre,
         k.tipo_documento || ' ' || k.numero_documento || coalesce('-' || k.digito_verificacion, ''),
         count(*)::int
  from contratistas k
  join contratos c on c.contratista_id = k.id
  where c.estado = 'aprobada' and c.minuta_estado = 'aprobada' and c.clase = p_clase
    and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
    and (v_texto = '_' or k.nombre ilike '%' || v_texto || '%' or k.numero_documento ilike '%' || v_texto || '%')
  group by k.id, k.nombre, k.tipo_documento, k.numero_documento, k.digito_verificacion
  order by k.nombre
  limit 50;
end;
$$;

drop function if exists public.buscar_contratos_para_acta(text, uuid);
create function public.buscar_contratos_para_acta(p_texto text default null, p_contratista_id uuid default null, p_clase text default 'grupo')
returns table(contrato_id uuid, numero_contrato text, numero bigint, tipo text, objeto text, valor numeric,
              proyecto_codigo text, proyecto_nombre text, contratista_id uuid, contratista_nombre text,
              contratista_documento text, actas integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
begin
  if p_clase not in ('grupo', 'general') then
    raise exception 'Clase de contrato no válida.';
  end if;
  if not public.tiene_pestana(auth.uid(), case p_clase when 'general' then 'contratos.actas_generales' else 'contratos.cortes' end) then
    raise exception 'No tienes permiso para ver actas.';
  end if;
  if p_contratista_id is null and v_texto is null then
    return;
  end if;

  return query
  select c.id, c.numero_contrato, c.numero, c.tipo, c.objeto, public._valor_contrato(c.id),
         p.codigo, p.nombre, k.id, k.nombre,
         k.tipo_documento || ' ' || k.numero_documento || coalesce('-' || k.digito_verificacion, ''),
         (select count(*)::int from actas a where a.contrato_id = c.id)
  from contratos c
  join contratistas k on k.id = c.contratista_id
  join proyectos p on p.id = c.proyecto_id
  where c.estado = 'aprobada' and c.minuta_estado = 'aprobada' and c.clase = p_clase
    and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
    and (p_contratista_id is null or c.contratista_id = p_contratista_id)
    and (
      v_texto is null or v_texto = '_'
      or c.numero_contrato ilike '%' || v_texto || '%'
      or c.objeto ilike '%' || v_texto || '%'
      or k.nombre ilike '%' || v_texto || '%'
      or k.numero_documento ilike '%' || v_texto || '%'
    )
  order by c.numero desc
  limit 50;
end;
$$;

revoke all on function public.buscar_contratistas_para_acta(text, text) from public, anon;
grant execute on function public.buscar_contratistas_para_acta(text, text) to authenticated;
revoke all on function public.buscar_contratos_para_acta(text, uuid, text) from public, anon;
grant execute on function public.buscar_contratos_para_acta(text, uuid, text) to authenticated;
