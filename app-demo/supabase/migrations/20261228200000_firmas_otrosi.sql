-- Firma del representante legal en el OTROSÍ (pedido del usuario, 2026-11-05;
-- el acta de liquidación ya firmaba: usa el mismo disparador y el mismo PDF que
-- las demás actas). Igual que el contrato (20261201000000_representantes_legales):
-- al aprobarlo Subgerencia se copia la firma del representante cuya cédula está
-- en el documento del otrosí (`contratanteRepresentanteCedula` de minuta_datos,
-- que Jurídica envía completo): primero su Mi firma, si no la subida. Empresa
-- sin representantes = se aprueba sin firma; con representantes y otra cédula,
-- o sin firma = no deja aprobar. El PDF aprobado se congela
-- (documentos_firmados, entidad 'otrosi').
-- Va después de 20261228000000. Se puede correr más de una vez.

-- ---------------------------------------------------------------- entidad 'otrosi'
alter table public.documento_firmas drop constraint if exists documento_firmas_entidad_check;
alter table public.documento_firmas add constraint documento_firmas_entidad_check
  check (entidad = any (array['acta', 'poliza', 'orden_compra', 'contrato', 'otrosi']::text[]));
alter table public.documentos_firmados drop constraint if exists documentos_firmados_entidad_check;
alter table public.documentos_firmados add constraint documentos_firmados_entidad_check
  check (entidad = any (array['acta', 'poliza', 'orden_compra', 'contrato', 'otrosi']::text[]));

