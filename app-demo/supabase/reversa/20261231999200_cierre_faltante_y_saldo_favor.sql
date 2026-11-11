-- Deshace 20261231999200_cierre_faltante_y_saldo_favor.sql (correr después de
-- la reversa de 20261231999300). OJO: borra los saldos a favor y, si alguna OC
-- ya se cerró con faltante, NO le devuelve las cantidades pedidas (quedan en
-- `pedido_original` mientras exista la columna; esta reversa la conserva y
-- deja el CHECK de cantidad como estaba solo si no hay líneas en 0).
begin;

do $$
declare
  d text := pg_get_functiondef('public._motivo_orden_no_modificable(uuid)'::regprocedure);
  bloque text := '  if exists (select 1 from ordenes_compra c where c.id = p_orden_id and c.cerrada_faltante_at is not null) then
    return ''La orden se cerró con faltante: ya no se modifica.'';
  end if;
';
begin
  if position(bloque in d) > 0 then execute replace(d, bloque, ''); end if;
end $$;

delete from public.rol_permisos where permiso = 'tab.compras.saldos_favor';

drop function if exists public.cerrar_saldo_favor(uuid, text);
drop function if exists public.saldos_favor_proveedor(uuid, uuid);
drop function if exists public.listar_saldos_favor(boolean);
drop function if exists public.cerrar_orden_con_faltante(uuid, text);
drop function if exists public.vista_cierre_faltante(uuid);
drop function if exists public._motivo_no_cierre_faltante(uuid);
drop function if exists public._calcular_cierre_faltante(uuid);
drop function if exists public._saldo_favor_disponible(uuid);

drop table if exists public.saldo_favor_aplicaciones;
drop table if exists public.proveedor_saldos_favor;

do $$
begin
  if not exists (select 1 from public.ordenes_compra_items where cantidad = 0) then
    alter table public.ordenes_compra_items drop constraint if exists ordenes_compra_items_cantidad_check;
    alter table public.ordenes_compra_items add constraint ordenes_compra_items_cantidad_check check (cantidad > 0);
  end if;
end $$;

alter table public.ordenes_compra drop column if exists saldo_favor_aplicado;

commit;
