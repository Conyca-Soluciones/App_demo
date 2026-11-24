-- Reversa de 20270101006000: quita los anexos de la requisición (la tabla y sus
-- funciones). Los archivos del bucket "requisiciones" no se borran desde aquí.
begin;
drop function if exists public.eliminar_anexo_requisicion(uuid);
drop function if exists public.agregar_anexo_requisicion(uuid, jsonb);
drop function if exists public._exigir_anexos_requisicion(uuid);
drop policy if exists requisiciones_anexos_select on storage.objects;
drop policy if exists requisiciones_anexos_delete on storage.objects;
drop policy if exists requisiciones_anexos_insert on storage.objects;
drop table if exists public.requisicion_anexos;
commit;
