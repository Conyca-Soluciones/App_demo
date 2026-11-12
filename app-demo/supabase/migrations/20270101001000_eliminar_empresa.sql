-- Eliminar empresa (Admin › Empresas), 2026-11-12. Antes la app borraba la fila
-- directo y casi todas fallaban por sus cuentas a debitar (cuentas_empresa, sin
-- borrado en cascada); el error salía lejos del botón y parecía que no hacía
-- nada.
--
-- eliminar_empresa(id): solo Administrador. No borra si la empresa tiene
-- proyectos, pagos, órdenes de compra, ítems de pagos administrativos, saldos a
-- favor o cuentas a debitar ya usadas (pagos o dispersores): dice qué tiene. Si
-- no, borra sus cuentas a debitar sin uso y la empresa (sus cuentas bancarias y
-- representantes se borran en cascada, como siempre). Solo agrega.
-- Reversa: drop function public.eliminar_empresa(uuid);

begin;

create or replace function public.eliminar_empresa(p_empresa_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_usos text[] := '{}';
  n bigint;
begin
  if not public.es_admin(auth.uid()) then
    raise exception 'No autorizado -- solo el Administrador elimina empresas.';
  end if;
  select razon_social into v_nombre from public.empresas where id = p_empresa_id for update;
  if not found then
    raise exception 'La empresa no existe (puede que ya se haya eliminado).';
  end if;

  select count(*) into n from public.proyectos where empresa_id = p_empresa_id;
  if n > 0 then v_usos := v_usos || (n || case when n = 1 then ' proyecto' else ' proyectos' end); end if;
  select count(*) into n from public.pagos where empresa_id = p_empresa_id;
  if n > 0 then v_usos := v_usos || (n || case when n = 1 then ' pago' else ' pagos' end); end if;
  select count(*) into n from public.ordenes_compra where empresa_id = p_empresa_id;
  if n > 0 then v_usos := v_usos || (n || case when n = 1 then ' orden de compra' else ' órdenes de compra' end); end if;
  select count(*) into n from public.requisicion_admin_items where empresa_id = p_empresa_id;
  if n > 0 then v_usos := v_usos || (n || case when n = 1 then ' pago administrativo' else ' pagos administrativos' end); end if;
  select count(*) into n from public.proveedor_saldos_favor where empresa_id = p_empresa_id;
  if n > 0 then v_usos := v_usos || (n || case when n = 1 then ' saldo a favor' else ' saldos a favor' end); end if;
  select count(*) into n from public.cuentas_empresa c
   where c.empresa_id = p_empresa_id
     and (exists (select 1 from public.pagos g where g.cuenta_debitar_id = c.id)
          or exists (select 1 from public.dispersiones d where d.cuenta_empresa_id = c.id));
  if n > 0 then v_usos := v_usos || (n || case when n = 1 then ' cuenta a debitar usada en pagos' else ' cuentas a debitar usadas en pagos' end); end if;

  if array_length(v_usos, 1) > 0 then
    raise exception 'No se puede eliminar "%": tiene %. Esos registros la necesitan.', v_nombre, array_to_string(v_usos, ', ');
  end if;

  delete from public.cuentas_empresa where empresa_id = p_empresa_id;
  delete from public.empresas where id = p_empresa_id;
end;
$$;
revoke all on function public.eliminar_empresa(uuid) from public, anon;
grant execute on function public.eliminar_empresa(uuid) to authenticated;

commit;
