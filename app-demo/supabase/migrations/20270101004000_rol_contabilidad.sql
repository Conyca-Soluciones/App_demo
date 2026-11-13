-- El rol "Contabilidad Bogotá" se llama solo "Contabilidad" (decisión del usuario, 2026-11-13:
-- quien lo tiene no debe ver pistas de que hay otros consolidados). Solo cambia el nombre; la
-- clave contabilidad_bogota, sus permisos y sus usuarios siguen igual.
-- Reversa: update public.roles set nombre = 'Contabilidad Bogotá' where clave = 'contabilidad_bogota';

update public.roles set nombre = 'Contabilidad' where clave = 'contabilidad_bogota';
