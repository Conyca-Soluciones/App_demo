-- Balances (A&F), decisiones del usuario 2026-11-12.
--
-- Saldo de cada cuenta a debitar (cuentas_empresa, las de Realizar Pagos):
--   saldo de inicio (con fecha de corte)
--   + ingresos − egresos ± traslados internos
--   − pagos dispersados o marcados como pagados (PSE / otro medio) con esa
--     cuenta, desde la fecha de corte (valor a pagar truncado al peso, como el
--     dispersor; un rebote o "no salió" lo devuelve solo porque el pago deja de
--     estar dispersado).
-- Se calcula al consultar; no se guarda ningún saldo.
--
-- Movimientos (movimientos_bancarios): ingreso (IN-0001), egreso externo
-- (PE-0001, "pago externo") y traslado interno (TR-0001), con cuenta, fecha,
-- valor, concepto y titular (texto libre) y soporte opcional (bucket
-- balances). Se editan y se eliminan (eliminación lógica, con motivo); cada
-- cambio queda en balances_cambios. Los ingresos y egresos salen en el
-- Consolidado Gerencia si se marcan sus casillas (los traslados no).
--
-- Pestaña ayf.balances (Gerencia y Financiera) y acción
-- registrar_movimientos_bancarios (las dos, por omisión).
--
-- Solo agrega tablas, funciones y políticas nuevas; el único parche es a
-- eliminar_empresa (no borra una empresa cuyas cuentas tengan saldo o
-- movimientos). Reversa en supabase/reversa/20270101001200_balances.sql.

begin;

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $$
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
$$;

-- 1. Pestaña y acción ------------------------------------------------------------
insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
  from public.roles r
 cross join (values ('tab.ayf.balances'), ('accion.registrar_movimientos_bancarios')) as p(permiso)
 where r.clave in ('financiera', 'gerencia')
on conflict do nothing;

-- 2. Tablas ----------------------------------------------------------------------
create table if not exists public.cuentas_saldo_inicial (
  cuenta_id uuid primary key references public.cuentas_empresa(id),
  saldo numeric(18, 2) not null,
  fecha_corte date not null,
  registrado_por uuid references public.perfiles(id),
  registrado_en timestamptz not null default now(),
  actualizado_por uuid references public.perfiles(id),
  actualizado_en timestamptz
);

create table if not exists public.movimientos_bancarios (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  tipo text not null check (tipo in ('ingreso', 'egreso', 'traslado')),
  cuenta_id uuid not null references public.cuentas_empresa(id),
  cuenta_destino_id uuid references public.cuentas_empresa(id),
  fecha date not null,
  valor numeric(18, 2) not null check (valor > 0),
  concepto text not null,
  titular text,
  soporte_ruta text,
  soporte_nombre text,
  soporte_mime text,
  creado_por uuid references public.perfiles(id),
  creado_en timestamptz not null default now(),
  editado_por uuid references public.perfiles(id),
  editado_en timestamptz,
  eliminado_por uuid references public.perfiles(id),
  eliminado_en timestamptz,
  motivo_eliminacion text,
  constraint movimientos_bancarios_traslado check ((tipo = 'traslado') = (cuenta_destino_id is not null)),
  constraint movimientos_bancarios_destino_distinto check (cuenta_destino_id is null or cuenta_destino_id <> cuenta_id),
  constraint movimientos_bancarios_titular check (tipo = 'traslado' or nullif(btrim(titular), '') is not null)
);
create index if not exists movimientos_bancarios_cuenta_fecha on public.movimientos_bancarios (cuenta_id, fecha) where eliminado_en is null;
create index if not exists movimientos_bancarios_destino_fecha on public.movimientos_bancarios (cuenta_destino_id, fecha)
  where eliminado_en is null and cuenta_destino_id is not null;
create index if not exists movimientos_bancarios_fecha on public.movimientos_bancarios (fecha desc, creado_en desc);
create index if not exists pagos_cuenta_debitar_dispersado on public.pagos (cuenta_debitar_id)
  where estado = 'dispersado' and cuenta_debitar_id is not null;

