-- Reversa de 20270101001300_pagos_admin_google.sql: deshace los parches,
-- vuelve opciones_requisicion_admin a todos los proyectos y quita el total del
-- Consolidado Gerencia. Las columnas (proyectos.solo_pagos,
-- requisicion_admin_items.descuentos) y el rol se dejan: tienen datos.

begin;

create or replace function pg_temp._deshacer(p_fn regprocedure, p_nuevo text, p_viejo text)
returns void
language plpgsql
as $$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  if position(p_nuevo in d) = 0 then
    return;
  end if;
  execute replace(d, p_nuevo, p_viejo);
end;
$$;

select pg_temp._deshacer('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $b$    v_total := v_total + v_valor - v_desc;$b$, $a$    v_total := v_total + v_valor;$a$);
select pg_temp._deshacer('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $b$      v_codigo, v_desc);$b$, $a$      v_codigo);$a$);
select pg_temp._deshacer('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $b$soporte_tamano, soporte_tipo, codigo, descuentos)$b$, $a$soporte_tamano, soporte_tipo, codigo)$a$);
select pg_temp._deshacer('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $b$
    if not exists (select 1 from public.proyectos p
                    where p.id = v_proyecto
                      and (p.funcionamiento or p.id in (select public.proyectos_visibles(auth.uid())))) then
      raise exception '%no tienes acceso a ese proyecto.', v_fila;
    end if;$b$, '');
select pg_temp._deshacer('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $b$
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
    end if;$b$, '');
select pg_temp._deshacer('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $b$
  v_desc numeric;$b$, '');

select pg_temp._deshacer('public._crear_pagos_requisicion_admin(uuid)'::regprocedure,
  $b$            v_it.valor - coalesce(v_it.descuentos, 0), v_it.valor, coalesce(v_it.descuentos, 0), 'solicitado', now())$b$,
  $a$            v_it.valor, 'solicitado', now())$a$);
select pg_temp._deshacer('public._crear_pagos_requisicion_admin(uuid)'::regprocedure,
  $b$concepto, valor, valor_documento, descuento_anticipos, estado, solicitado_en)$b$,
  $a$concepto, valor, estado, solicitado_en)$a$);

select pg_temp._deshacer('public.detalle_requisicion_admin(uuid)'::regprocedure,
  $b$ 'descuentos', i.descuentos,$b$, '');

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
                                                               'empresa_id', p.empresa_id)
                                            order by p.codigo nulls last, p.nombre)
                             from public.proyectos p), '[]'::jsonb)
  );
end;
$$;

drop function if exists public.total_consolidado_gerencia(integer[], integer[], uuid, uuid, uuid, text, timestamptz[], timestamptz[]);

commit;
