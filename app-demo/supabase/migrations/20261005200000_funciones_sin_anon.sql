-- Funciones ejecutables sin iniciar sesión (aviso de Supabase
-- anon_security_definer_function_executable; no estaba en ninguno de los dos
-- reportes).
--
-- Antes: las 80 funciones del schema public se podían llamar con el rol
-- `anon` vía /rest/v1/rpc/<función>, 65 de ellas SECURITY DEFINER (corren
-- con permisos del dueño y saltan RLS). Verificado: precios_efectivos_insumos
-- respondía 200 sin sesión. Las que tienen chequeo propio (ej.
-- listar_usuarios_accesos) se protegían solas; las demás no.
--
-- La app no llama ninguna función antes del login (el login usa Supabase
-- Auth directo), así que se quita EXECUTE a `anon` y a PUBLIC (del que
-- `anon` hereda) y se mantiene para `authenticated` y `service_role`.
-- Los triggers no se ven afectados: Postgres no revisa EXECUTE al dispararlos.

revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;

-- Funciones que se creen de aquí en adelante: tampoco para anon/PUBLIC.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, public;

-- test_fase1_compras: función de PRUEBA que inserta pedidos/órdenes de
-- compra reales. No debe poder llamarla nadie desde la API. (No se borra:
-- es de otra sesión de trabajo; decidir si se elimina.)
revoke execute on function public.test_fase1_compras() from authenticated;
