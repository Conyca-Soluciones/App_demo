-- Pagos administrativos para los proyectos que todavía se manejan en Google
-- (decisiones del usuario, 2026-11-12). Los ingenieros y áreas que no usan 360
-- montan aquí su cuadro de pagos (formato GF-F-018) y lo envían a Gerencia; de
-- ahí sigue el flujo de siempre (Aprobación de pagos, consolidado de la
-- empresa, liquidación, dispersión, Balances).
--
-- 1. proyectos.solo_pagos: proyectos que solo existen para pagos (no salen en
--    AdPro); se asignan a cada usuario como cualquier proyecto.
-- 2. Rol "Solicitante de pagos" (sin pestañas: ve lo que es para todos, Pagos
--    administrativos, Mis pendientes y la campanita).
-- 3. Anticipos y/o descuentos por ítem (requisicion_admin_items.descuentos):
--    total = valor documento − descuentos; el pago sale por el total, con el
--    documento y el descuento en su desglose (Contabilidad puede sumarle).
-- 4. Proyectos del cuadro: los que la persona ve, más FUNCIONAMIENTO.
-- 5. total_consolidado_gerencia: total de TODOS los pagos filtrados.
--
-- Solo agrega; los ajustes a funciones vivas son parches por texto exacto
-- (fallan si no encuentran el texto, no hacen nada si ya están).
-- Reversa en supabase/reversa/20270101001300_pagos_admin_google.sql.

begin;

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

-- 1. Proyectos solo para pagos -----------------------------------------------------
alter table public.proyectos add column if not exists solo_pagos boolean not null default false;

-- 2. Rol --------------------------------------------------------------------------
insert into public.roles (clave, nombre, es_sistema, orden)
select 'solicitante_pagos', 'Solicitante de pagos', false, 130
 where not exists (select 1 from public.roles where clave = 'solicitante_pagos');

-- 3. Anticipos y/o descuentos -------------------------------------------------------
alter table public.requisicion_admin_items add column if not exists descuentos numeric(18, 2) not null default 0;
alter table public.requisicion_admin_items drop constraint if exists requisicion_admin_items_descuentos_check;
alter table public.requisicion_admin_items add constraint requisicion_admin_items_descuentos_check
  check (descuentos >= 0 and descuentos < valor) not valid;

select pg_temp._parche('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $a$  v_codigo text;
begin$a$,
  $b$  v_codigo text;
  v_desc numeric;
begin$b$);

select pg_temp._parche('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $a$    if v_valor is null or v_valor <= 0 then
      raise exception '%el valor debe ser mayor que cero.', v_fila;
    end if;$a$,
  $b$    if v_valor is null or v_valor <= 0 then
      raise exception '%el valor debe ser mayor que cero.', v_fila;
    end if;
    -- Anticipos y/o descuentos (20270101001300): el total es valor − descuentos.
    begin
      v_desc := round(coalesce(nullif(v_it ->> 'descuentos', ''), '0')::numeric, 2);
    exception when others then
      v_desc := null;
    end;
    if v_desc is null or v_desc < 0 then
      raise exception '%los anticipos y/o descuentos no pueden ser negativos.', v_fila;
    end if;
    if v_desc >= v_valor then
      raise exception '%los anticipos y/o descuentos deben ser menores que el valor del documento.', v_fila;
    end if;$b$);

-- 4. Solo proyectos que la persona ve (o FUNCIONAMIENTO).
select pg_temp._parche('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $a$    if v_proyecto is null or not exists (select 1 from public.proyectos where id = v_proyecto) then
      raise exception '%elige el código de proyecto.', v_fila;
    end if;$a$,
  $b$    if v_proyecto is null or not exists (select 1 from public.proyectos where id = v_proyecto) then
      raise exception '%elige el código de proyecto.', v_fila;
    end if;
    if not exists (select 1 from public.proyectos p
                    where p.id = v_proyecto
                      and (p.funcionamiento or p.id in (select public.proyectos_visibles(auth.uid())))) then
      raise exception '%no tienes acceso a ese proyecto.', v_fila;
    end if;$b$);

select pg_temp._parche('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $a$soporte_tamano, soporte_tipo, codigo)$a$,
  $b$soporte_tamano, soporte_tipo, codigo, descuentos)$b$);

