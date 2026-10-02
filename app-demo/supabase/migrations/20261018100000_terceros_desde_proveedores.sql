-- A&F · Migración 4: crear terceros a partir de los proveedores que todavía no
-- lo son (uso único, desde el SQL Editor).
--
-- Los pagos de órdenes de compra buscan al tercero por el documento del
-- proveedor. Esta función crea los que falten, con sus cuentas bancarias
-- (informacion_bancaria) en estado PENDIENTE: Financiera las verifica después.
--
--   select * from public.crear_terceros_desde_proveedores();
--
-- Es repetible (no duplica). Solo agrega cuentas a los terceros que no tienen
-- ninguna: nunca toca ni mezcla las cuentas ya verificadas. NO se puede llamar
-- desde la API: solo desde el SQL Editor.

create or replace function public.crear_terceros_desde_proveedores()
returns table(
  terceros_creados integer,
  cuentas_creadas integer,
  proveedores_sin_documento_valido integer,
  cuentas_sin_banco_o_tipo integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_terceros integer;
  v_cuentas  integer;
  v_sin_doc  integer;
  v_sin_banco integer;
begin
  select count(*) into v_sin_doc
    from public.proveedores pr
   where pr.numero_documento is null or pr.numero_documento <= 0
      or btrim(coalesce(pr.nombre, '')) = ''
      or upper(btrim(coalesce(pr.tipo_documento, ''))) not in ('CC','NIT','CE','PPT','PA','TI','RC');

  -- Un tercero por documento (si hay varios proveedores con el mismo, gana el activo).
  with candidatos as (
    select distinct on (pr.numero_documento)
           upper(btrim(pr.tipo_documento)) as tipo,
           pr.numero_documento::text as numero,
           pr.digito_verificacion::text as dv,
           upper(regexp_replace(btrim(pr.nombre), '\s+', ' ', 'g')) as nombre
      from public.proveedores pr
     where pr.numero_documento is not null and pr.numero_documento > 0
       and btrim(coalesce(pr.nombre, '')) <> ''
       and upper(btrim(coalesce(pr.tipo_documento, ''))) in ('CC','NIT','CE','PPT','PA','TI','RC')
     order by pr.numero_documento, (upper(btrim(coalesce(pr.estado, ''))) = 'ACTIVO') desc, pr.created_at
  ), ins as (
    insert into public.terceros (tipo_documento, numero_documento, dv, razon_social)
    select tipo, numero, case when tipo = 'NIT' and dv ~ '^[0-9]$' then dv end, nombre
      from candidatos
    on conflict (numero_documento) do nothing
    returning 1
  )
  select count(*) into v_terceros from ins;

  -- Cuentas, solo para terceros que no tienen ninguna.
  with origen as (
    select t.id as tercero_id,
           b.id as banco_id,
           case when upper(ib.tipo_cuenta) like '%AHORR%' then 'AHORROS'
                when upper(ib.tipo_cuenta) like '%CORRIENT%' then 'CORRIENTE' end as tipo,
           regexp_replace(coalesce(ib.no_cuenta, ''), '\D', '', 'g') as numero
      from public.informacion_bancaria ib
      join public.proveedores pr on pr.unique_id = ib.id_proveedor
      join public.terceros t on t.numero_documento = pr.numero_documento::text
      left join public.bancos b on b.nombre = case upper(btrim(ib.entidad_bancaria))
             when 'BANCO DAVIVIENDA' then 'DAVIVIENDA'
             when 'BANCO AV VILLAS'  then 'AV VILLAS'
             when 'NU'               then 'NU BANK'
             else upper(btrim(ib.entidad_bancaria)) end
     where not exists (select 1 from public.terceros_cuentas x where x.tercero_id = t.id)
  ), ins as (
    insert into public.terceros_cuentas (tercero_id, banco_id, tipo_cuenta, numero_cuenta, estado, observaciones)
    select distinct tercero_id, banco_id, tipo, numero, 'PENDIENTE', 'Cargada desde la tabla de proveedores.'
      from origen
     where banco_id is not null and tipo is not null and numero <> ''
    on conflict (tercero_id, banco_id, numero_cuenta) do nothing
    returning 1
  )
  select (select count(*) from ins),
         (select count(*) from origen where banco_id is null or tipo is null or numero = '')
    into v_cuentas, v_sin_banco;

  return query select v_terceros, v_cuentas, v_sin_doc, v_sin_banco;
end;
$$;

revoke all on function public.crear_terceros_desde_proveedores() from public, anon, authenticated;
