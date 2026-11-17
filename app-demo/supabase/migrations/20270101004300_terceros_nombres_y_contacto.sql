-- Terceros: nombre en 4 casillas y datos de contacto en un solo lugar (decisiones del
-- usuario, 2026-11-17).
-- 1. Personas (no NIT): primer nombre y primer apellido (obligatorios) y segundo nombre y
--    segundo apellido (opcionales). La razón social, los nombres, los apellidos y el nombre
--    para el banco se arman solos (_tercero_nombre): razón social = apellidos + nombres
--    (como ya está), nombre para el banco = nombres + apellidos (como ya está). Ya no se
--    escribe el nombre para el banco a mano; en un NIT es la razón social.
--    A los terceros que ya existen no se les cambia nada mientras nadie edite su nombre.
-- 2. Correo, teléfono, dirección y ciudad viven en el TERCERO (obligatorios al crearlo).
--    Contratistas y proveedores guardan una copia que ponen sus disparadores
--    (_contratista_desde_tercero, _proveedor_desde_tercero) y que se actualiza cuando el
--    tercero cambia. Se cambian con actualizar_contacto_tercero (A&F, Compras o quien
--    gestiona contratistas).
-- 3. Los terceros sin contacto lo toman del contratista o del proveedor que ya lo tenía
--    (solo se llenan campos vacíos).
-- Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';
lock table public.terceros, public.contratistas, public.proveedores in access exclusive mode;

alter table public.terceros add column if not exists primer_nombre text;
alter table public.terceros add column if not exists segundo_nombre text;
alter table public.terceros add column if not exists primer_apellido text;
alter table public.terceros add column if not exists segundo_apellido text;
alter table public.terceros add column if not exists correo text;
alter table public.terceros add column if not exists telefono text;
alter table public.terceros add column if not exists direccion text;
alter table public.terceros add column if not exists ciudad text;

-- 1. El nombre se arma de las casillas --------------------------------------------------
create or replace function public._tercero_nombre()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_nombres text;
  v_apellidos text;
begin
  new.primer_nombre := nullif(upper(btrim(regexp_replace(coalesce(new.primer_nombre, ''), '\s+', ' ', 'g'))), '');
  new.segundo_nombre := nullif(upper(btrim(regexp_replace(coalesce(new.segundo_nombre, ''), '\s+', ' ', 'g'))), '');
  new.primer_apellido := nullif(upper(btrim(regexp_replace(coalesce(new.primer_apellido, ''), '\s+', ' ', 'g'))), '');
  new.segundo_apellido := nullif(upper(btrim(regexp_replace(coalesce(new.segundo_apellido, ''), '\s+', ' ', 'g'))), '');
  if new.tipo_documento <> 'NIT' and new.primer_nombre is not null and new.primer_apellido is not null then
    v_nombres := btrim(new.primer_nombre || ' ' || coalesce(new.segundo_nombre, ''));
    v_apellidos := btrim(new.primer_apellido || ' ' || coalesce(new.segundo_apellido, ''));
    new.nombres := v_nombres;
    new.apellidos := v_apellidos;
    new.razon_social := v_apellidos || ' ' || v_nombres;
    new.nombre_banco := left(v_nombres || ' ' || v_apellidos, 40);
  elsif new.tipo_documento = 'NIT'
        and (tg_op = 'INSERT' or new.razon_social is distinct from old.razon_social) then
    new.nombre_banco := left(new.razon_social, 40);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_tercero_nombre on public.terceros;
create trigger trg_tercero_nombre before insert or update of primer_nombre, segundo_nombre, primer_apellido,
  segundo_apellido, razon_social, tipo_documento on public.terceros
  for each row execute function public._tercero_nombre();

