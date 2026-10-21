-- Contratistas -> Terceros, y bancos administrables (hallazgo E5 de la revisión
-- por roles; decisiones del usuario 2026-10-21).
--
-- Antes, Contratistas (Contratos) y Terceros (A&F) eran listas separadas: el
-- pago de un acta buscaba en Terceros el documento del contratista y, si no
-- estaba, quedaba "Sin tercero" y Financiera tenía que crearlo a mano con los
-- mismos datos que ya se habían escrito en el contratista.
--
-- Ahora:
--   1. El banco del contratista sale de la lista de bancos (la misma de
--      Terceros) y la base lo exige al crear o al cambiar los datos bancarios.
--      El número de documento es solo números (el DV sigue en su casilla).
--   2. Al CREAR un contratista, o al CAMBIAR sus datos bancarios, la base crea
--      el tercero con ese documento si no existe (si existe, no lo duplica) y
--      le agrega la cuenta SIEMPRE PENDIENTE de verificar (aunque lo haga
--      alguien que puede verificar): Financiera la verifica con la
--      certificación bancaria a la vista. La cuenta anterior no se toca.
--   3. Los pagos de actas que estaban "Sin tercero" toman el tercero solos
--      cuando este se crea (desde Contratistas o a mano en Terceros), y toman
--      la cuenta sola cuando el tercero queda con UNA cuenta verificada (misma
--      regla que ya usaba el pago al crearse). Solo pagos que todavía se
--      pueden modificar (programado, solicitado, aprobado, liquidado).
--   4. certificacion_bancaria_tercero(tercero): quien tiene la acción
--      Verificar cuentas de terceros ve y descarga la certificación bancaria
--      del contratista con ese documento (política nueva de lectura en el
--      bucket privado "contratistas", solo para esos archivos).
--   5. Admin › Bancos: guardar_banco y listar_bancos_admin (solo
--      Administrador). Renombrar un banco actualiza el nombre en los
--      contratistas que lo usan (las cuentas de terceros apuntan al id).
--
-- Los 10 contratistas de prueba que ya existen no se convierten (decisión del
-- usuario): sus bancos están escritos a mano y la base solo valida el banco
-- cuando se cambia.

-- =================================================================== DATOS
-- Documento del contratista: solo números (antes aceptaba letras para
-- pasaporte / PPT). Terceros ya exigía solo números.
alter table public.contratistas drop constraint if exists contratistas_numero_documento_check;
alter table public.contratistas add constraint contratistas_numero_documento_check
  check (numero_documento ~ '^[0-9]{3,20}$');

-- ========================================================== VALIDAR BANCO
-- Al renombrar un banco (guardar_banco) se actualizan los contratistas con
-- esta bandera puesta: no se valida ni se crea cuenta ni historial por eso.
create or replace function public._renombrando_banco()
returns boolean language sql stable set search_path to 'public' as $function$
  select coalesce(current_setting('app.renombrando_banco', true), '') = 'si'
$function$;
revoke all on function public._renombrando_banco() from public, anon, authenticated;

create or replace function public._contratista_validar_banco()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public._renombrando_banco() then
    return new;
  end if;
  if tg_op = 'INSERT' or new.banco is distinct from old.banco then
    if not exists (select 1 from public.bancos b where b.nombre = new.banco and b.activo) then
      raise exception 'Elige el banco de la lista.';
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function public._contratista_validar_banco() from public, anon, authenticated;

drop trigger if exists trg_contratista_validar_banco on public.contratistas;
create trigger trg_contratista_validar_banco
  before insert or update of banco on public.contratistas
  for each row execute function public._contratista_validar_banco();