select pg_temp._parche('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $a$      v_codigo);$a$,
  $b$      v_codigo, v_desc);$b$);

select pg_temp._parche('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $a$    v_total := v_total + v_valor;$a$,
  $b$    v_total := v_total + v_valor - v_desc;$b$);

-- El pago sale por el total; el documento y el descuento van en su desglose.
select pg_temp._parche('public._crear_pagos_requisicion_admin(uuid)'::regprocedure,
  $a$concepto, valor, estado, solicitado_en)$a$,
  $b$concepto, valor, valor_documento, descuento_anticipos, estado, solicitado_en)$b$);

select pg_temp._parche('public._crear_pagos_requisicion_admin(uuid)'::regprocedure,
  $a$            v_it.valor, 'solicitado', now())$a$,
  $b$            v_it.valor - coalesce(v_it.descuentos, 0), v_it.valor, coalesce(v_it.descuentos, 0), 'solicitado', now())$b$);

select pg_temp._parche('public.detalle_requisicion_admin(uuid)'::regprocedure,
  $a$'id', i.id, 'orden', i.orden, 'metodo', i.metodo, 'codigo', i.codigo,$a$,
  $b$'id', i.id, 'orden', i.orden, 'metodo', i.metodo, 'codigo', i.codigo, 'descuentos', i.descuentos,$b$);

-- Opciones del formulario: proyectos que la persona ve (o FUNCIONAMIENTO), con su
-- empresa y la marca solo_pagos.
create or replace function public.opciones_requisicion_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión.';
  end if;
  return jsonb_build_object(
    'empresas', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'razon_social', e.razon_social, 'nit', e.nit)
                                           order by e.razon_social)
                            from public.empresas e), '[]'::jsonb),
    'proyectos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'codigo', p.codigo, 'nombre', p.nombre,
                                                               'empresa_id', p.empresa_id, 'solo_pagos', p.solo_pagos)
                                            order by p.codigo nulls last, p.nombre)
                             from public.proyectos p
                            where p.funcionamiento or p.id in (select public.proyectos_visibles(auth.uid()))), '[]'::jsonb)
  );
end;
$$;

-- 5. Total de lo filtrado en el Consolidado Gerencia -------------------------------
create or replace function public.total_consolidado_gerencia(
  p_anios integer[], p_semanas integer[], p_empresa_id uuid, p_proyecto_id uuid, p_solicitante_id uuid,
  p_tercero text, p_creado_desde timestamptz[], p_creado_hasta timestamptz[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.es_admin(auth.uid()) or public.tiene_pestana(auth.uid(), 'ayf.consolidado_gerencia')) then
    raise exception 'No autorizado -- no tienes el Consolidado Gerencia.';
  end if;
  return (
    select jsonb_build_object(
             'pagos', count(*),
             'valor', coalesce(sum(g.valor) filter (where g.estado not in ('anulado', 'rechazado')), 0),
             'anulados', count(*) filter (where g.estado in ('anulado', 'rechazado')))
      from public.pagos g
      left join public.terceros t on t.id = g.tercero_id
     where g.consolidado_id is not null and g.semana is not null
       and (coalesce(array_length(p_anios, 1), 0) = 0 or g.anio = any (p_anios))
       and (coalesce(array_length(p_semanas, 1), 0) = 0 or g.semana = any (p_semanas))
       and (p_empresa_id is null or g.empresa_id = p_empresa_id)
       and (p_proyecto_id is null or g.proyecto_id = p_proyecto_id)
       and (p_solicitante_id is null or g.solicitado_por = p_solicitante_id)
       and (nullif(btrim(coalesce(p_tercero, '')), '') is null or t.razon_social ilike '%' || btrim(p_tercero) || '%')
       and (coalesce(array_length(p_creado_desde, 1), 0) = 0
            or exists (select 1 from unnest(p_creado_desde, p_creado_hasta) r(desde, hasta)
                        where g.creado_en >= r.desde and g.creado_en < r.hasta))
  );
end;
$$;
revoke all on function public.total_consolidado_gerencia(integer[], integer[], uuid, uuid, uuid, text, timestamptz[], timestamptz[]) from public, anon;
grant execute on function public.total_consolidado_gerencia(integer[], integer[], uuid, uuid, uuid, text, timestamptz[], timestamptz[]) to authenticated;

commit;