-- ---------------------------------------------------------------- quién firma
-- Misma regla que _representante_que_firma, sobre el documento del otrosí.
create or replace function public._representante_que_firma_otrosi(p_otrosi_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o record;
  v_cedula text;
  v_nombre text;
  r record;
  v_imagen text;
begin
  select x.id, x.minuta_datos, p.empresa_id, e.razon_social into o
    from otrosis x join proyectos p on p.id = x.proyecto_id left join empresas e on e.id = p.empresa_id
   where x.id = p_otrosi_id;
  if not found or o.empresa_id is null
     or not exists (select 1 from empresa_representantes y where y.empresa_id = o.empresa_id and y.activo) then
    return jsonb_build_object('estado', 'sin_registro');
  end if;
  v_cedula := regexp_replace(coalesce(o.minuta_datos->>'contratanteRepresentanteCedula', ''), '[^0-9]', '', 'g');
  v_nombre := o.minuta_datos->>'contratanteRepresentante';
  select y.* into r from empresa_representantes y
   where y.empresa_id = o.empresa_id and y.activo and y.numero_documento = v_cedula
   order by y.tipo = 'principal' desc limit 1;
  if not found then
    return jsonb_build_object('estado', 'no_coincide', 'empresa', o.razon_social,
                              'minuta_nombre', v_nombre, 'minuta_documento', nullif(v_cedula, ''));
  end if;
  select f.imagen into v_imagen from firmas_usuario f where f.perfil_id = r.perfil_id;
  v_imagen := coalesce(v_imagen, r.imagen_firma);
  return jsonb_build_object('estado', case when v_imagen is null then 'sin_firma' else 'ok' end,
                            'representante_id', r.id, 'nombre', r.nombre, 'tipo', r.tipo,
                            'perfil_id', r.perfil_id, 'empresa', o.razon_social, 'imagen', v_imagen);
end;
$$;
revoke all on function public._representante_que_firma_otrosi(uuid) from public, anon, authenticated;

create or replace function public._firmar_representante_otrosi()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb := public._representante_que_firma_otrosi(new.id);
begin
  if v->>'estado' = 'sin_registro' then
    return null;
  elsif v->>'estado' = 'no_coincide' then
    raise exception 'El representante legal del otrosí (%) no está registrado como representante de %. Regístralo en Admin › Empresas o devuelve el otrosí a Jurídica para corregirlo.',
      coalesce(nullif(concat_ws(', C.C. ', v->>'minuta_nombre', v->>'minuta_documento'), ''), 'sin datos'), v->>'empresa';
  elsif v->>'estado' = 'sin_firma' then
    raise exception 'Falta la firma de %, representante legal de %: ponla con «Adjuntar firma de RL» en Aprobación de contratos.',
      v->>'nombre', v->>'empresa';
  end if;
  insert into documento_firmas (entidad, entidad_id, papel, perfil_id, nombre, cargo, imagen, firmado_at)
  values ('otrosi', new.id, 'representante_legal', nullif(v->>'perfil_id', '')::uuid, v->>'nombre',
          case when v->>'tipo' = 'suplente' then 'Representante legal suplente' else 'Representante legal' end,
          v->>'imagen', now())
  on conflict (entidad, entidad_id, papel) do update
    set perfil_id = excluded.perfil_id, nombre = excluded.nombre, cargo = excluded.cargo, imagen = excluded.imagen,
        firmado_at = excluded.firmado_at, codigo = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('otrosi', new.id, 'firma_representante', auth.uid(),
          jsonb_build_object('representante', v->>'nombre', 'tipo', v->>'tipo'));
  return null;
end;
$$;
revoke all on function public._firmar_representante_otrosi() from public, anon, authenticated;

drop trigger if exists trg_firmar_representante_otrosi on public.otrosis;
create trigger trg_firmar_representante_otrosi
  after update of estado on public.otrosis
  for each row
  when (new.estado = 'aprobada' and old.estado is distinct from 'aprobada')
  execute function public._firmar_representante_otrosi();

-- ---------------------------------------------------------------- quién ve el documento firmado
create or replace function public._puede_ver_documento(p_entidad text, p_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select case p_entidad
    when 'acta' then exists (select 1 from actas a join contratos c on c.id = a.contrato_id
                              where a.id = p_id and public.puede_ver_actas(c.proyecto_id))
    when 'poliza' then public._puede_ver_polizas(auth.uid())
                       and exists (select 1 from contrato_polizas o join contratos c on c.id = o.contrato_id
                                    where o.id = p_id and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id))
    when 'orden_compra' then exists (select 1 from ordenes_compra o
                                      where o.id = p_id and public.usuario_puede_ver_proyecto(auth.uid(), o.proyecto_id))
    -- Contratos: quien ve el contrato, o quien lo abre desde otrosí / pólizas.
    when 'contrato' then exists (select 1 from contratos c
                                  where c.id = p_id
                                    and (public._puede_ver_contrato_rl(c.proyecto_id)
                                         or (public._puede_ver_otrosis(auth.uid())
                                             and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id))))
    -- Otrosí: las pestañas que ven otrosí, en los proyectos de cada quien.
    when 'otrosi' then public._puede_ver_otrosis(auth.uid())
                       and exists (select 1 from otrosis o
                                    where o.id = p_id and public.usuario_puede_ver_proyecto(auth.uid(), o.proyecto_id))
    else false end;
$function$;

-- ---------------------------------------------------------------- verificar documento (parche)
do $$
declare
  v text := pg_get_functiondef('public.verificar_documento(text, text)'::regprocedure);
  v_buscar text := E'  elsif v_entidad = ''orden_compra'' then\n';
begin
  if position('v_entidad = ''otrosi''' in v) > 0 then return; end if;
  if position(v_buscar in v) = 0 then
    raise exception 'verificar_documento cambió: no se encontró el texto a parchar.';
  end if;
  execute replace(v, v_buscar,
    E'  elsif v_entidad = ''otrosi'' then\n'
    || E'    select ''Otrosí N° '' || coalesce(o.numero::text, ''(sin número)'') || '' · contrato ''\n'
    || E'           || coalesce(c.numero_contrato, ''Solicitud N° '' || c.numero) || '' · '' || k.nombre\n'
    || E'      into v_titulo\n'
    || E'      from otrosis o join contratos c on c.id = o.contrato_id join contratistas k on k.id = c.contratista_id\n'
    || E'     where o.id = v_id;\n'
    || v_buscar);
end;
$$;