create table if not exists public.balances_cambios (
  id bigint generated always as identity primary key,
  entidad text not null check (entidad in ('saldo_inicial', 'movimiento')),
  registro_id uuid not null,
  accion text not null check (accion in ('creado', 'editado', 'eliminado')),
  antes jsonb,
  despues jsonb,
  motivo text,
  usuario_id uuid references public.perfiles(id),
  en timestamptz not null default now()
);
create index if not exists balances_cambios_registro on public.balances_cambios (registro_id, en);

create table if not exists public.contadores_balances (
  tipo text primary key check (tipo in ('ingreso', 'egreso', 'traslado')),
  ultimo bigint not null default 0
);

-- Solo lectura por la API; todo lo que escribe va por las funciones.
alter table public.cuentas_saldo_inicial enable row level security;
alter table public.movimientos_bancarios enable row level security;
alter table public.balances_cambios enable row level security;
alter table public.contadores_balances enable row level security;
revoke insert, update, delete on public.cuentas_saldo_inicial, public.movimientos_bancarios,
  public.balances_cambios, public.contadores_balances from anon, authenticated;
revoke all on public.contadores_balances from anon, authenticated;

create or replace function public._ve_balances(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.es_admin(p_uid) or public.tiene_pestana(p_uid, 'ayf.balances')
$$;
revoke all on function public._ve_balances(uuid) from public, anon, authenticated;

drop policy if exists cuentas_saldo_inicial_select on public.cuentas_saldo_inicial;
create policy cuentas_saldo_inicial_select on public.cuentas_saldo_inicial for select to authenticated
  using ((select public._ve_balances((select auth.uid()))));
drop policy if exists movimientos_bancarios_select on public.movimientos_bancarios;
create policy movimientos_bancarios_select on public.movimientos_bancarios for select to authenticated
  using ((select public._ve_balances((select auth.uid())))
         or (select public.tiene_pestana((select auth.uid()), 'ayf.consolidado_gerencia')));
drop policy if exists balances_cambios_select on public.balances_cambios;
create policy balances_cambios_select on public.balances_cambios for select to authenticated
  using ((select public._ve_balances((select auth.uid()))));

-- 3. Soportes (bucket balances, carpeta del usuario) -----------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('balances', 'balances', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists balances_soportes_insert on storage.objects;
create policy balances_soportes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'balances' and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select public.tiene_accion((select auth.uid()), 'registrar_movimientos_bancarios')));
drop policy if exists balances_soportes_delete on storage.objects;
create policy balances_soportes_delete on storage.objects for delete to authenticated
  using (bucket_id = 'balances' and (storage.foldername(name))[1] = (select auth.uid())::text
         and name not in (select m.soporte_ruta from public.movimientos_bancarios m where m.soporte_ruta is not null));
drop policy if exists balances_soportes_select on storage.objects;
create policy balances_soportes_select on storage.objects for select to authenticated
  using (bucket_id = 'balances'
         and ((select public._ve_balances((select auth.uid())))
              or (select public.tiene_pestana((select auth.uid()), 'ayf.consolidado_gerencia'))));

-- 4. Escribir --------------------------------------------------------------------
create or replace function public._exigir_registrar_balances()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tiene_accion(auth.uid(), 'registrar_movimientos_bancarios') then
    raise exception 'No autorizado -- no tienes permiso para registrar movimientos bancarios.';
  end if;
end;
$$;
revoke all on function public._exigir_registrar_balances() from public, anon, authenticated;

