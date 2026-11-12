-- Acta: "Depositar a otro tercero" con autorización de Jurídica (decisión del
-- usuario, 2026-11-12).
--
-- * El acta trae por omisión el tercero que estipula el contrato
--   (contratos.titular_tercero_id, 20270101000600): ese no necesita nada más.
-- * "Pagar a alguien nuevo" (cualquier otro tercero): se sube la autorización
--   firmada (soporte tipo 'autorizacion_tercero', obligatorio) y el acta queda
--   con actas.autorizacion_estado = 'por_revisar'. Se avisa a Jurídica (Legal y
--   Líder Legal que vean el proyecto). Mientras tanto NO hay pago en A&F.
-- * Jurídica (acción aprobar_contratos, pestaña contratos.autorizar_terceros)
--   la aprueba -> se crea el pago en Aprobación de pagos y sigue normal; o la
--   rechaza con motivo -> el acta queda rechazada y quien la hizo la corrige.
-- * Editar el acta con el MISMO tercero y cuenta ya aprobados no la vuelve a
--   pedir.
--
-- Se puede correr más de una vez.

alter table public.actas
  add column if not exists autorizacion_estado text,
  add column if not exists autorizacion_resuelta_por uuid references public.perfiles(id),
  add column if not exists autorizacion_resuelta_at timestamptz,
  add column if not exists autorizacion_motivo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'actas_autorizacion_estado_check') then
    alter table public.actas add constraint actas_autorizacion_estado_check
      check (autorizacion_estado is null or autorizacion_estado in ('por_revisar', 'aprobada', 'rechazada'));
  end if;
end $$;
create index if not exists idx_actas_autorizacion_por_revisar on public.actas (contrato_id)
  where autorizacion_estado = 'por_revisar';

-- Tipo de soporte nuevo.
alter table public.acta_soportes drop constraint if exists acta_soportes_tipo_check;
alter table public.acta_soportes add constraint acta_soportes_tipo_check
  check (tipo = any (array['factura', 'cuenta_cobro', 'memoria', 'foto', 'otro', 'firmada_contratista', 'autorizacion_tercero']));

-- Avisos nuevos (misma lista de 20270101000100 + tres).
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo = any (array[
  'acta_por_facturar', 'pedido_rechazado', 'pedido_aprobado', 'orden_compra_rechazada', 'orden_compra_aprobada',
  'insumo_sobre_presupuesto', 'orden_compra_precio_sobre_efectivo', 'contrato_por_revisar', 'contrato_aprobado',
  'contrato_devuelto', 'contrato_rechazado', 'acta_aprobada', 'acta_rechazada', 'minuta_por_revisar',
  'minuta_aprobada', 'minuta_devuelta', 'contrato_vencido', 'contrato_vencido_juridica', 'insumo_rechazado',
  'otrosi_por_revisar', 'otrosi_por_aprobar', 'otrosi_devuelto', 'otrosi_rechazado', 'otrosi_aprobado',
  'otrosi_devuelto_subgerencia', 'poliza_pendiente', 'poliza_por_revisar', 'poliza_aprobada', 'poliza_devuelta',
  'requisicion_admin_aprobada', 'requisicion_admin_rechazada', 'requisicion_extraordinaria',
  'requisicion_administrativa', 'insumo_por_convertir', 'requisicion_administrativa_por_aprobar',
  'requisicion_administrativa_aprobada', 'requisicion_administrativa_rechazada', 'insumo_aprobado',
  'autorizacion_tercero_por_revisar', 'autorizacion_tercero_aprobada', 'autorizacion_tercero_rechazada'
])) not valid;

-- Pestaña nueva para quienes ya tienen Pre aprobación de contratos (Jurídica).
insert into public.rol_permisos (rol_id, permiso)
select distinct rp.rol_id, 'tab.contratos.autorizar_terceros'
  from public.rol_permisos rp
 where rp.permiso = 'tab.contratos.preaprobacion'
   and not exists (select 1 from public.rol_permisos x
                    where x.rol_id = rp.rol_id and x.permiso = 'tab.contratos.autorizar_terceros');

