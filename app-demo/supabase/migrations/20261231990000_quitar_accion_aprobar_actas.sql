-- El permiso `accion.aprobar_actas` no tiene efecto desde 20261112100000: el
-- acta se aprueba o se rechaza con su pago en Aprobación de pagos (acción
-- `aprobar_pagos`) y ninguna función, política ni pantalla lo consulta. Se
-- borra de todos los roles.
-- La pestaña `contratos.aprobar_actas` NO cambia: da la lectura de las actas
-- (`actas_select`, `puede_ver_actas`, `listar_actas_aprobacion`); en pantalla
-- ahora se llama "Consulta de actas" (solo el título, la clave sigue igual).
-- Se puede correr dos veces. Va después de 20261231980000.

delete from public.rol_permisos where permiso = 'accion.aprobar_actas';