-- 2. Contacto: validar y guardar ---------------------------------------------------------
create or replace function public._validar_contacto_tercero(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_correo text := lower(btrim(coalesce(p ->> 'correo', '')));
  v_tel text := regexp_replace(coalesce(p ->> 'telefono', ''), '[\s\-\(\)\.]', '', 'g');
  v_dir text := btrim(regexp_replace(coalesce(p ->> 'direccion', ''), '\s+', ' ', 'g'));
  v_ciudad text := upper(btrim(regexp_replace(coalesce(p ->> 'ciudad', ''), '\s+', ' ', 'g')));
begin
  if v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Escribe un correo válido.';
  end if;
  if v_tel !~ '^\+?[0-9]{7,15}$' then
    raise exception 'Escribe un teléfono de 7 a 15 números.';
  end if;
  if v_dir = '' then
    raise exception 'Escribe la dirección (calle y número).';
  end if;
  if length(v_dir) > 200 then
    raise exception 'La dirección es demasiado larga (máximo 200).';
  end if;
  if v_ciudad = '' then
    raise exception 'Escribe la ciudad.';
  end if;
  if length(v_ciudad) > 100 then
    raise exception 'La ciudad es demasiado larga (máximo 100).';
  end if;
  return jsonb_build_object('correo', v_correo, 'telefono', v_tel, 'direccion', v_dir, 'ciudad', v_ciudad);
end;
$$;

-- Cambia el contacto de un tercero (y con él la copia de su contratista y su proveedor).
-- Solo los datos que llegan (uno o varios); cada uno se valida y no se puede dejar vacío.
create or replace function public.actualizar_contacto_tercero(p_tercero_id uuid, p_contacto jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok jsonb := jsonb_build_object('correo', 'a@b.co', 'telefono', '1234567', 'direccion', 'x', 'ciudad', 'x');
  c jsonb;
  v_t record;
begin
  if not (public.tiene_accion(auth.uid(), 'editar_terceros')
          or public.tiene_accion(auth.uid(), 'editar_proveedores')
          or public.tiene_accion(auth.uid(), 'gestionar_contratistas')) then
    raise exception 'No tienes permiso para cambiar el contacto del tercero.';
  end if;
  if jsonb_typeof(p_contacto) is distinct from 'object' then
    raise exception 'Faltan los datos de contacto.';
  end if;
  -- Valida lo que llega (lo que no llega se rellena con valores válidos y no se guarda).
  c := public._validar_contacto_tercero(v_ok || (select coalesce(jsonb_object_agg(k, v), '{}')
                                                   from jsonb_each(p_contacto) e(k, v)
                                                  where k in ('correo', 'telefono', 'direccion', 'ciudad')));
  update public.terceros
     set correo = case when p_contacto ? 'correo' then c ->> 'correo' else correo end,
         telefono = case when p_contacto ? 'telefono' then c ->> 'telefono' else telefono end,
         direccion = case when p_contacto ? 'direccion' then c ->> 'direccion' else direccion end,
         ciudad = case when p_contacto ? 'ciudad' then c ->> 'ciudad' else ciudad end
   where id = p_tercero_id
  returning correo, telefono, direccion, ciudad into v_t;
  if not found then
    raise exception 'El tercero no existe.';
  end if;
  return jsonb_build_object('correo', v_t.correo, 'telefono', v_t.telefono, 'direccion', v_t.direccion, 'ciudad', v_t.ciudad);
end;
$$;
revoke all on function public.actualizar_contacto_tercero(uuid, jsonb) from public, anon;
grant execute on function public.actualizar_contacto_tercero(uuid, jsonb) to authenticated;

-- 3. Crear un tercero: casillas de nombre y contacto obligatorio -----------------------
create or replace function public.crear_tercero(p_datos jsonb, p_cuenta jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text := upper(btrim(coalesce(p_datos ->> 'tipo_documento', '')));
  v_numero text := regexp_replace(coalesce(p_datos ->> 'numero_documento', ''), '\D', '', 'g');
  v_dv text := nullif(regexp_replace(coalesce(p_datos ->> 'dv', ''), '\D', '', 'g'), '');
  v_razon text := upper(btrim(regexp_replace(coalesce(p_datos ->> 'razon_social', ''), '\s+', ' ', 'g')));
  v_pn text := nullif(upper(btrim(coalesce(p_datos ->> 'primer_nombre', ''))), '');
  v_sn text := nullif(upper(btrim(coalesce(p_datos ->> 'segundo_nombre', ''))), '');
  v_pa text := nullif(upper(btrim(coalesce(p_datos ->> 'primer_apellido', ''))), '');
  v_sa text := nullif(upper(btrim(coalesce(p_datos ->> 'segundo_apellido', ''))), '');
  v_obs text := nullif(btrim(coalesce(p_datos ->> 'observaciones', '')), '');
  v_contacto jsonb;
  v_banco uuid;
  v_tipo_cuenta text;
  v_num_cuenta text;
  v_id uuid;
  v_t record;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión.';
  end if;

  if v_tipo not in ('CC', 'NIT', 'CE', 'PPT', 'PA', 'TI', 'RC') then
    raise exception 'Escoge el tipo de documento.';
  end if;
  if v_numero = '' then
    raise exception 'Escribe el número de documento (solo números).';
  end if;
  if length(v_numero) > 15 then
    raise exception 'El documento no puede tener más de 15 dígitos.';
  end if;
  if v_tipo = 'NIT' then
    if v_dv is null or v_dv !~ '^[0-9]$' then
      raise exception 'Escribe el dígito de verificación del NIT.';
    end if;
    if v_dv::int <> public.dv_nit(v_numero) then
      raise exception 'El dígito de verificación no corresponde a este NIT. Revisa el NIT y el DV.';
    end if;
    if v_razon = '' then
      raise exception 'Escribe la razón social.';
    end if;
    v_pn := null; v_sn := null; v_pa := null; v_sa := null;
  else
    v_dv := null;
    if v_pn is null then
      raise exception 'Escribe el primer nombre.';
    end if;
    if v_pa is null then
      raise exception 'Escribe el primer apellido.';
    end if;
    v_razon := btrim(v_pa || ' ' || coalesce(v_sa, '')) || ' ' || btrim(v_pn || ' ' || coalesce(v_sn, ''));
  end if;
  if length(v_razon) > 150 then
    raise exception 'El nombre es demasiado largo (máximo 150).';
  end if;
  v_contacto := public._validar_contacto_tercero(p_datos);
  if exists (select 1 from public.terceros t where t.numero_documento = v_numero) then
    raise exception 'Ya existe un tercero con el documento %: búscalo en vez de crearlo.', v_numero;
  end if;

  if coalesce((p_datos ->> 'sin_cuenta')::boolean, false) then
    if p_cuenta is not null then
      raise exception 'Marcaste que no tiene cuenta bancaria: quita los datos de la cuenta.';
    end if;
  else
    if p_cuenta is null then
      raise exception 'Agrega la cuenta bancaria del tercero o marca que no tiene.';
    end if;
    if jsonb_typeof(p_cuenta -> 'certificacion') is distinct from 'object' then
      raise exception 'Adjunta la certificación bancaria.';
    end if;
  end if;
  if jsonb_typeof(p_datos -> 'rut') is distinct from 'object' then
    raise exception 'Adjunta el RUT.';
  end if;

  if p_cuenta is not null then
    v_banco := nullif(p_cuenta ->> 'banco_id', '')::uuid;
    v_tipo_cuenta := upper(btrim(coalesce(p_cuenta ->> 'tipo_cuenta', '')));
    v_num_cuenta := regexp_replace(coalesce(p_cuenta ->> 'numero_cuenta', ''), '\D', '', 'g');
    if v_banco is null or not exists (select 1 from public.bancos b where b.id = v_banco and b.activo) then
      raise exception 'Escoge el banco.';
    end if;
    if v_tipo_cuenta not in ('AHORROS', 'CORRIENTE') then
      raise exception 'Escoge el tipo de cuenta.';
    end if;
    if length(v_num_cuenta) < 5 or length(v_num_cuenta) > 17 then
      raise exception 'El número de cuenta debe tener entre 5 y 17 dígitos.';
    end if;
  end if;

  insert into public.terceros (tipo_documento, numero_documento, dv, razon_social, primer_nombre, segundo_nombre,
                               primer_apellido, segundo_apellido, correo, telefono, direccion, ciudad, observaciones)
  values (v_tipo, v_numero, v_dv, v_razon, v_pn, v_sn, v_pa, v_sa,
          v_contacto ->> 'correo', v_contacto ->> 'telefono', v_contacto ->> 'direccion', v_contacto ->> 'ciudad', v_obs)
  returning id into v_id;
  perform public._rut_tercero_nuevo(v_id, p_datos -> 'rut');

  if p_cuenta is not null then
    insert into public.terceros_cuentas (tercero_id, banco_id, tipo_cuenta, numero_cuenta, etiqueta, observaciones)
    values (v_id, v_banco, v_tipo_cuenta, v_num_cuenta,
            nullif(upper(btrim(regexp_replace(coalesce(p_cuenta ->> 'etiqueta', ''), '\s+', ' ', 'g'))), ''),
            nullif(btrim(coalesce(p_cuenta ->> 'observaciones', '')), ''));
    if p_cuenta ? 'certificacion' and jsonb_typeof(p_cuenta -> 'certificacion') = 'object' then
      perform public._certificacion_tercero_nuevo(v_id, p_cuenta -> 'certificacion');
    end if;
  end if;

  select razon_social, correo, telefono, direccion, ciudad into v_t from public.terceros where id = v_id;
  return jsonb_build_object('id', v_id, 'razon_social', v_t.razon_social, 'tipo_documento', v_tipo,
                            'numero_documento', v_numero, 'dv', v_dv, 'correo', v_t.correo, 'telefono', v_t.telefono,
                            'direccion', v_t.direccion, 'ciudad', v_t.ciudad);
exception
  when unique_violation then
    raise exception 'Ya existe un tercero con el documento %: búscalo en vez de crearlo.', v_numero;
end;
$$;
revoke all on function public.crear_tercero(jsonb, jsonb) from public, anon;
grant execute on function public.crear_tercero(jsonb, jsonb) to authenticated;

-- El tercero por documento trae también su contacto (para no pedirlo otra vez).
create or replace function public.tercero_por_documento(p_documento text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_numero text := regexp_replace(split_part(coalesce(p_documento, ''), '-', 1), '\D', '', 'g');
  v jsonb;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión.';
  end if;
  if v_numero = '' then
    return null;
  end if;
  select jsonb_build_object('id', t.id, 'razon_social', t.razon_social, 'tipo_documento', t.tipo_documento,
                            'numero_documento', t.numero_documento, 'dv', t.dv, 'correo', t.correo,
                            'telefono', t.telefono, 'direccion', t.direccion, 'ciudad', t.ciudad)
    into v
    from public.terceros t
   where t.numero_documento = v_numero;
  return v;
end;
$$;
revoke all on function public.tercero_por_documento(text) from public, anon;
grant execute on function public.tercero_por_documento(text) to authenticated;

-- 4. Contratistas y proveedores copian el contacto del tercero -------------------------
create or replace function public._contratista_desde_tercero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
begin
  select tipo_documento, numero_documento, dv, razon_social, correo, telefono, direccion, ciudad into t
    from public.terceros where id = new.tercero_id;
  if not found then
    raise exception 'El tercero del contratista no existe.';
  end if;
  if t.tipo_documento not in ('CC', 'CE', 'PPT', 'PA', 'NIT') then
    raise exception 'Un contratista se identifica con CC, CE, PPT, PA o NIT; el tercero tiene %.', t.tipo_documento;
  end if;
  new.tipo_documento := t.tipo_documento;
  new.numero_documento := t.numero_documento;
  new.digito_verificacion := nullif(t.dv, '')::smallint;
  new.nombre := t.razon_social;
  new.tipo_persona := case when t.tipo_documento = 'NIT' then 'juridica' else 'natural' end;
  -- El contacto es el del tercero (20270101004300); sin contacto en el tercero, el que trae.
  new.correo := coalesce(t.correo, new.correo);
  new.telefono := coalesce(t.telefono, new.telefono);
  new.direccion := coalesce(t.direccion, new.direccion);
  new.ciudad := coalesce(t.ciudad, new.ciudad);
  return new;
end;
$$;

create or replace function public._proveedor_desde_tercero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
begin
  if new.tercero_id is null then
    if tg_op = 'INSERT' then
      raise exception 'Busca el tercero por su documento (o créalo) antes de crear el proveedor.';
    end if;
    return new;  -- proveedor viejo sin tercero (sin documento): se puede seguir editando
  end if;
  select tipo_documento, numero_documento, razon_social, correo, telefono, direccion, ciudad into t
    from public.terceros where id = new.tercero_id;
  if not found then
    raise exception 'El tercero del proveedor no existe.';
  end if;
  new.nombre := t.razon_social;
  new.numero_documento := t.numero_documento::bigint;
  -- NIT si el tercero lo es o si el proveedor factura como NIT (mismo número).
  new.tipo_documento := case when t.tipo_documento = 'NIT' or new.tipo_documento = 'NIT' then 'NIT' else t.tipo_documento end;
  new.digito_verificacion := case when new.tipo_documento = 'NIT' then public.dv_nit(t.numero_documento) end;
  -- El contacto es el del tercero (20270101004300); sin contacto en el tercero, el que trae.
  new.correo := coalesce(t.correo, new.correo);
  new.telefono := coalesce(t.telefono, new.telefono);
  new.direccion := coalesce(t.direccion, new.direccion);
  new.ciudad := coalesce(t.ciudad, new.ciudad);
  return new;
end;
$$;

create or replace function public._tercero_a_contratista()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.tipo_documento, new.numero_documento, new.dv, new.razon_social, new.correo, new.telefono, new.direccion, new.ciudad)
     is distinct from (old.tipo_documento, old.numero_documento, old.dv, old.razon_social, old.correo, old.telefono, old.direccion, old.ciudad) then
    update public.contratistas set tercero_id = tercero_id where tercero_id = new.id;
  end if;
  return null;
end;
$$;

create or replace function public._tercero_a_proveedor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.tipo_documento, new.numero_documento, new.razon_social, new.correo, new.telefono, new.direccion, new.ciudad)
     is distinct from (old.tipo_documento, old.numero_documento, old.razon_social, old.correo, old.telefono, old.direccion, old.ciudad) then
    update public.proveedores set tercero_id = tercero_id where tercero_id = new.id;
  end if;
  return null;
end;
$$;

-- 5. Los terceros sin contacto toman el del contratista, si no el del proveedor ---------
-- Sin disparadores: solo se llenan campos vacíos del tercero con lo que ya tenían sus
-- copias (no se anota en el historial ni se reescriben contratistas y proveedores).
set local session_replication_role = replica;
update public.terceros t
   set correo = coalesce(t.correo, nullif(btrim(c.correo), '')),
       telefono = coalesce(t.telefono, nullif(btrim(c.telefono), '')),
       direccion = coalesce(t.direccion, nullif(btrim(c.direccion), '')),
       ciudad = coalesce(t.ciudad, nullif(upper(btrim(c.ciudad)), ''))
  from public.contratistas c
 where c.tercero_id = t.id
   and (t.correo is null or t.telefono is null or t.direccion is null or t.ciudad is null);

update public.terceros t
   set correo = coalesce(t.correo, nullif(lower(btrim(p.correo)), '')),
       telefono = coalesce(t.telefono, nullif(btrim(p.telefono), '')),
       direccion = coalesce(t.direccion, nullif(btrim(p.direccion), '')),
       ciudad = coalesce(t.ciudad, nullif(upper(btrim(p.ciudad)), ''))
  from (select distinct on (tercero_id) * from public.proveedores where tercero_id is not null
         order by tercero_id, created_at) p
 where p.tercero_id = t.id
   and (t.correo is null or t.telefono is null or t.direccion is null or t.ciudad is null);
set local session_replication_role = origin;

commit;
