-- Dos equipos de Contabilidad (decisión del usuario, 2026-10-22; ver
-- 20261210000000_consolidados_separados):
--   * Contabilidad Barranquilla = el rol Contabilidad de siempre, renombrado.
--     Maneja los tres consolidados (Bogotá, Vanur, Otros) y ve Terceros. Sus
--     usuarios se quedan con él.
--   * Contabilidad Bogotá (nuevo): solo el Consolidado Bogotá y Terceros; no ve
--     los otros consolidados (la base tampoco se los da).
-- Ninguno de los dos tiene acciones (aprobar, gestionar pagos, editar o
-- verificar terceros): solo consultan, como el rol de antes.

update public.roles
   set clave = 'contabilidad_barranquilla', nombre = 'Contabilidad Barranquilla'
 where clave = 'contabilidad';

insert into public.roles (clave, nombre, es_sistema, orden)
values ('contabilidad_bogota', 'Contabilidad Bogotá', false, 100)
on conflict (clave) do nothing;

insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
  from public.roles r
 cross join (values ('tab.ayf.consolidado_bogota'), ('tab.ayf.terceros')) as p(permiso)
 where r.clave = 'contabilidad_bogota'
on conflict do nothing;

insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
  from public.roles r
 cross join (values ('tab.ayf.consolidado_bogota'), ('tab.ayf.consolidado_vanur'),
                    ('tab.ayf.consolidado_otros'), ('tab.ayf.terceros')) as p(permiso)
 where r.clave = 'contabilidad_barranquilla'
on conflict do nothing;
