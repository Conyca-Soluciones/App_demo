-- Nueva pestaña "Registro de Requisiciones": se le da a todo rol que ya tiene
-- "Elaboración de requisiciones", para que nadie pierda de vista el registro
-- que antes estaba en esa pantalla. Después se ajusta desde Roles y permisos.
insert into public.rol_permisos (rol_id, permiso)
select rol_id, 'tab.tecnico.registro_pedidos'
from public.rol_permisos
where permiso = 'tab.tecnico.pedidos'
on conflict do nothing;