-- ================================================ PAGOS QUE ESPERAN TERCERO
-- Engancha a un tercero los pagos de actas de contratistas con su documento
-- que siguen sin tercero, y les pone la cuenta si el tercero tiene UNA sola
-- verificada. Recalcula la novedad de los pagos que tocó.
create or replace function public._enlazar_pagos_tercero(p_tercero_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_documento text;
  v_cuenta uuid;
  v_pago uuid;
begin
  select numero_documento into v_documento from public.terceros where id = p_tercero_id;
  if v_documento is null then
    return;
  end if;

  select tc.id into v_cuenta
    from public.terceros_cuentas tc
   where tc.tercero_id = p_tercero_id and tc.estado = 'ACTIVO'
     and (select count(*) from public.terceros_cuentas x
           where x.tercero_id = p_tercero_id and x.estado = 'ACTIVO') = 1;

  for v_pago in
    update public.pagos pg
       set tercero_id = p_tercero_id
     where pg.tercero_id is null
       and pg.fuente = 'acta'
       and pg.estado in ('programado', 'solicitado', 'aprobado', 'liquidado')
       and exists (select 1 from public.actas a
                     join public.contratos c on c.id = a.contrato_id
                     join public.contratistas k on k.id = c.contratista_id
                    where a.id = pg.acta_id and k.numero_documento = v_documento)
    returning pg.id
  loop
    perform public._pago_actualizar_novedad(v_pago);
  end loop;

  if v_cuenta is not null then
    for v_pago in
      update public.pagos pg
         set cuenta_tercero_id = v_cuenta
       where pg.tercero_id = p_tercero_id
         and pg.cuenta_tercero_id is null
         and pg.estado in ('programado', 'solicitado', 'aprobado', 'liquidado')
      returning pg.id
    loop
      perform public._pago_actualizar_novedad(v_pago);
    end loop;
  end if;
end;
$function$;
revoke all on function public._enlazar_pagos_tercero(uuid) from public, anon, authenticated;

create or replace function public._tercero_enlazar_pagos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fila jsonb := to_jsonb(new);
begin
  -- to_jsonb: terceros tiene "id" y terceros_cuentas "tercero_id" (leer un
  -- campo que el registro no tiene falla aunque esa rama no se use).
  perform public._enlazar_pagos_tercero(
    (case when tg_table_name = 'terceros' then v_fila ->> 'id' else v_fila ->> 'tercero_id' end)::uuid);
  return null;
end;
$function$;
revoke all on function public._tercero_enlazar_pagos() from public, anon, authenticated;

drop trigger if exists trg_tercero_enlazar_pagos on public.terceros;
create trigger trg_tercero_enlazar_pagos
  after insert on public.terceros
  for each row execute function public._tercero_enlazar_pagos();

-- Una cuenta verificada (nueva activa o que pasa a activa) puede completar pagos.
drop trigger if exists trg_cuenta_enlazar_pagos on public.terceros_cuentas;
create trigger trg_cuenta_enlazar_pagos
  after insert or update of estado on public.terceros_cuentas
  for each row
  when (new.estado = 'ACTIVO')
  execute function public._tercero_enlazar_pagos();

-- ==================================================== CONTRATISTA -> TERCERO
create or replace function public._contratista_a_tercero()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tercero uuid;
  v_banco uuid;
begin
  if public._renombrando_banco() then
    return null;
  end if;
  -- Al editar, solo cuando cambian los datos bancarios.
  if tg_op = 'UPDATE'
     and (new.banco, new.tipo_cuenta, new.numero_cuenta) is not distinct from (old.banco, old.tipo_cuenta, old.numero_cuenta) then
    return null;
  end if;

  select t.id into v_tercero from public.terceros t where t.numero_documento = new.numero_documento limit 1;
  if v_tercero is null then
    insert into public.terceros (tipo_documento, numero_documento, dv, razon_social, observaciones)
    values (new.tipo_documento, new.numero_documento, new.digito_verificacion::text, new.nombre,
            'Creado desde Contratistas.')
    returning id into v_tercero;
  end if;

  select b.id into v_banco from public.bancos b where b.nombre = new.banco;
  if v_banco is not null
     and new.numero_cuenta is not null
     and not exists (select 1 from public.terceros_cuentas tc
                      where tc.tercero_id = v_tercero and tc.banco_id = v_banco
                        and tc.numero_cuenta = new.numero_cuenta) then
    -- PENDIENTE siempre: la verifica Financiera con la certificación a la vista.
    insert into public.terceros_cuentas (tercero_id, banco_id, tipo_cuenta, numero_cuenta, etiqueta, estado)
    values (v_tercero, v_banco, upper(new.tipo_cuenta), new.numero_cuenta, 'Desde Contratistas', 'PENDIENTE');
  end if;

  -- Si el tercero ya existía, sus pagos de actas pendientes lo toman aquí
  -- (cuando se crea, lo hace el disparador de terceros).
  perform public._enlazar_pagos_tercero(v_tercero);
  return null;
end;
$function$;
revoke all on function public._contratista_a_tercero() from public, anon, authenticated;

drop trigger if exists trg_contratista_a_tercero on public.contratistas;
create trigger trg_contratista_a_tercero
  after insert or update of banco, tipo_cuenta, numero_cuenta on public.contratistas
  for each row execute function public._contratista_a_tercero();

-- Historial de contratistas: igual que en 20261118200000, pero sin anotar el
-- cambio de nombre de un banco hecho desde Admin › Bancos.
create or replace function public._historial_contratista()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cambios jsonb;
begin
  if public._renombrando_banco() then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public._anotar_historial('contratista', new.id, 'creado',
      jsonb_build_object('nombre', new.nombre, 'documento', new.tipo_documento || ' ' || new.numero_documento));
    return null;
  end if;

  v_cambios := public._jsonb_cambios(to_jsonb(old), to_jsonb(new),
    array['id', 'created_by', 'created_at', 'updated_at', 'updated_by', 'banco', 'tipo_cuenta', 'numero_cuenta']);
  -- Los datos bancarios solo los ve quien tiene ver_datos_bancarios: aquí solo consta que cambiaron.
  if (new.banco, new.tipo_cuenta, new.numero_cuenta) is distinct from (old.banco, old.tipo_cuenta, old.numero_cuenta) then
    v_cambios := coalesce(v_cambios, '{}'::jsonb)
      || jsonb_build_object('datos_bancarios', jsonb_build_object('de', '(reservado)', 'a', '(reservado)'));
  end if;
  if v_cambios is not null then
    perform public._anotar_historial('contratista', new.id, 'editado', jsonb_build_object('cambios', v_cambios));
  end if;
  return null;
end;
$function$;

-- ================================================= CERTIFICACIÓN BANCARIA
-- Rutas de todas las certificaciones bancarias de contratistas (para la
-- política del bucket: quien verifica cuentas solo lee estos archivos).
create or replace function public._rutas_certificaciones_bancarias()
returns setof text language sql stable security definer set search_path to 'public' as $function$
  select d.ruta from public.contratista_documentos d where d.tipo = 'certificacion_bancaria'
$function$;
revoke all on function public._rutas_certificaciones_bancarias() from public, anon;
grant execute on function public._rutas_certificaciones_bancarias() to authenticated;

drop policy if exists contratistas_certificacion_verificar on storage.objects;
create policy contratistas_certificacion_verificar on storage.objects
  for select to authenticated
  using (
    bucket_id = 'contratistas'
    and (select public.tiene_accion((select auth.uid()), 'verificar_terceros'))
    and name in (select public._rutas_certificaciones_bancarias())
  );

-- La certificación del contratista con el documento de este tercero (o null).
create or replace function public.certificacion_bancaria_tercero(p_tercero_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.tiene_accion(auth.uid(), 'verificar_terceros') then
    raise exception 'Solo quien verifica cuentas de terceros ve la certificación bancaria.';
  end if;
  return (
    select jsonb_build_object('ruta', d.ruta, 'nombre_archivo', d.nombre_archivo, 'mime', d.mime,
                              'subido_at', d.subido_at, 'contratista', k.nombre)
      from public.terceros t
      join public.contratistas k on k.numero_documento = t.numero_documento
      join public.contratista_documentos d on d.contratista_id = k.id and d.tipo = 'certificacion_bancaria'
     where t.id = p_tercero_id
     order by d.subido_at desc
     limit 1
  );
end;
$function$;
revoke all on function public.certificacion_bancaria_tercero(uuid) from public, anon;
grant execute on function public.certificacion_bancaria_tercero(uuid) to authenticated;

-- ======================================================= ADMIN › BANCOS
create or replace function public.listar_bancos_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform public._exigir_administrador();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', b.id, 'nombre', b.nombre, 'codigo', b.codigo, 'activo', b.activo,
             'cuentas', (select count(*) from public.terceros_cuentas tc where tc.banco_id = b.id),
             'contratistas', (select count(*) from public.contratistas k where k.banco = b.nombre)
           ) order by b.nombre)
      from public.bancos b
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.listar_bancos_admin() from public, anon;
grant execute on function public.listar_bancos_admin() to authenticated;

