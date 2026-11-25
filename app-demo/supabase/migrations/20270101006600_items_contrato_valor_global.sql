-- Ítems de un contrato a valor global (decisiones del usuario, 2026-11-25).
--
-- Caso: un contrato de suministro de ACPM, gasolina y papelería. No son ítems del
-- presupuesto: el contrato va a VALOR GLOBAL y, de forma opcional, lleva una lista
-- de los ítems que se pueden usar con él. Cada ítem tiene descripción (obligatoria)
-- y, si se conocen, unidad, cantidad y valor unitario (la gasolina puede ir sin
-- cantidad ni precio; la papelería con su precio). El valor del contrato sigue
-- siendo el global que se escribe; lo que tiene cantidad × precio no puede sumar
-- más que ese valor. Sin lista, el contrato es global sin desglose, como siempre.
--
-- - Solo contratos por grupos de SUMINISTRO E INSTALACIÓN a valor global.
-- - Tabla contrato_items_globales (se escribe solo por _guardar_solicitud_contrato,
--   que se parcha por texto exacto; la valida _validar_items_globales).
-- - Las actas no cambian (valor global = por % de avance), ni Control del proyecto.
-- - La minuta de suministro (GJ-F-012) muestra estos ítems en la tabla de
--   especificaciones (eso es de la app).
--
-- Va ANTES del código (el detalle del contrato lee la tabla). Reversa en
-- supabase/reversa/.
--
-- Se creó y se aplicó en Supabase (2026-11-25) con el número 20270101006500, que
-- también usa otra migración de ese día (terceros_nombres_primero); se renombró a
-- 006600. El comentario de la tabla y el texto que el parche deja en
-- _guardar_solicitud_contrato siguen diciendo "(20270101006500)": así quedaron en
-- la base y la reversa los busca tal cual. No cambiarlos.

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

-- 1. Tabla -----------------------------------------------------------------------

create table if not exists public.contrato_items_globales (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  orden integer not null,
  descripcion text not null check (length(trim(descripcion)) between 1 and 300),
  unidad text check (unidad is null or length(trim(unidad)) between 1 and 40),
  cantidad numeric check (cantidad is null or cantidad > 0),
  valor_unitario numeric check (valor_unitario is null or valor_unitario > 0),
  unique (contrato_id, orden)
);

comment on table public.contrato_items_globales is
  'Ítems que se pueden usar con un contrato de suministro a valor global (20270101006500). Informativos: el valor del contrato es el global.';

alter table public.contrato_items_globales enable row level security;

-- Leer = quien ve el contrato. Por función INVOKER (regla de memoria de la base:
-- no expandir las políticas de contratos en el plan).
drop policy if exists contrato_items_globales_select on public.contrato_items_globales;
create policy contrato_items_globales_select on public.contrato_items_globales
  for select to authenticated
  using (contrato_id::text in (select public._ids_contratos_visibles()));

revoke all on public.contrato_items_globales from anon;
grant select on public.contrato_items_globales to authenticated;

-- 2. Validación --------------------------------------------------------------------

