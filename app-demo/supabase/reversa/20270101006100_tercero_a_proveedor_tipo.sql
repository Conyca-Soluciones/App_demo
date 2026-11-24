-- Reversa de 20270101006100: _tercero_a_proveedor como estaba.
begin;

create or replace function public._tercero_a_proveedor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (new.tipo_documento, new.numero_documento, new.razon_social, new.correo, new.telefono, new.direccion, new.ciudad)
     is distinct from (old.tipo_documento, old.numero_documento, old.razon_social, old.correo, old.telefono, old.direccion, old.ciudad) then
    update public.proveedores set tercero_id = tercero_id where tercero_id = new.id;
  end if;
  return null;
end;
$function$;

commit;
