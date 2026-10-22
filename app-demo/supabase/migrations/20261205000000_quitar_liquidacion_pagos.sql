-- Quitar la liquidación de pagos de la app (decisión del usuario, 2026-10-22:
-- liquidar 200+ pagos por semana es más rápido en Excel).
--
-- Deshace 20261203000000_liquidacion_pagos, 20261203100000_liquidacion_contexto
-- y 20261204000000_liquidacion_base_iva_factura, MENOS:
--   * el desglose de cada pago (valor_documento, base_gravable, iva,
--     descuento_anticipos, retencion_garantia, otros_descuentos, solicitado_por)
--     y su disparador trg_pago_desglose_origen: el Consolidado los sigue
--     mostrando para liquidar en Excel;
--   * los índices idx_ordenes_compra_items_orden e idx_pagos_orden_tipo;
--   * el rol Contabilidad (conserva Consolidado y Terceros);
--   * el estado 'liquidado' de pagos, que ya era del diseño original de A&F;
--   * los eventos de historial ya escritos (liquidado, reliquidado...).
--
-- Antes de borrar, copia los RUT extraídos, los perfiles tributarios, la
-- memoria por tercero, las liquidaciones y los catálogos en
-- respaldo_liquidacion_20261022 (sin acceso por la API).
--
-- Correr ANTES borrar_pagos_semana33.sql (referencias/), si no se ha corrido.

-- 1. Respaldo -------------------------------------------------------------

create table if not exists public.respaldo_liquidacion_20261022 (
  tabla text not null,
  filas jsonb not null,
  creado_en timestamptz not null default now()
);
alter table public.respaldo_liquidacion_20261022 enable row level security;
revoke all on public.respaldo_liquidacion_20261022 from public, anon, authenticated;

insert into public.respaldo_liquidacion_20261022 (tabla, filas)
select 'rut_extracciones', coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.rut_extracciones x
union all select 'terceros_tributario', coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.terceros_tributario x
union all select 'liquidacion_preferencias', coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.liquidacion_preferencias x
union all select 'pago_liquidaciones', coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.pago_liquidaciones x
union all select 'pago_liquidacion_lineas', coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.pago_liquidacion_lineas x
union all select 'uvt', coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.uvt x
union all select 'retencion_conceptos', coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.retencion_conceptos x
union all select 'ica_actividades', coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.ica_actividades x
union all select 'municipios', coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.municipios x
union all select 'ica_tarifas', coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.ica_tarifas x
union all select 'empresas_retenciones', coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.empresas_retenciones x
union all select 'empresas_reteica_municipios', coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.empresas_reteica_municipios x
union all select 'proyectos_municipio_ica',
  coalesce(jsonb_agg(jsonb_build_object('proyecto_id', p.id, 'municipio_ica_id', p.municipio_ica_id))
           filter (where p.municipio_ica_id is not null), '[]')
  from public.proyectos p;

-- 2. Pagos liquidados vuelven a aprobado ----------------------------------

drop trigger if exists trg_pago_liquidacion_sigue on public.pagos;
update public.pagos set estado = 'aprobado' where estado = 'liquidado' and liquidacion_id is not null;

alter table public.pagos drop constraint if exists pagos_liquidado_con_neto;
alter table public.pagos drop constraint if exists pagos_liquidacion_id_fkey;
drop index if exists public.idx_pagos_liquidacion;
drop index if exists public.idx_pagos_por_liquidar;
alter table public.pagos drop column if exists liquidacion_id, drop column if exists valor_neto;

-- 3. Funciones y disparadores ---------------------------------------------

drop function if exists public.liquidar_pago(uuid, jsonb);
drop function if exists public._liquidar_pago_lineas(uuid, jsonb);
drop function if exists public.deshacer_liquidacion(uuid, text);
drop function if exists public.contexto_liquidacion(uuid[]);
drop function if exists public._recordar_preferencia(text, text, uuid, text, text, numeric);
drop function if exists public._pago_liquidacion_sigue();
drop trigger if exists trg_tercero_perfil_desde_rut on public.terceros;
drop function if exists public._tercero_perfil_desde_rut();
drop function if exists public._perfil_tributario_desde_rut(uuid);
drop function if exists public._clave_nombre_empresa(text);

-- 4. Tablas ---------------------------------------------------------------

drop table if exists public.pago_liquidacion_lineas;
drop table if exists public.pago_liquidaciones;
drop table if exists public.liquidacion_preferencias;
drop table if exists public.terceros_tributario;
drop table if exists public.rut_extracciones;
drop table if exists public.empresas_reteica_municipios;
drop table if exists public.empresas_retenciones;
drop table if exists public.ica_tarifas;
drop index if exists public.idx_proyectos_municipio_ica;
alter table public.proyectos drop column if exists municipio_ica_id;
drop table if exists public.retencion_conceptos;
drop table if exists public.ica_actividades;
drop table if exists public.municipios;
drop table if exists public.uvt;

-- 5. Políticas: las de 20261023000000_ayf_rls_initplan.sql, sin la pestaña
-- de Liquidación.

drop policy if exists pagos_select on public.pagos;
create policy pagos_select on public.pagos
  for select to authenticated
  using ((select
    public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
    or public.tiene_pestana((select auth.uid()), 'ayf.consolidado')
  ));

drop policy if exists terceros_select on public.terceros;
create policy terceros_select on public.terceros
  for select to authenticated
  using ((select
    public.tiene_pestana((select auth.uid()), 'ayf.terceros')
    or public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
    or public.tiene_pestana((select auth.uid()), 'ayf.consolidado')
  ));

drop policy if exists terceros_cuentas_select on public.terceros_cuentas;
create policy terceros_cuentas_select on public.terceros_cuentas
  for select to authenticated
  using ((select
    public.tiene_pestana((select auth.uid()), 'ayf.terceros')
    or public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
    or public.tiene_pestana((select auth.uid()), 'ayf.consolidado')
  ));

-- 6. Permisos de la matriz ------------------------------------------------

delete from public.rol_permisos
 where permiso in ('tab.ayf.liquidacion', 'accion.liquidar_pagos', 'accion.gestionar_retenciones');
