-- Terceros: CREAR lo puede cualquier usuario con sesión; EDITAR (datos y
-- cuentas) y VERIFICAR siguen siendo de A&F (decisión del usuario, 2026-10-23).
-- Terceros es todo aquel a quien CONYCA le paga: cada área crea el tercero desde
-- su propia pantalla (Contratistas, Proveedores, después Empleados) con el mismo
-- formulario de A&F (NuevoTerceroDialogo) y sigue con lo suyo.
--
-- crear_tercero(p_datos, p_cuenta) valida lo mismo que validarTercero /
-- validarCuenta (lib/terceros.ts) y crea el tercero y su cuenta en UNA
-- transacción (antes eran dos inserts: si fallaba la cuenta, el tercero quedaba
-- sin ella). La cuenta queda PENDIENTE salvo que la cree quien verifica
-- (_terceros_cuentas_guarda, igual que antes). El documento es único
-- (terceros_documento_key): si ya existe, se avisa que hay que buscarlo.
-- Devuelve solo lo básico (id, nombre, documento): quien no es de A&F no lee la
-- tabla terceros (RLS sin cambios). Las políticas de INSERT directo siguen
-- exigiendo editar_terceros: crear desde fuera de A&F es solo por esta función.

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
  v_nombre_banco text := nullif(upper(btrim(regexp_replace(coalesce(p_datos ->> 'nombre_banco', ''), '\s+', ' ', 'g'))), '');
  v_nombres text := nullif(upper(btrim(regexp_replace(coalesce(p_datos ->> 'nombres', ''), '\s+', ' ', 'g'))), '');
  v_apellidos text := nullif(upper(btrim(regexp_replace(coalesce(p_datos ->> 'apellidos', ''), '\s+', ' ', 'g'))), '');
  v_obs text := nullif(btrim(coalesce(p_datos ->> 'observaciones', '')), '');
  v_banco uuid;
  v_tipo_cuenta text;
  v_num_cuenta text;
  v_id uuid;
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
  else
    v_dv := null;
  end if;
  if v_razon = '' then
    raise exception 'Escribe el nombre o razón social.';
  end if;
  if length(v_razon) > 150 then
    raise exception 'El nombre es demasiado largo (máximo 150).';
  end if;
  if length(coalesce(v_nombre_banco, '')) > 40 then
    raise exception 'El nombre para el banco admite máximo 40 caracteres.';
  end if;
  if exists (select 1 from public.terceros t where t.numero_documento = v_numero) then
    raise exception 'Ya existe un tercero con el documento %: búscalo en vez de crearlo.', v_numero;
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

  insert into public.terceros (tipo_documento, numero_documento, dv, razon_social, nombre_banco, nombres, apellidos, observaciones)
  values (v_tipo, v_numero, v_dv, v_razon, v_nombre_banco, v_nombres, v_apellidos, v_obs)
  returning id into v_id;

  if p_cuenta is not null then
    insert into public.terceros_cuentas (tercero_id, banco_id, tipo_cuenta, numero_cuenta, etiqueta, observaciones)
    values (v_id, v_banco, v_tipo_cuenta, v_num_cuenta,
            nullif(upper(btrim(regexp_replace(coalesce(p_cuenta ->> 'etiqueta', ''), '\s+', ' ', 'g'))), ''),
            nullif(btrim(coalesce(p_cuenta ->> 'observaciones', '')), ''));
  end if;

  return jsonb_build_object('id', v_id, 'razon_social', v_razon, 'tipo_documento', v_tipo,
                            'numero_documento', v_numero, 'dv', v_dv);
exception
  when unique_violation then
    raise exception 'Ya existe un tercero con el documento %: búscalo en vez de crearlo.', v_numero;
end;
$$;
revoke all on function public.crear_tercero(jsonb, jsonb) from public, anon;
grant execute on function public.crear_tercero(jsonb, jsonb) to authenticated;