-- Jurídica lee las actas con autorización (y con eso sus soportes y archivos,
-- cuyas políticas miran actas).
drop policy if exists actas_select_autorizacion on public.actas;
create policy actas_select_autorizacion on public.actas for select to authenticated
using (
  autorizacion_estado is not null
  and (select public.tiene_pestana((select auth.uid()), 'contratos.autorizar_terceros'))
  and exists (select 1 from public.contratos c
               where c.id = actas.contrato_id
                 and c.proyecto_id in (select public.proyectos_visibles((select auth.uid())))))
;

-- Titular del acta + autorización. Antes buscaba el tercero del contratista por
-- documento; ahora por contratistas.tercero_id (20261222000000).
create or replace function public._fijar_titular_acta(p_acta_id uuid, p_titular jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acta record;
  v record;
  v_estado text;
  v_nombre text;
  u record;
begin
  select a.id, a.numero, a.tipo, a.titular_tercero_id, a.cuenta_tercero_id, a.autorizacion_estado,
         k.tercero_id as factura, c.titular_tercero_id as contrato_titular, c.proyecto_id,
         c.metodo_pago, coalesce(c.numero_contrato, c.codigo) as numero_contrato, k.nombre as contratista
    into v_acta
    from public.actas a
    join public.contratos c on c.id = a.contrato_id
    join public.contratistas k on k.id = c.contratista_id
   where a.id = p_acta_id;

  select * into v from public._titular_valido(p_titular, v_acta.factura);
  if v_acta.metodo_pago = 'pse' then
    v.o_titular := null;
    v.o_cuenta := null;
  end if;

  if v.o_titular is null or v.o_titular is not distinct from v_acta.contrato_titular then
    v_estado := null; -- la cuenta del contratista o el tercero del contrato
  elsif v_acta.autorizacion_estado = 'aprobada'
        and v.o_titular = v_acta.titular_tercero_id and v.o_cuenta = v_acta.cuenta_tercero_id then
    v_estado := 'aprobada'; -- mismo tercero y cuenta ya autorizados
  else
    if not exists (select 1 from public.acta_soportes s
                    where s.acta_id = p_acta_id and s.tipo = 'autorizacion_tercero') then
      raise exception 'Adjunta la autorización firmada para depositar a otro tercero.';
    end if;
    v_estado := 'por_revisar';
  end if;

  update public.actas
     set titular_tercero_id = v.o_titular,
         cuenta_tercero_id = v.o_cuenta,
         autorizacion_estado = v_estado,
         autorizacion_resuelta_por = case when v_estado = 'aprobada' then autorizacion_resuelta_por end,
         autorizacion_resuelta_at = case when v_estado = 'aprobada' then autorizacion_resuelta_at end,
         autorizacion_motivo = null
   where id = p_acta_id;

  if v_estado = 'por_revisar' then
    insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('acta', p_acta_id, 'autorizacion_solicitada', auth.uid(),
            jsonb_build_object('titular_tercero_id', v.o_titular));
    v_nombre := case v_acta.tipo when 'final' then 'Acta final' when 'liquidacion' then 'Acta de liquidación' else 'Acta' end;
    for u in
      select pf.id
        from public.perfiles pf
        join public.roles r on r.id = pf.rol_id
       where r.clave in ('legal', 'lider_legal')
         and public.tiene_accion(pf.id, 'aprobar_contratos')
         and public.usuario_puede_ver_proyecto(pf.id, v_acta.proyecto_id)
    loop
      perform public.notificar_una(
        u.id, 'autorizacion_tercero_por_revisar', 'acta', p_acta_id,
        'Autorizar pago a otro tercero',
        v_nombre || ' ' || v_acta.numero || ' del contrato ' || v_acta.numero_contrato || ' (' || v_acta.contratista
          || '): piden depositar el pago a otro tercero. Revisa la autorización.');
    end loop;
  end if;
end;
$$;
revoke all on function public._fijar_titular_acta(uuid, jsonb) from public, anon, authenticated;

-- Mismo _pago_de_acta vivo + "sin pago mientras Jurídica no autorice".
create or replace function public._pago_de_acta(p_acta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_valor numeric;
  v_tercero uuid;
  v_cuenta uuid;
  v_concepto text;
  v_pago uuid;
begin
  select a.id, a.numero, a.tipo, a.estado, a.neto, c.proyecto_id,
         coalesce(c.numero_contrato, c.codigo) as numero_contrato,
         k.numero_documento, k.tercero_id as contratista_tercero_id, k.nombre as contratista_nombre, py.empresa_id, e.consolidado_id, a.titular_tercero_id, a.cuenta_tercero_id as titular_cuenta_id, c.metodo_pago,
         a.autorizacion_estado
    into v
  from actas a
  join contratos c on c.id = a.contrato_id
  join contratistas k on k.id = c.contratista_id
  left join proyectos py on py.id = c.proyecto_id
  left join empresas e on e.id = py.empresa_id
  where a.id = p_acta_id;
  if not found or v.estado <> 'pendiente' then
    return;
  end if;

  select g.id into v_pago from pagos g where g.acta_id = p_acta_id and g.estado = 'solicitado'
   order by g.creado_en desc limit 1;
  v_valor := round(v.neto, 0);

  if v_valor <= 0 then
    if v_pago is not null then
      update pagos set estado = 'anulado', anulado_en = now(),
                       motivo_anulacion = 'El neto del acta quedó en cero o negativo.'
       where id = v_pago;
    end if;
    perform public._aprobar_acta(p_acta_id, auth.uid(), null);
    return;
  end if;

  -- Depositar a otro tercero: el pago llega a A&F solo cuando Jurídica lo autoriza.
  if v.autorizacion_estado is distinct from null and v.autorizacion_estado <> 'aprobada' then
    if v_pago is not null then
      update pagos set estado = 'anulado', anulado_en = now(),
                       motivo_anulacion = 'Espera la autorización de Jurídica para depositar a otro tercero.'
       where id = v_pago;
    end if;
    return;
  end if;

  -- La factura se puede subir después de aprobar (20261231999000).

  -- Tercero = documento del contratista; la cuenta se elige sola si tiene UNA verificada.
  v_tercero := v.contratista_tercero_id;  -- contratistas.tercero_id (20261222000000)
  if v_tercero is not null then
    select tc.id into v_cuenta from terceros_cuentas tc
     where tc.tercero_id = v_tercero and tc.estado = 'ACTIVO'
       and (select count(*) from terceros_cuentas x where x.tercero_id = v_tercero and x.estado = 'ACTIVO') = 1;
  end if;
  -- Titular aparte (formulario del acta): se paga en su cuenta.
  if v.titular_tercero_id is not null then
    v_cuenta := v.titular_cuenta_id;
  end if;
  -- Contrato por PSE: sin cuenta ni titular aparte.
  if v.metodo_pago = 'pse' then
    v_cuenta := null;
    v.titular_tercero_id := null;
  end if;
  v_concepto := upper(case v.tipo when 'final' then 'Acta final' when 'liquidacion' then 'Acta de liquidación' else 'Acta' end)
                || ' N° ' || v.numero || ' - CONTRATO ' || v.numero_contrato || ' - ' || upper(v.contratista_nombre);

  if v_pago is not null then
    update pagos set valor = v_valor, concepto = v_concepto, solicitado_en = now(),
                     tercero_id = coalesce(tercero_id, v_tercero),
                     cuenta_tercero_id = case when v.titular_tercero_id is not null or titular_tercero_id is not null
                                              then v_cuenta else coalesce(cuenta_tercero_id, v_cuenta) end,
                     titular_tercero_id = v.titular_tercero_id
     where id = v_pago;
  else
    insert into pagos (fuente, acta_id, tipo, proyecto_id, empresa_id, consolidado_id, tercero_id,
                       cuenta_tercero_id, titular_tercero_id, concepto, valor, estado, solicitado_en)
    values ('acta', p_acta_id, 'unico', v.proyecto_id, v.empresa_id, v.consolidado_id, v_tercero, v_cuenta, v.titular_tercero_id,
            v_concepto, v_valor, 'solicitado', now())
    returning id into v_pago;
  end if;
  perform public._pago_actualizar_novedad(v_pago);
end;
$$;
revoke all on function public._pago_de_acta(uuid) from public, anon, authenticated;

-- Jurídica aprueba o rechaza.
create or replace function public.resolver_autorizacion_acta(p_acta_id uuid, p_accion text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_nombre text;
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_contratos')
     or not public.tiene_pestana(auth.uid(), 'contratos.autorizar_terceros') then
    raise exception 'No tienes permiso para autorizar pagos a otro tercero.';
  end if;
  if p_accion not in ('aprobar', 'rechazar') then
    raise exception 'Acción no válida.';
  end if;
  select a.id, a.numero, a.tipo, a.estado, a.creado_por, a.autorizacion_estado, c.proyecto_id,
         coalesce(c.numero_contrato, c.codigo) as numero_contrato
    into v
    from actas a join contratos c on c.id = a.contrato_id
   where a.id = p_acta_id
   for update of a;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v.proyecto_id) then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;
  if v.autorizacion_estado is distinct from 'por_revisar' or v.estado <> 'pendiente' then
    raise exception 'Esta autorización ya se resolvió (actualiza la página).';
  end if;
  if p_accion = 'rechazar' and v_motivo is null then
    raise exception 'Escribe el motivo del rechazo.';
  end if;

  v_nombre := case v.tipo when 'final' then 'Acta final' when 'liquidacion' then 'Acta de liquidación' else 'Acta' end;
  if p_accion = 'aprobar' then
    update actas set autorizacion_estado = 'aprobada', autorizacion_resuelta_por = auth.uid(),
                     autorizacion_resuelta_at = now(), autorizacion_motivo = null
     where id = p_acta_id;
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id)
    values ('acta', p_acta_id, 'autorizacion_aprobada', auth.uid());
    perform public._pago_de_acta(p_acta_id);
    perform public.notificar_una(v.creado_por, 'autorizacion_tercero_aprobada', 'acta', p_acta_id,
      'Pago a otro tercero autorizado',
      v_nombre || ' ' || v.numero || ' del contrato ' || v.numero_contrato
        || ': Jurídica autorizó depositar a otro tercero. El pago pasó a Aprobación de pagos.');
  else
    update actas set autorizacion_estado = 'rechazada', autorizacion_resuelta_por = auth.uid(),
                     autorizacion_resuelta_at = now(), autorizacion_motivo = v_motivo,
                     estado = 'rechazada', resuelto_por = auth.uid(), resuelto_at = now(),
                     motivo_resolucion = 'Jurídica no autorizó depositar a otro tercero: ' || v_motivo
     where id = p_acta_id;
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo)
    values ('acta', p_acta_id, 'autorizacion_rechazada', auth.uid(), v_motivo);
    perform public.notificar_una(v.creado_por, 'autorizacion_tercero_rechazada', 'acta', p_acta_id,
      'Pago a otro tercero no autorizado',
      v_nombre || ' ' || v.numero || ' del contrato ' || v.numero_contrato
        || ': Jurídica no autorizó depositar a otro tercero. Motivo: ' || v_motivo || ' Corrige el acta y envíala otra vez.');
  end if;