create or replace function public.guardar_saldo_inicial(p_cuenta_id uuid, p_saldo numeric, p_fecha_corte date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes jsonb;
begin
  perform public._exigir_registrar_balances();
  if not exists (select 1 from public.cuentas_empresa where id = p_cuenta_id) then
    raise exception 'La cuenta no existe.';
  end if;
  if p_saldo is null then
    raise exception 'Escribe el saldo de inicio.';
  end if;
  if p_fecha_corte is null then
    raise exception 'Escoge la fecha de corte.';
  end if;
  if p_fecha_corte > (now() at time zone 'America/Bogota')::date then
    raise exception 'La fecha de corte no puede ser futura.';
  end if;
  select to_jsonb(s) into v_antes from public.cuentas_saldo_inicial s where s.cuenta_id = p_cuenta_id;
  insert into public.cuentas_saldo_inicial (cuenta_id, saldo, fecha_corte, registrado_por)
  values (p_cuenta_id, round(p_saldo, 2), p_fecha_corte, auth.uid())
  on conflict (cuenta_id) do update
    set saldo = excluded.saldo, fecha_corte = excluded.fecha_corte, actualizado_por = auth.uid(), actualizado_en = now();
  insert into public.balances_cambios (entidad, registro_id, accion, antes, despues, usuario_id)
  values ('saldo_inicial', p_cuenta_id, case when v_antes is null then 'creado' else 'editado' end, v_antes,
          (select to_jsonb(s) from public.cuentas_saldo_inicial s where s.cuenta_id = p_cuenta_id), auth.uid());
end;
$$;
revoke all on function public.guardar_saldo_inicial(uuid, numeric, date) from public, anon;
grant execute on function public.guardar_saldo_inicial(uuid, numeric, date) to authenticated;

-- p_id null = crear (p_datos.tipo); si no, editar (el tipo no cambia).
-- p_datos: tipo, cuenta_id, cuenta_destino_id, fecha, valor, concepto, titular y,
-- si viene la clave "soporte", el soporte nuevo ({ruta, nombre, mime}) o null para quitarlo.
create or replace function public.guardar_movimiento_bancario(p_id uuid, p_datos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mov public.movimientos_bancarios;
  v_tipo text;
  v_cuenta uuid := nullif(p_datos ->> 'cuenta_id', '')::uuid;
  v_destino uuid := nullif(p_datos ->> 'cuenta_destino_id', '')::uuid;
  v_fecha date := nullif(p_datos ->> 'fecha', '')::date;
  v_valor numeric := round(nullif(p_datos ->> 'valor', '')::numeric, 2);
  v_concepto text := nullif(btrim(regexp_replace(coalesce(p_datos ->> 'concepto', ''), '\s+', ' ', 'g')), '');
  v_titular text := nullif(btrim(regexp_replace(coalesce(p_datos ->> 'titular', ''), '\s+', ' ', 'g')), '');
  v_cambia_soporte boolean := p_datos ? 'soporte';
  v_soporte jsonb := case when jsonb_typeof(p_datos -> 'soporte') = 'object' then p_datos -> 'soporte' end;
  v_antes jsonb;
  v_n bigint;
  v_codigo text;
begin
  perform public._exigir_registrar_balances();
  if p_id is null then
    v_tipo := p_datos ->> 'tipo';
    if v_tipo is null or v_tipo not in ('ingreso', 'egreso', 'traslado') then
      raise exception 'Tipo de movimiento no válido.';
    end if;
  else
    select * into v_mov from public.movimientos_bancarios where id = p_id for update;
    if not found then
      raise exception 'El movimiento no existe.';
    end if;
    if v_mov.eliminado_en is not null then
      raise exception 'El movimiento % está eliminado: no se puede editar.', v_mov.codigo;
    end if;
    v_tipo := v_mov.tipo;
    v_antes := to_jsonb(v_mov);
  end if;

  if v_cuenta is null or not exists (select 1 from public.cuentas_empresa where id = v_cuenta) then
    raise exception 'Escoge la cuenta.';
  end if;
  if v_tipo = 'traslado' then
    if v_destino is null or not exists (select 1 from public.cuentas_empresa where id = v_destino) then
      raise exception 'Escoge la cuenta de destino del traslado.';
    end if;
    if v_destino = v_cuenta then
      raise exception 'La cuenta de origen y la de destino deben ser distintas.';
    end if;
    v_titular := null;
  else
    v_destino := null;
    if v_titular is null then
      raise exception 'Escribe el titular.';
    end if;
  end if;
  if v_fecha is null then
    raise exception 'Escoge la fecha.';
  end if;
  if v_fecha > (now() at time zone 'America/Bogota')::date then
    raise exception 'La fecha no puede ser futura.';
  end if;
  if v_valor is null or v_valor <= 0 then
    raise exception 'El valor debe ser mayor que cero.';
  end if;
  if v_concepto is null then
    raise exception 'Escribe el concepto.';
  end if;
  if length(v_concepto) > 500 or length(coalesce(v_titular, '')) > 200 then
    raise exception 'El concepto (máximo 500) o el titular (máximo 200) son demasiado largos.';
  end if;
  if v_soporte is not null then
    if coalesce(v_soporte ->> 'ruta', '') not like auth.uid()::text || '/%' then
      raise exception 'El soporte no se subió bien: vuelve a adjuntarlo.';
    end if;
    if coalesce(v_soporte ->> 'mime', '') not in ('application/pdf', 'image/jpeg', 'image/png') then
      raise exception 'El soporte debe ser PDF, JPG o PNG.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'balances' and o.name = v_soporte ->> 'ruta') then
      raise exception 'No se encontró el soporte subido: vuelve a adjuntarlo.';
    end if;
  end if;

  if p_id is null then
    insert into public.contadores_balances (tipo, ultimo) values (v_tipo, 1)
    on conflict (tipo) do update set ultimo = public.contadores_balances.ultimo + 1
    returning ultimo into v_n;
    v_codigo := case v_tipo when 'ingreso' then 'IN-' when 'egreso' then 'PE-' else 'TR-' end || public._con_ceros(v_n, 4);
    insert into public.movimientos_bancarios
      (codigo, tipo, cuenta_id, cuenta_destino_id, fecha, valor, concepto, titular,
       soporte_ruta, soporte_nombre, soporte_mime, creado_por)
    values (v_codigo, v_tipo, v_cuenta, v_destino, v_fecha, v_valor, v_concepto, v_titular,
            v_soporte ->> 'ruta', left(v_soporte ->> 'nombre', 200), v_soporte ->> 'mime', auth.uid())
    returning * into v_mov;
  else
    update public.movimientos_bancarios
       set cuenta_id = v_cuenta, cuenta_destino_id = v_destino, fecha = v_fecha, valor = v_valor,
           concepto = v_concepto, titular = v_titular,
           soporte_ruta = case when v_cambia_soporte then v_soporte ->> 'ruta' else soporte_ruta end,
           soporte_nombre = case when v_cambia_soporte then left(v_soporte ->> 'nombre', 200) else soporte_nombre end,
           soporte_mime = case when v_cambia_soporte then v_soporte ->> 'mime' else soporte_mime end,
           editado_por = auth.uid(), editado_en = now()
     where id = p_id
    returning * into v_mov;
  end if;

  insert into public.balances_cambios (entidad, registro_id, accion, antes, despues, usuario_id)
  values ('movimiento', v_mov.id, case when p_id is null then 'creado' else 'editado' end, v_antes, to_jsonb(v_mov), auth.uid());
  return jsonb_build_object('id', v_mov.id, 'codigo', v_mov.codigo);
end;
$$;
revoke all on function public.guardar_movimiento_bancario(uuid, jsonb) from public, anon;
grant execute on function public.guardar_movimiento_bancario(uuid, jsonb) to authenticated;

create or replace function public.eliminar_movimiento_bancario(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mov public.movimientos_bancarios;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  perform public._exigir_registrar_balances();
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'Escribe por qué se elimina.';
  end if;
  select * into v_mov from public.movimientos_bancarios where id = p_id for update;
  if not found then
    raise exception 'El movimiento no existe.';
  end if;
  if v_mov.eliminado_en is not null then
    raise exception 'El movimiento % ya estaba eliminado.', v_mov.codigo;
  end if;
  update public.movimientos_bancarios
     set eliminado_en = now(), eliminado_por = auth.uid(), motivo_eliminacion = left(v_motivo, 500)
   where id = p_id;
  insert into public.balances_cambios (entidad, registro_id, accion, antes, motivo, usuario_id)
  values ('movimiento', p_id, 'eliminado', to_jsonb(v_mov), left(v_motivo, 500), auth.uid());
end;
$$;
revoke all on function public.eliminar_movimiento_bancario(uuid, text) from public, anon;
grant execute on function public.eliminar_movimiento_bancario(uuid, text) to authenticated;

-- 5. Leer ------------------------------------------------------------------------
-- Las líneas que mueven el saldo de cada cuenta (desde su fecha de corte):
-- movimientos vigentes y pagos dispersados o pagados sin dispersor. valor con
-- signo (+ entra, − sale). Uso interno.
create or replace function public._lineas_balance(p_cuenta_id uuid)
returns table (cuenta_id uuid, fecha date, momento timestamptz, clase text, codigo text,
               titular text, concepto text, valor numeric, registro_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with cortes as (
    select s.cuenta_id, s.fecha_corte from public.cuentas_saldo_inicial s
     where p_cuenta_id is null or s.cuenta_id = p_cuenta_id
  )
  select m.cuenta_id, m.fecha, m.creado_en,
         case m.tipo when 'ingreso' then 'ingreso' when 'egreso' then 'egreso' else 'traslado_salida' end,
         m.codigo, m.titular, m.concepto,
         case m.tipo when 'ingreso' then m.valor else -m.valor end, m.id
    from public.movimientos_bancarios m
    join cortes c on c.cuenta_id = m.cuenta_id and m.fecha >= c.fecha_corte
   where m.eliminado_en is null
  union all
  select m.cuenta_destino_id, m.fecha, m.creado_en, 'traslado_entrada', m.codigo, null, m.concepto, m.valor, m.id
    from public.movimientos_bancarios m
    join cortes c on c.cuenta_id = m.cuenta_destino_id and m.fecha >= c.fecha_corte
   where m.eliminado_en is null and m.tipo = 'traslado'
  union all
  select g.cuenta_debitar_id, (g.dispersado_en at time zone 'America/Bogota')::date, g.dispersado_en,
         case when g.dispersion_id is null then 'pago_sin_dispersor' else 'pago_dispersor' end,
         g.referencia, coalesce(tt.razon_social, t.razon_social), g.concepto,
         -trunc(coalesce(g.valor_a_pagar, g.valor)), g.id
    from public.pagos g
    join cortes c on c.cuenta_id = g.cuenta_debitar_id
    left join public.terceros t on t.id = g.tercero_id
    left join public.terceros tt on tt.id = g.titular_tercero_id
   where g.estado = 'dispersado' and g.cuenta_debitar_id is not null and g.dispersado_en is not null
     and (g.dispersado_en at time zone 'America/Bogota')::date >= c.fecha_corte
$$;
revoke all on function public._lineas_balance(uuid) from public, anon, authenticated;

-- Saldos Bancarios: una fila por cuenta a debitar.
create or replace function public.saldos_bancarios()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public._ve_balances(auth.uid()) then
    raise exception 'No autorizado -- no tienes la pestaña Balances.';
  end if;
  return coalesce((
    with sumas as (
      select l.cuenta_id,
             sum(l.valor) filter (where l.clase = 'ingreso') ingresos,
             -sum(l.valor) filter (where l.clase = 'egreso') egresos,
             sum(l.valor) filter (where l.clase in ('traslado_entrada', 'traslado_salida')) traslados,
             -sum(l.valor) filter (where l.clase in ('pago_dispersor', 'pago_sin_dispersor')) pagos,
             sum(l.valor) total,
             max(l.fecha) ultima
        from public._lineas_balance(null) l
       group by l.cuenta_id
    )
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'apodo', c.apodo, 'banco', b.nombre, 'tipo_cuenta', c.tipo_cuenta,
             'numero_cuenta', c.numero_cuenta, 'empresa', coalesce(e.razon_social, c.razon_social),
             'estado', c.estado,
             'saldo_inicial', s.saldo, 'fecha_corte', s.fecha_corte,
             'ingresos', coalesce(x.ingresos, 0), 'egresos', coalesce(x.egresos, 0),
             'traslados', coalesce(x.traslados, 0), 'pagos', coalesce(x.pagos, 0),
             'saldo_actual', case when s.cuenta_id is null then null else s.saldo + coalesce(x.total, 0) end,
             'ultimo_movimiento', x.ultima)
           order by coalesce(e.razon_social, c.razon_social), b.nombre, c.apodo)
      from public.cuentas_empresa c
      left join public.bancos b on b.id = c.banco_id
      left join public.empresas e on e.id = c.empresa_id
      left join public.cuentas_saldo_inicial s on s.cuenta_id = c.id
      left join sumas x on x.cuenta_id = c.id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.saldos_bancarios() from public, anon;
grant execute on function public.saldos_bancarios() to authenticated;

-- Extracto de una cuenta entre dos fechas, con el saldo después de cada línea.
create or replace function public.extracto_cuenta(p_cuenta_id uuid, p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ini public.cuentas_saldo_inicial;
  v_desde date;
begin
  if not public._ve_balances(auth.uid()) then
    raise exception 'No autorizado -- no tienes la pestaña Balances.';
  end if;
  select * into v_ini from public.cuentas_saldo_inicial where cuenta_id = p_cuenta_id;
  if not found then
    return jsonb_build_object('sin_saldo_inicial', true, 'filas', '[]'::jsonb);
  end if;
  v_desde := greatest(coalesce(p_desde, v_ini.fecha_corte), v_ini.fecha_corte);
  return (
    with lineas as (
      select l.*, v_ini.saldo + sum(l.valor) over (order by l.fecha, l.momento, l.codigo, l.registro_id
                                                    rows between unbounded preceding and current row) saldo
        from public._lineas_balance(p_cuenta_id) l
       where l.cuenta_id = p_cuenta_id and (p_hasta is null or l.fecha <= p_hasta)
    )
    select jsonb_build_object(
      'saldo_inicial', v_ini.saldo, 'fecha_corte', v_ini.fecha_corte, 'desde', v_desde, 'hasta', p_hasta,
      'saldo_anterior', v_ini.saldo + coalesce((select sum(l2.valor) from lineas l2 where l2.fecha < v_desde), 0),
      'saldo_final', v_ini.saldo + coalesce((select sum(l3.valor) from lineas l3), 0),
      'filas', coalesce((select jsonb_agg(jsonb_build_object(
                  'fecha', l.fecha, 'clase', l.clase, 'codigo', l.codigo, 'titular', l.titular,
                  'concepto', l.concepto, 'valor', l.valor, 'saldo', l.saldo, 'registro_id', l.registro_id)
                  order by l.fecha, l.momento, l.codigo, l.registro_id)
                 from lineas l where l.fecha >= v_desde), '[]'::jsonb))
  );
end;
$$;
revoke all on function public.extracto_cuenta(uuid, date, date) from public, anon;
grant execute on function public.extracto_cuenta(uuid, date, date) to authenticated;

-- Registros: los movimientos (más recientes primero), página de p_limite.
create or replace function public.listar_movimientos_bancarios(
  p_cuenta_id uuid, p_tipo text, p_desde date, p_hasta date, p_eliminados boolean, p_offset integer, p_limite integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public._ve_balances(auth.uid()) then
    raise exception 'No autorizado -- no tienes la pestaña Balances.';
  end if;
  return coalesce((
    select jsonb_agg(f.j order by f.fecha desc, f.creado_en desc, f.id)
      from (
        select m.fecha, m.creado_en, m.id, jsonb_build_object(
                 'id', m.id, 'codigo', m.codigo, 'tipo', m.tipo, 'fecha', m.fecha, 'valor', m.valor,
                 'concepto', m.concepto, 'titular', m.titular,
                 'cuenta_id', m.cuenta_id, 'cuenta', c.apodo, 'banco', b.nombre,
                 'cuenta_destino_id', m.cuenta_destino_id, 'cuenta_destino', cd.apodo,
                 'empresa', coalesce(e.razon_social, c.razon_social),
                 'soporte_nombre', m.soporte_nombre,
                 'creado_por', pc.nombre, 'creado_en', m.creado_en,
                 'editado_por', pe.nombre, 'editado_en', m.editado_en,
                 'eliminado_por', pd.nombre, 'eliminado_en', m.eliminado_en, 'motivo_eliminacion', m.motivo_eliminacion) j
          from public.movimientos_bancarios m
          join public.cuentas_empresa c on c.id = m.cuenta_id
          left join public.bancos b on b.id = c.banco_id
          left join public.empresas e on e.id = c.empresa_id
          left join public.cuentas_empresa cd on cd.id = m.cuenta_destino_id
          left join public.perfiles pc on pc.id = m.creado_por
          left join public.perfiles pe on pe.id = m.editado_por
          left join public.perfiles pd on pd.id = m.eliminado_por
         where (p_cuenta_id is null or m.cuenta_id = p_cuenta_id or m.cuenta_destino_id = p_cuenta_id)
           and (p_tipo is null or m.tipo = p_tipo)
           and (p_desde is null or m.fecha >= p_desde)
           and (p_hasta is null or m.fecha <= p_hasta)
           and (coalesce(p_eliminados, false) or m.eliminado_en is null)
         order by m.fecha desc, m.creado_en desc, m.id
         offset greatest(coalesce(p_offset, 0), 0)
         limit least(greatest(coalesce(p_limite, 50), 1), 201)
      ) f
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.listar_movimientos_bancarios(uuid, text, date, date, boolean, integer, integer) from public, anon;
grant execute on function public.listar_movimientos_bancarios(uuid, text, date, date, boolean, integer, integer) to authenticated;

-- Consolidado Gerencia: ingresos y egresos externos (no traslados) de las
-- semanas (ISO, por la fecha del movimiento) y filtros elegidos. Hasta 500.
create or replace function public.movimientos_consolidado_gerencia(
  p_tipos text[], p_anios integer[], p_semanas integer[], p_empresa_id uuid, p_titular text,
  p_solicitante_id uuid, p_creado_desde timestamptz[], p_creado_hasta timestamptz[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.es_admin(auth.uid()) or public.tiene_pestana(auth.uid(), 'ayf.consolidado_gerencia')) then
    raise exception 'No autorizado -- no tienes el Consolidado Gerencia.';
  end if;
  return coalesce((
    select jsonb_agg(f.j order by f.fecha desc, f.codigo)
      from (
        select m.fecha, m.codigo, jsonb_build_object(
                 'id', m.id, 'codigo', m.codigo, 'tipo', m.tipo, 'fecha', m.fecha, 'valor', m.valor,
                 'concepto', m.concepto, 'titular', m.titular,
                 'anio', extract(isoyear from m.fecha)::int, 'semana', extract(week from m.fecha)::int,
                 'cuenta', c.apodo, 'banco', b.nombre, 'empresa_id', c.empresa_id,
                 'empresa', coalesce(e.razon_social, c.razon_social),
                 'soporte_nombre', m.soporte_nombre, 'creado_por', pc.nombre, 'creado_en', m.creado_en) j
          from public.movimientos_bancarios m
          join public.cuentas_empresa c on c.id = m.cuenta_id
          left join public.bancos b on b.id = c.banco_id
          left join public.empresas e on e.id = c.empresa_id
          left join public.perfiles pc on pc.id = m.creado_por
         where m.eliminado_en is null
           and m.tipo = any (coalesce(p_tipos, '{}') ) and m.tipo in ('ingreso', 'egreso')
           and (coalesce(array_length(p_anios, 1), 0) = 0 or extract(isoyear from m.fecha)::int = any (p_anios))
           and (coalesce(array_length(p_semanas, 1), 0) = 0 or extract(week from m.fecha)::int = any (p_semanas))
           and (p_empresa_id is null or c.empresa_id = p_empresa_id)
           and (nullif(btrim(coalesce(p_titular, '')), '') is null or m.titular ilike '%' || btrim(p_titular) || '%')
           and (p_solicitante_id is null or m.creado_por = p_solicitante_id)
           and (coalesce(array_length(p_creado_desde, 1), 0) = 0
                or exists (select 1 from unnest(p_creado_desde, p_creado_hasta) r(desde, hasta)
                            where m.creado_en >= r.desde and m.creado_en < r.hasta))
         order by m.fecha desc, m.codigo
         limit 500
      ) f
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.movimientos_consolidado_gerencia(text[], integer[], integer[], uuid, text, uuid, timestamptz[], timestamptz[]) from public, anon;
grant execute on function public.movimientos_consolidado_gerencia(text[], integer[], integer[], uuid, text, uuid, timestamptz[], timestamptz[]) to authenticated;

-- 6. eliminar_empresa: tampoco borra cuentas con saldo de inicio o movimientos ---
select pg_temp._parche('public.eliminar_empresa(uuid)'::regprocedure,
  $a$  if array_length(v_usos, 1) > 0 then$a$,
  $b$  select count(*) into n from public.cuentas_empresa c
   where c.empresa_id = p_empresa_id
     and (exists (select 1 from public.cuentas_saldo_inicial s where s.cuenta_id = c.id)
          or exists (select 1 from public.movimientos_bancarios m where m.cuenta_id = c.id or m.cuenta_destino_id = c.id));
  if n > 0 then v_usos := v_usos || (n || case when n = 1 then ' cuenta con saldos en Balances' else ' cuentas con saldos en Balances' end); end if;

  if array_length(v_usos, 1) > 0 then$b$);

commit;
