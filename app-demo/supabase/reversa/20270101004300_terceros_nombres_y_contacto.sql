-- Reversa de 20270101004300_terceros_nombres_y_contacto.sql. Las columnas nuevas de terceros
-- (casillas del nombre y contacto) se dejan con lo que tengan. crear_tercero,
-- tercero_por_documento y los disparadores de contratistas y proveedores vuelven a su versión
-- anterior corriendo otra vez sus definiciones de 20270101001100_tercero_sin_cuenta.sql y
-- 20261223000000_proveedores_tercero.sql / 20261222000000_contratistas_tercero.sql.

begin;

drop trigger if exists trg_tercero_nombre on public.terceros;
drop function if exists public._tercero_nombre();
drop function if exists public.actualizar_contacto_tercero(uuid, jsonb);
drop function if exists public._validar_contacto_tercero(jsonb);

commit;
