-- ---------------------------------------------------------------------------
-- Póliza según el contrato (revisión por roles 2026-10-22, E7; decisión del
-- usuario): Obra (a todo costo) y Mano de obra SIEMPRE piden póliza. Los demás
-- tipos (y los contratos generales) dicen en la solicitud si la requieren
-- (casilla del ingeniero). Si no la requieren, al aprobarse la minuta el
-- contrato queda con la póliza "no_aplica": se pueden hacer actas sin póliza y
-- no aparece en Pólizas. Antes todos quedaban "pendiente" y un contrato sin
-- garantías no podía tener actas.
--
-- contratos.requiere_poliza (por omisión true: lo de antes sigue pidiéndola).
-- Lo fijan crear / reenviar la solicitud y el contrato general, después de
-- guardarla. Se puede correr dos veces.
-- ---------------------------------------------------------------------------

alter table public.contratos add column if not exists requiere_poliza boolean not null default true;
comment on column public.contratos.requiere_poliza is
  'Si el contrato pide póliza. Obra y mano de obra, siempre; los demás, según la solicitud.';

alter table public.contratos drop constraint if exists contratos_poliza_estado_check;
alter table public.contratos add constraint contratos_poliza_estado_check
  check (poliza_estado is null or poliza_estado in ('pendiente', 'recibida', 'aprobada', 'no_aplica'));

-- Lo que pide la solicitud: obra y mano de obra siempre; los demás, la casilla.
create or replace function public._fijar_requiere_poliza(p_id uuid, p_datos jsonb)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  update public.contratos c
     set requiere_poliza = c.tipo in ('obra', 'mano_obra')
                           or coalesce((p_datos->>'requiere_poliza')::boolean, true)
   where c.id = p_id;
$function$;
revoke all on function public._fijar_requiere_poliza(uuid, jsonb) from public, anon, authenticated;

create or replace function public.crear_solicitud_contrato(p_id uuid, p_datos jsonb, p_obligaciones jsonb, p_entregables jsonb, p_items jsonb, p_documentos jsonb)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v bigint;
begin
  v := public._guardar_solicitud_contrato(p_id, p_datos, p_obligaciones, p_entregables, p_items, p_documentos, false);
  perform public._fijar_requiere_poliza(p_id, p_datos);
  return v;
end;
$function$;

create or replace function public.reenviar_solicitud_contrato(p_id uuid, p_datos jsonb, p_obligaciones jsonb, p_entregables jsonb, p_items jsonb, p_documentos jsonb)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v bigint;
begin
  v := public._guardar_solicitud_contrato(p_id, p_datos, p_obligaciones, p_entregables, p_items, p_documentos, true);
  perform public._fijar_requiere_poliza(p_id, p_datos);
  return v;
end;
$function$;

create or replace function public.crear_contrato_general(p_id uuid, p_datos jsonb, p_documentos jsonb)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v bigint;
begin
  v := public._guardar_contrato_general(p_id, p_datos, p_documentos, false);
  perform public._fijar_requiere_poliza(p_id, p_datos);
  return v;
end;
$function$;

create or replace function public.reenviar_contrato_general(p_id uuid, p_datos jsonb, p_documentos jsonb)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v bigint;
begin
  v := public._guardar_contrato_general(p_id, p_datos, p_documentos, true);
  perform public._fijar_requiere_poliza(p_id, p_datos);
  return v;
end;
$function$;

-- Al aprobar la minuta: pendiente si pide póliza; si no, no_aplica.
create or replace function public._poliza_al_aprobar_minuta()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.minuta_estado = 'aprobada' and old.minuta_estado is distinct from 'aprobada'
     and new.estado = 'aprobada' and new.poliza_estado is null and new.liquidado_at is null then
    new.poliza_estado := case when new.requiere_poliza then 'pendiente' else 'no_aplica' end;
  end if;
  return new;
end;
$function$;
revoke all on function public._poliza_al_aprobar_minuta() from public, anon, authenticated;

-- Reemplazos puntuales en funciones vivas (fallan si el texto no está).
do $$
declare
  v_fn regprocedure;
  v_def text;
  v_nuevo text;
  v_viejo text;
  v_por text;
  r record;
begin
  for r in
    select * from (values
      -- Actas: con póliza aprobada o sin póliza que aplique.
      ('public._guardar_acta(uuid,uuid,jsonb)',
       '(v_info->>''poliza_estado'') is distinct from ''aprobada''',
       'coalesce(v_info->>''poliza_estado'', '''') not in (''aprobada'', ''no_aplica'')'),
      -- Pólizas: los que no aplican no salen para subir.
      ('public.buscar_contratos_para_poliza(text,uuid)',
       'c.poliza_estado is not null',
       'c.poliza_estado is not null and c.poliza_estado <> ''no_aplica'''),
      ('public.buscar_contratistas_para_poliza(text)',
       'c.poliza_estado is not null',
       'c.poliza_estado is not null and c.poliza_estado <> ''no_aplica'''),
      ('public.subir_poliza(uuid,text,text,bigint,text)',
       'if c.poliza_estado is null then',
       'if c.poliza_estado = ''no_aplica'' then
    raise exception ''Este contrato no requiere póliza: la solicitud dice que no la pide.'';
  end if;
  if c.poliza_estado is null then')
    ) as t(fn, viejo, por)
  loop
    v_fn := to_regprocedure(r.fn);
    if v_fn is null then
      raise exception 'No existe la función %', r.fn;
    end if;
    v_def := pg_get_functiondef(v_fn);
    if position(r.por in v_def) > 0 then
      continue;  -- ya aplicado
    end if;
    if position(r.viejo in v_def) = 0 then
      raise exception 'No se encontró el texto esperado en %', r.fn;
    end if;
    execute replace(v_def, r.viejo, r.por);
  end loop;
end $$;