create or replace function public._validar_items_globales(p_tipo text, p_anexo text, p_valor numeric, p_items jsonb)
returns void
language plpgsql
stable
set search_path = public
as $f$
declare
  d jsonb;
  v_desc text;
  v_unidad text;
  v_cant numeric;
  v_vu numeric;
  v_suma numeric := 0;
  v_vistas text[] := '{}';
  v_n integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) = 'null' then
    return;
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'La lista de ítems del contrato no es válida.';
  end if;
  if jsonb_array_length(p_items) = 0 then
    return;
  end if;
  if p_tipo is distinct from 'suministro_instalacion' or p_anexo is distinct from 'valor_global' then
    raise exception 'Solo un contrato de suministro e instalación a valor global lleva lista de ítems.';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'La lista de ítems del contrato admite hasta 50 ítems.';
  end if;
  for d in select * from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    v_desc := nullif(trim(d->>'descripcion'), '');
    if v_desc is null then
      raise exception 'Escribe la descripción del ítem %.', v_n;
    end if;
    if length(v_desc) > 300 then
      raise exception 'La descripción del ítem % es muy larga (máximo 300 caracteres).', v_n;
    end if;
    if lower(v_desc) = any (v_vistas) then
      raise exception 'El ítem "%" está repetido.', v_desc;
    end if;
    v_vistas := v_vistas || lower(v_desc);
    v_unidad := nullif(trim(d->>'unidad'), '');
    if v_unidad is not null and length(v_unidad) > 40 then
      raise exception 'La unidad del ítem % es muy larga.', v_n;
    end if;
    begin
      v_cant := nullif(d->>'cantidad', '')::numeric;
      v_vu := nullif(d->>'valor_unitario', '')::numeric;
    exception when others then
      raise exception 'La cantidad o el valor unitario del ítem % no es un número.', v_n;
    end;
    if v_cant is not null and v_cant <= 0 then
      raise exception 'La cantidad del ítem % debe ser mayor que cero (o déjala vacía).', v_n;
    end if;
    if v_vu is not null and v_vu <= 0 then
      raise exception 'El valor unitario del ítem % debe ser mayor que cero (o déjalo vacío).', v_n;
    end if;
    if v_cant is not null and v_vu is not null then
      v_suma := v_suma + round(v_cant * v_vu, 2);
    end if;
  end loop;
  if v_suma > coalesce(p_valor, 0) then
    raise exception 'Los ítems con cantidad y valor unitario suman $ % y pasan del valor del contrato ($ %).',
      translate(to_char(v_suma, 'FM999,999,999,990.00'), ',.', '.,'),
      translate(to_char(coalesce(p_valor, 0), 'FM999,999,999,990.00'), ',.', '.,');
  end if;
end;
$f$;

revoke execute on function public._validar_items_globales(text, text, numeric, jsonb) from public, anon;

-- 3. _guardar_solicitud_contrato -------------------------------------------------

-- Al corregir una devuelta se borran también sus ítems globales.
select pg_temp._parche(
  'public._guardar_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, boolean)'::regprocedure,
  '    delete from contrato_anexo_items where contrato_id = p_id;
',
  '    delete from contrato_anexo_items where contrato_id = p_id;
    delete from contrato_items_globales where contrato_id = p_id;
');

-- Valida la lista (p_datos.items_globales) una vez conocido el valor.
select pg_temp._parche(
  'public._guardar_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, boolean)'::regprocedure,
  '    raise exception ''Un contrato a valor global no lleva tabla de valores unitarios.'';
  end if;
',
  '    raise exception ''Un contrato a valor global no lleva tabla de valores unitarios.'';
  end if;
  -- Ítems de un suministro a valor global (20270101006500).
  perform public._validar_items_globales(v_tipo, v_anexo, v_valor, p_datos->''items_globales'');
');

select pg_temp._parche(
  'public._guardar_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, boolean)'::regprocedure,
  '  insert into contrato_documentos (contrato_id, tipo, ruta, nombre_archivo, tamano, mime)
',
  '  insert into contrato_items_globales (contrato_id, orden, descripcion, unidad, cantidad, valor_unitario)
  select p_id, t.ord, trim(t.v->>''descripcion''), nullif(trim(t.v->>''unidad''), ''''),
         nullif(t.v->>''cantidad'', '''')::numeric, round(nullif(t.v->>''valor_unitario'', '''')::numeric, 2)
  from jsonb_array_elements(case when jsonb_typeof(p_datos->''items_globales'') = ''array''
                                 then p_datos->''items_globales'' else ''[]''::jsonb end) with ordinality as t(v, ord);

  insert into contrato_documentos (contrato_id, tipo, ruta, nombre_archivo, tamano, mime)
');

commit;