end;
$$;
revoke all on function public.resolver_autorizacion_acta(uuid, text, text) from public, anon;
grant execute on function public.resolver_autorizacion_acta(uuid, text, text) to authenticated;

-- Lista para Jurídica (por estado; null = todas).
create or replace function public.listar_autorizaciones_tercero(p_estado text default 'por_revisar')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tiene_pestana(auth.uid(), 'contratos.autorizar_terceros') then
    raise exception 'No tienes acceso a esta pestaña.';
  end if;
  return coalesce((
    select jsonb_agg(x order by x->>'solicitada_at')
      from (
        select jsonb_build_object(
          'acta_id', a.id, 'numero', a.numero, 'tipo', a.tipo, 'estado', a.estado,
          'autorizacion_estado', a.autorizacion_estado, 'autorizacion_motivo', a.autorizacion_motivo,
          'autorizacion_resuelta_at', a.autorizacion_resuelta_at, 'resuelta_por_nombre', pr.nombre,
          'neto', a.neto, 'solicitada_at', coalesce(a.editada_at, a.created_at), 'creado_por_nombre', pc.nombre,
          'contrato_id', c.id, 'numero_contrato', coalesce(c.numero_contrato, c.codigo),
          'contratista', k.nombre, 'contratista_documento', k.numero_documento,
          'proyecto', py.codigo,
          'tercero_nombre', t.razon_social, 'tercero_documento', t.tipo_documento || ' ' || t.numero_documento,
          'cuenta', b.nombre || ' · ' || cu.tipo_cuenta || ' · '
                    || repeat('•', greatest(length(cu.numero_cuenta) - 4, 0)) || right(cu.numero_cuenta, 4),
          'cuenta_verificada', cu.estado = 'ACTIVO',
          'soportes', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'ruta', s.ruta, 'nombre_archivo', s.nombre_archivo,
                                                                    'mime', s.mime) order by s.created_at desc), '[]'::jsonb)
                         from acta_soportes s where s.acta_id = a.id and s.tipo = 'autorizacion_tercero')
        ) as x
          from actas a
          join contratos c on c.id = a.contrato_id
          join contratistas k on k.id = c.contratista_id
          left join proyectos py on py.id = c.proyecto_id
          left join terceros t on t.id = a.titular_tercero_id
          left join terceros_cuentas cu on cu.id = a.cuenta_tercero_id
          left join bancos b on b.id = cu.banco_id
          left join perfiles pc on pc.id = a.creado_por
          left join perfiles pr on pr.id = a.autorizacion_resuelta_por
         where a.autorizacion_estado is not null
           and (p_estado is null or a.autorizacion_estado = p_estado)
           and c.proyecto_id in (select public.proyectos_visibles(auth.uid()))
         limit 500
      ) q
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.listar_autorizaciones_tercero(text) from public, anon;
grant execute on function public.listar_autorizaciones_tercero(text) to authenticated;

-- actas_de_contrato: + estado de la autorización (para la lista de actas).
drop function if exists public.actas_de_contrato(uuid);
create function public.actas_de_contrato(p_contrato_id uuid)
returns table(acta_id uuid, numero integer, tipo text, estado text, valor_bruto numeric, neto numeric,
              periodo_desde date, periodo_hasta date, created_at timestamptz, creado_por_nombre text,
              es_mio boolean, autorizacion_estado text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_proyecto uuid;
begin
  select c.proyecto_id into v_proyecto from contratos c where c.id = p_contrato_id;
  if v_proyecto is null or not public.puede_ver_actas(v_proyecto) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  return query
  select a.id, a.numero, a.tipo, a.estado, a.valor_bruto, a.neto, a.periodo_desde, a.periodo_hasta,
         a.created_at, pf.nombre, a.creado_por is not distinct from auth.uid(), a.autorizacion_estado
  from actas a
  left join perfiles pf on pf.id = a.creado_por
  where a.contrato_id = p_contrato_id
  order by a.numero;
end;
$$;
revoke all on function public.actas_de_contrato(uuid) from public, anon;
grant execute on function public.actas_de_contrato(uuid) to authenticated;
