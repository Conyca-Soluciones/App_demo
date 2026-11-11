-- Deshace 20261231999100_facturas_orden_compra.sql. OJO: borra las facturas
-- registradas (y su historial queda). Correr solo si hace falta volver atrás.
-- Los archivos ya subidos al bucket quedan huérfanos (no se borran aquí).
begin;

-- _motivo_orden_no_modificable vuelve a su versión anterior (quita el bloque).
do $$
declare
  d text := pg_get_functiondef('public._motivo_orden_no_modificable(uuid)'::regprocedure);
  bloque text := '  if exists (select 1 from orden_compra_facturas f where f.orden_compra_id = p_orden_id and f.anulada_at is null) then
    return ''La orden ya tiene facturas registradas: anúlalas antes de modificarla.'';
  end if;
';
begin
  if position(bloque in d) > 0 then
    execute replace(d, bloque, '');
  end if;
end $$;

drop function if exists public.registrar_factura_orden(uuid, jsonb);
drop function if exists public.anular_factura_orden(uuid, text);

-- Políticas del bucket como estaban.
drop policy if exists ordenes_compra_archivos_select on storage.objects;
create policy ordenes_compra_archivos_select on storage.objects for select to authenticated
  using (bucket_id = 'ordenes_compra' and exists (select 1 from public.orden_compra_soportes s where s.ruta = objects.name));
drop policy if exists ordenes_compra_archivos_delete on storage.objects;
create policy ordenes_compra_archivos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ordenes_compra'
         and (select public.tiene_accion((select auth.uid()), 'comprar'))
         and not exists (select 1 from public.orden_compra_soportes s where s.ruta = objects.name));

drop table if exists public.orden_compra_factura_items;
drop table if exists public.orden_compra_facturas;

commit;
