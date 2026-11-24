-- Reversa de 20270101006100: deshace los parches, quita la revisión por cambio de tercero
-- y deja _tercero_a_proveedor como antes. Las revisiones guardadas se borran.

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
  -- Al revés: el texto viejo puede estar dentro del nuevo, así que solo se mira el nuevo.
  if position(p_a in d) = 0 then
    return;
  end if;
  execute replace(d, p_a, p_b);
end;
$f$;

select pg_temp._parche('public.actualizar_contacto_tercero(uuid, jsonb)'::regprocedure,
$a$  -- Solo Financiera y el Administrador (20270101006100).
  if not public.tiene_accion(auth.uid(), 'editar_terceros') then$a$,
$b$  if not (public.tiene_accion(auth.uid(), 'editar_terceros')
          or public.tiene_accion(auth.uid(), 'editar_proveedores')
          or public.tiene_accion(auth.uid(), 'gestionar_contratistas')) then$b$);

select pg_temp._parche('public.crear_orden_compra_con_soporte(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, numeric, text, date, jsonb, jsonb, text, date)'::regprocedure,
$a$    raise exception 'Ese archivo ya es soporte de otra orden. Vuelve a adjuntarlo.';
  end if;
  if public._en_revision_tercero('proveedor', p_proveedor_id) then
    raise exception 'El proveedor está en revisión: Financiera cambió su tercero. Compras tiene que revisarlo (Proveedores) antes de hacerle órdenes nuevas.';
  end if;

  v_id := public.crear_orden_compra($a$,
$b$    raise exception 'Ese archivo ya es soporte de otra orden. Vuelve a adjuntarlo.';
  end if;

  v_id := public.crear_orden_compra($b$);

select pg_temp._parche('public.modificar_orden_compra(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, text, date, numeric, text, date, jsonb, jsonb)'::regprocedure,
$a$    raise exception 'Elige el proveedor de la orden.';
  end if;
  if p_proveedor_id is distinct from v_o.proveedor_id and public._en_revision_tercero('proveedor', p_proveedor_id) then
    raise exception 'Ese proveedor está en revisión: Financiera cambió su tercero. Compras tiene que revisarlo antes de usarlo.';
  end if;$a$,
$b$    raise exception 'Elige el proveedor de la orden.';
  end if;$b$);

select pg_temp._parche('public._guardar_contrato_general(uuid, jsonb, jsonb, boolean)'::regprocedure,
$a$  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para elaborar contratos.';
  end if;
  if not p_existente and public._en_revision_tercero('contratista', nullif(p_datos->>'contratista_id', '')::uuid) then
    raise exception 'El contratista está en revisión: Financiera cambió su tercero. Quien lo creó tiene que revisarlo antes de hacerle contratos nuevos.';
  end if;$a$,
$b$  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para elaborar contratos.';
  end if;$b$);

select pg_temp._parche('public._guardar_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, boolean)'::regprocedure,
$a$  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para solicitar contratos.';
  end if;
  if not p_existente and public._en_revision_tercero('contratista', nullif(p_datos->>'contratista_id', '')::uuid) then
    raise exception 'El contratista está en revisión: Financiera cambió su tercero. Quien lo creó tiene que revisarlo antes de hacerle contratos nuevos.';
  end if;$a$,
$b$  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para solicitar contratos.';
  end if;$b$);

create or replace function pg_temp._quitar_bloque(p_fn regprocedure)
returns void language plpgsql as $f$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
  i int := position('  -- ------------------------------------------------ Proveedores y contratistas en revisión (20270101006100)' in d);
  j int := position('  -- ------------------------------------------------ Soportes de cuadros de SINCO (20270101002800)' in d);
begin
  if i = 0 then return; end if;
  execute left(d, i - 1) || substr(d, j);
end;
$f$;
select pg_temp._quitar_bloque('public._pendientes_de(uuid)'::regprocedure);

create or replace function public._tercero_a_proveedor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (new.tipo_documento, new.numero_documento, new.razon_social, new.correo, new.telefono, new.direccion, new.ciudad)
     is distinct from (old.tipo_documento, old.numero_documento, old.razon_social, old.correo, old.telefono, old.direccion, old.ciudad) then
    update public.proveedores set tercero_id = tercero_id where tercero_id = new.id;
  end if;
  return null;
end;
$function$;

drop trigger if exists trg_tercero_pide_revision on public.terceros;
drop function if exists public._tercero_pide_revision();
drop function if exists public.marcar_revisado_tercero(text, uuid);
drop function if exists public.en_revision_tercero(text);
drop function if exists public.revision_tercero(text, uuid);
drop function if exists public._etiqueta_campo_tercero(text);
drop function if exists public._en_revision_tercero(text, uuid);
drop table if exists public.revisiones_tercero;
delete from public.rol_permisos where permiso = 'accion.revisar_proveedores';

commit;
