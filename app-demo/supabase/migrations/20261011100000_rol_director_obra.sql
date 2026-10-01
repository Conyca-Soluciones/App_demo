-- Rol base "Director de obra". Es de sistema (no se borra desde Roles y
-- permisos) porque el módulo de Contratos lo va a buscar por su clave: por
-- ejemplo, el aviso de contrato vencido sin acta de liquidación.
--
-- Arranca con: ver y crear contratistas. El resto de pestañas y acciones se
-- le asignan desde la matriz de Roles y permisos.

insert into public.roles (clave, nombre, es_sistema, orden)
values ('director_obra', 'Director de obra', true, 45)
on conflict (clave) do nothing;

insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
from public.roles r
cross join (values ('tab.contratos.contratistas'), ('accion.gestionar_contratistas')) as p(permiso)
where r.clave = 'director_obra'
on conflict do nothing;
