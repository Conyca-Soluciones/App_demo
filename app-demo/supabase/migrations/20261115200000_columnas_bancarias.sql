-- S2 (segunda parte): nadie lee banco, tipo_cuenta ni numero_cuenta directo de
-- la tabla contratistas; quien tiene la acción ver_datos_bancarios los pide con
-- datos_bancarios_contratistas (20261115100000). Va aparte porque hay que
-- aplicarla DESPUÉS de desplegar el código que ya no selecciona esas columnas
-- (si no, Contratistas deja de cargar mientras tanto).
-- Se puede correr más de una vez.

-- Se quita el permiso de leer la tabla completa y se da columna por columna,
-- sin banco, tipo_cuenta ni numero_cuenta. Las escrituras siguen por
-- crear_contratista / editar_contratista (SECURITY DEFINER).
revoke select on public.contratistas from anon, authenticated;
grant select (
  id, tipo_persona, tipo_documento, numero_documento, digito_verificacion, nombre,
  representante_nombre, representante_tipo_documento, representante_numero_documento,
  correo, telefono, direccion, ciudad, created_by, created_at, updated_at, updated_by, cedula_expedida_en
) on public.contratistas to authenticated;