-- p_id null = banco nuevo. Devuelve el id.
create or replace function public.guardar_banco(p_id uuid, p_nombre text, p_codigo text, p_activo boolean)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_nombre text := upper(btrim(coalesce(p_nombre, '')));
  v_codigo text := nullif(btrim(coalesce(p_codigo, '')), '');
  v_anterior text;
  v_id uuid;
begin
  perform public._exigir_administrador();
  if length(v_nombre) < 2 then
    raise exception 'Escribe el nombre del banco.';
  end if;
  if v_codigo is not null and v_codigo !~ '^[0-9]{3}$' then
    raise exception 'El código del banco son 3 números.';
  end if;
  if exists (select 1 from public.bancos where nombre = v_nombre and id is distinct from p_id) then
    raise exception 'Ya existe un banco con ese nombre.';
  end if;

  if p_id is null then
    insert into public.bancos (nombre, codigo, activo)
    values (v_nombre, v_codigo, coalesce(p_activo, true))
    returning id into v_id;
    return v_id;
  end if;

  select nombre into v_anterior from public.bancos where id = p_id for update;
  if v_anterior is null then
    raise exception 'El banco no existe.';
  end if;
  update public.bancos set nombre = v_nombre, codigo = v_codigo, activo = coalesce(p_activo, activo) where id = p_id;

  if v_anterior <> v_nombre then
    perform set_config('app.renombrando_banco', 'si', true);
    update public.contratistas set banco = v_nombre where banco = v_anterior;
    perform set_config('app.renombrando_banco', '', true);
  end if;
  return p_id;
end;
$function$;
revoke all on function public.guardar_banco(uuid, text, text, boolean) from public, anon;
grant execute on function public.guardar_banco(uuid, text, text, boolean) to authenticated;
