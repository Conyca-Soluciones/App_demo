-- Corregir el tipo de documento del tercero también corrige el del proveedor (2026-11-24).
--
-- _proveedor_desde_tercero deja el proveedor en NIT si el tercero es NIT o si el proveedor
-- ya estaba en NIT (la persona con cédula que factura con NIT). Por esa segunda regla, si
-- A&F corregía un tercero creado por error como NIT y lo pasaba a CC, el proveedor seguía
-- en NIT con el número de la cédula y un DV calculado sobre ella.
-- Ahora _tercero_a_proveedor, cuando el tercero DEJA de ser NIT, pone al proveedor en el
-- tipo nuevo del tercero. Los demás casos no cambian: un tercero CC cuyo proveedor factura
-- con NIT (hoy 102) sigue igual mientras el tercero no cambie de NIT a otro tipo.
-- Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

create or replace function public._tercero_a_proveedor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (new.tipo_documento, new.numero_documento, new.razon_social, new.correo, new.telefono, new.direccion, new.ciudad)
     is distinct from (old.tipo_documento, old.numero_documento, old.razon_social, old.correo, old.telefono, old.direccion, old.ciudad) then
    if old.tipo_documento = 'NIT' and new.tipo_documento is distinct from 'NIT' then
      -- El tercero dejó de ser NIT (estaba mal creado): el proveedor sigue su tipo nuevo.
      update public.proveedores set tipo_documento = new.tipo_documento where tercero_id = new.id;
    else
      update public.proveedores set tercero_id = tercero_id where tercero_id = new.id;
    end if;
  end if;
  return null;
end;
$function$;

commit;
