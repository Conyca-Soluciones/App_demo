-- Reversa de 20270101006600_pestana_informes_pagos.sql: quita la pestaña Informes de todos los roles.
delete from public.rol_permisos where permiso = 'tab.ayf.informes';
