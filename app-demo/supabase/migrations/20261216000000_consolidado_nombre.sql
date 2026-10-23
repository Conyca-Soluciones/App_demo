-- El Consolidado Bogotá se llama solo "Consolidado" (decisión del usuario,
-- 2026-10-23): el equipo de Contabilidad que solo maneja ese consolidado no
-- debe ver pistas de que existen otros (pantalla, menú, avisos y el Excel de
-- liquidación). La clave sigue siendo 'bogota' (pestaña ayf.consolidado_bogota,
-- ruta /ayf/consolidado/bogota); Vanur y Otros no cambian.

update public.consolidados set nombre = 'Consolidado' where clave = 'bogota' and nombre is distinct from 'Consolidado';
