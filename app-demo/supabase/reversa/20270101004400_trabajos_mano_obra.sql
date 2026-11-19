-- Reversa de 20270101004400_trabajos_mano_obra.sql.
-- Las funciones vuelven a contar el cupo por ítem completo. Las columnas
-- (apu_import_revision.dividida_de, contrato_anexo_items.mano_obra_categoria_id)
-- y el estado 'dividido' se dejan: tienen datos de lo que ya se dividió o
-- contrató por trabajos. Antes de correrla, juntar los ítems divididos que no
-- tengan contratos (juntar_mano_obra_item).

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
  if position(p_a in d) = 0 then
    return;
  end if;
  execute replace(d, p_a, p_b);
end;
$f$;

select pg_temp._parche('public.resolver_otrosi(uuid,text,text,jsonb)'::regprocedure,
  '             p_id, coalesce((t.e->>''sin_mano_obra'')::boolean, false),
             nullif(t.e->>''mano_obra_categoria_id'', '''')::uuid
        from jsonb_array_elements(v_acts) with ordinality as t(e, ord)',
  '             p_id, coalesce((t.e->>''sin_mano_obra'')::boolean, false)
        from jsonb_array_elements(v_acts) with ordinality as t(e, ord)');
select pg_temp._parche('public.resolver_otrosi(uuid,text,text,jsonb)'::regprocedure,
  'otrosi_id, sin_mano_obra, mano_obra_categoria_id)', 'otrosi_id, sin_mano_obra)');

select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  '      ''cantidad'', v_cant, ''valor_unitario'', v_vu, ''total'', round(v_cant * v_vu, 2), ''sin_mano_obra'', v_sin_mo,
      ''mano_obra_categoria_id'', v_cat));',
  '      ''cantidad'', v_cant, ''valor_unitario'', v_vu, ''total'', round(v_cant * v_vu, 2), ''sin_mano_obra'', v_sin_mo));');
select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  '    if v_pi.codigo || ''|'' || coalesce(v_cat::text, '''') = any (v_codigos) then
      raise exception ''El ítem % está repetido en las actividades del otrosí.'', v_pi.codigo;
    end if;
    v_codigos := v_codigos || (v_pi.codigo || ''|'' || coalesce(v_cat::text, ''''));
    -- Una adición a un trabajo usa el cupo de ese trabajo (20270101004400).
    v_disp := v_pi.cantidad - public._contratado_linea(v_presupuesto, v_pi.codigo, v_cat);',
  '    if v_pi.codigo = any (v_codigos) then
      raise exception ''El ítem % está repetido en las actividades del otrosí.'', v_pi.codigo;
    end if;
    v_codigos := v_codigos || v_pi.codigo;
    v_disp := v_pi.cantidad - public._contratado_item(v_presupuesto, v_pi.codigo);');
select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  '      v_sin_mo := c.tipo = ''mano_obra'' and v_mo = 0;
      v_cat := null;', '      v_sin_mo := c.tipo = ''mano_obra'' and v_mo = 0;');
select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  '      v_sin_mo := v_ai.sin_mano_obra;
      v_cat := v_ai.cat;', '      v_sin_mo := v_ai.sin_mano_obra;');
select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  '        select ai.id, ai.actividad, ai.unidad, ai.valor_unitario, ai.sin_mano_obra, p2.codigo,
               ai.mano_obra_categoria_id as cat into v_ai',
  '        select ai.id, ai.actividad, ai.unidad, ai.valor_unitario, ai.sin_mano_obra, p2.codigo into v_ai');
select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  '      if coalesce(v_ai.codigo, v_ai.id::text) || ''|'' || coalesce(v_ai.cat::text, '''') = any (v_codigos) then
        raise exception ''La actividad "%" está repetida en las actividades del otrosí.'', v_ai.actividad;
      end if;
      v_codigos := v_codigos || (coalesce(v_ai.codigo, v_ai.id::text) || ''|'' || coalesce(v_ai.cat::text, ''''));',
  '      if coalesce(v_ai.codigo, v_ai.id::text) = any (v_codigos) then
        raise exception ''La actividad "%" está repetida en las actividades del otrosí.'', v_ai.actividad;
      end if;
      v_codigos := v_codigos || coalesce(v_ai.codigo, v_ai.id::text);');
select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  '               ai.cantidad - ai.cantidad_reducida as vigente, p2.codigo, ai.mano_obra_categoria_id as cat
          into v_ai',
  '               ai.cantidad - ai.cantidad_reducida as vigente, p2.codigo
          into v_ai');
select pg_temp._parche('public._normalizar_actividades_otrosi(uuid,jsonb)'::regprocedure,
  '  v_cobrado numeric;
  v_cat uuid;
begin', '  v_cobrado numeric;
begin');

select pg_temp._parche('public.actividades_para_otrosi(uuid)'::regprocedure,
  '                 ''mano_obra_categoria_id'', pr.cat,
                 ''disponible'', case when vg.id is null then 0
                                     when pr.cat is null then greatest(vg.cantidad - coalesce(k.total, 0), 0)
                                     else greatest(vg.cantidad - coalesce(k.completa, 0)
                                                   - coalesce((select kc.total from contratado_cat kc
                                                                where kc.codigo = pr.codigo and kc.cat = pr.cat), 0), 0) end',
  '                 ''disponible'', case when vg.id is null then 0 else greatest(vg.cantidad - coalesce(k.total, 0), 0) end');
select pg_temp._parche('public.actividades_para_otrosi(uuid)'::regprocedure,
  ', p2.codigo,
             ai.mano_obra_categoria_id as cat
        from contrato_anexo_items ai', ', p2.codigo
        from contrato_anexo_items ai');
select pg_temp._parche('public.actividades_para_otrosi(uuid)'::regprocedure,
  '    with contratado_cat as (
      select p2.codigo, ai.mano_obra_categoria_id as cat, sum(ai.cantidad - ai.cantidad_reducida) as total
        from contrato_anexo_items ai
        join contratos c2 on c2.id = ai.contrato_id
        join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
       where p2.presupuesto_id = v_presupuesto and c2.estado <> ''rechazada''
       group by p2.codigo, ai.mano_obra_categoria_id
    ),
    contratado as (
      select codigo,
             coalesce(sum(total) filter (where cat is null), 0) + coalesce(max(total) filter (where cat is not null), 0) as total,
             coalesce(sum(total) filter (where cat is null), 0) as completa
        from contratado_cat
       group by codigo
    ),',
  '    with contratado as (
      select p2.codigo, sum(ai.cantidad - ai.cantidad_reducida) as total
        from contrato_anexo_items ai
        join contratos c2 on c2.id = ai.contrato_id
        join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
       where p2.presupuesto_id = v_presupuesto and c2.estado <> ''rechazada''
       group by p2.codigo
    ),');

select pg_temp._parche('public.items_presupuesto_para_contrato(uuid)'::regprocedure,
  '  with contratado as (
    -- Visto desde la mano de obra completa: lo completo + el trabajo más
    -- contratado (20270101004400).
    select y.codigo,
           coalesce(sum(y.total) filter (where y.cat is null), 0)
             + coalesce(max(y.total) filter (where y.cat is not null), 0) as total
    from (
      select p2.codigo, ai.mano_obra_categoria_id as cat, sum(ai.cantidad - ai.cantidad_reducida) as total
      from contrato_anexo_items ai
      join contratos c on c.id = ai.contrato_id
      join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
      where p2.presupuesto_id = v_presupuesto and c.estado <> ''rechazada''
      group by p2.codigo, ai.mano_obra_categoria_id
    ) y
    group by y.codigo
  ),',
  '  with contratado as (
    select p2.codigo, sum(ai.cantidad - ai.cantidad_reducida) as total
    from contrato_anexo_items ai
    join contratos c on c.id = ai.contrato_id
    join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
    where p2.presupuesto_id = v_presupuesto and c.estado <> ''rechazada''
    group by p2.codigo
  ),');

select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '  insert into contrato_anexo_items (contrato_id, orden, presupuesto_item_id, actividad, unidad, cantidad, valor_unitario, sin_mano_obra, tope_valor_unitario,
                                    mano_obra_categoria_id)
  select p_id, t.ord, pi.id, pi.descripcion || coalesce('' — '' || moc.categoria, ''''), coalesce(nullif(trim(pi.unidad), ''''), ''und''),
         (t.v->>''cantidad'')::numeric, (t.v->>''valor_unitario'')::numeric,
         v_tipo = ''mano_obra'' and public._valor_mano_obra_item(pi.id) = 0,
         public._tope_linea_contrato(pi.id, v_tipo, moc.id),
         moc.id
  from jsonb_array_elements(coalesce(p_items, ''[]'')) with ordinality as t(v, ord)
  join presupuesto_items pi on pi.id = (t.v->>''presupuesto_item_id'')::uuid
  left join mano_obra_categorias moc on moc.id = nullif(t.v->>''mano_obra_categoria_id'', '''')::uuid;',
  '  insert into contrato_anexo_items (contrato_id, orden, presupuesto_item_id, actividad, unidad, cantidad, valor_unitario, sin_mano_obra, tope_valor_unitario)
  select p_id, t.ord, pi.id, pi.descripcion, coalesce(nullif(trim(pi.unidad), ''''), ''und''),
         (t.v->>''cantidad'')::numeric, (t.v->>''valor_unitario'')::numeric,
         v_tipo = ''mano_obra'' and public._valor_mano_obra_item(pi.id) = 0,
         public._tope_valor_unitario_item(pi.id, v_tipo)
  from jsonb_array_elements(coalesce(p_items, ''[]'')) with ordinality as t(v, ord)
  join presupuesto_items pi on pi.id = (t.v->>''presupuesto_item_id'')::uuid;');
select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '      v_disponible := v_pi.cantidad - public._contratado_linea(v_presupuesto, v_pi.codigo, v_trabajo);',
  '      v_disponible := v_pi.cantidad - public._contratado_item(v_presupuesto, v_pi.codigo);');
select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '      perform public._validar_trabajo_contrato(v_pi.id, v_tipo, v_trabajo);
      v_tope := public._tope_linea_contrato(v_pi.id, v_tipo, v_trabajo);',
  '      v_tope := public._tope_valor_unitario_item(v_pi.id, v_tipo);');
select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '      v_trabajo := nullif(d->>''mano_obra_categoria_id'', '''')::uuid;
      v_cantidad := (d->>''cantidad'')::numeric;',
  '      v_cantidad := (d->>''cantidad'')::numeric;');
select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '    -- Un ítem puede ir varias veces si cada vez es un trabajo distinto (20270101004400).
    if (select count(distinct (e->>''presupuesto_item_id'') || ''|'' || coalesce(nullif(e->>''mano_obra_categoria_id'', ''''), ''''))
          from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items) then
      raise exception ''Hay un ítem del presupuesto (o un trabajo) repetido en el anexo.'';
    end if;
    if exists (select 1 from jsonb_array_elements(p_items) e1
                 join jsonb_array_elements(p_items) e2 on e2->>''presupuesto_item_id'' = e1->>''presupuesto_item_id''
                where nullif(e1->>''mano_obra_categoria_id'', '''') is null
                  and nullif(e2->>''mano_obra_categoria_id'', '''') is not null) then
      raise exception ''Un ítem no puede ir completo y por trabajos en el mismo contrato.'';
    end if;',
  '    if (select count(distinct e->>''presupuesto_item_id'') from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items) then
      raise exception ''Hay un ítem del presupuesto repetido en el anexo.'';
    end if;');
select pg_temp._parche('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure,
  '  v_disponible numeric;
  v_trabajo uuid;
  d jsonb;', '  v_disponible numeric;
  d jsonb;');

create or replace function public._contratado_item(p_presupuesto_id uuid, p_codigo text)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(sum(ai.cantidad - ai.cantidad_reducida), 0)
  from public.contrato_anexo_items ai
  join public.contratos c on c.id = ai.contrato_id
  join public.presupuesto_items p2 on p2.id = ai.presupuesto_item_id
  where p2.presupuesto_id = p_presupuesto_id and p2.codigo = p_codigo
    and c.estado <> 'rechazada'
$function$;

drop function if exists public.juntar_mano_obra_item(uuid);
drop function if exists public.dividir_mano_obra_item(uuid, text[]);
drop function if exists public.info_division_mano_obra(uuid);
drop function if exists public.trabajos_items_contrato(uuid);
drop function if exists public._validar_trabajo_contrato(uuid, text, uuid);
drop function if exists public._tope_linea_contrato(uuid, text, uuid);
drop function if exists public._contratado_linea(uuid, text, uuid);
drop function if exists public._trabajos_item(uuid);

commit;
