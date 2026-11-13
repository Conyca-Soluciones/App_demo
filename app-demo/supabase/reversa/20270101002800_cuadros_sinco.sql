-- Reversa de 20270101002800_cuadros_sinco.sql. Solo sirve si no se ha cargado ningún
-- cuadro (los pagos de SINCO no se borran aquí: si los hay, primero anular los cuadros
-- y decidir qué hacer con esos pagos). Los parches a _pago_novedad,
-- enviar_pagos_a_liquidar, _pago_sincronizar_empresa, _encolar_correo_notificacion,
-- _pendientes_de y _titulo_pendiente se quitan a mano (dejarlos no hace daño: sin
-- filas de SINCO no cambian nada). Los tipos de aviso nuevos se dejan en la lista.

begin;

do $$
begin
  if exists (select 1 from public.pagos where fuente = 'sinco') then
    raise exception 'Hay pagos de SINCO: no se puede revertir así.';
  end if;
end;
$$;

drop function if exists public.cargar_cuadro_sinco(text, jsonb, uuid[], boolean);
drop function if exists public.usuarios_para_cuadro_sinco();
drop function if exists public.listar_cuadros_sinco();
drop function if exists public.pagos_cuadro_sinco(uuid);
drop function if exists public.fijar_usuarios_cuadro_sinco(uuid, uuid[]);
drop function if exists public.guardar_soporte_sinco(uuid, text, text, text);
drop function if exists public.anular_cuadro_sinco(uuid, text);
drop function if exists public._avisar_cuadro_sinco(uuid, uuid[]);
drop function if exists public._norm_banco_sinco(text);
drop function if exists public._norm_texto_sinco(text);
drop policy if exists sinco_soportes_insert on storage.objects;
drop policy if exists sinco_soportes_delete on storage.objects;
drop policy if exists sinco_soportes_select on storage.objects;

alter table public.pagos drop constraint if exists pagos_fuente_coherente;
alter table public.pagos add constraint pagos_fuente_coherente check (
  ((fuente = 'orden_compra') = (orden_compra_id is not null))
  and ((fuente = 'acta') = (acta_id is not null))
  and ((fuente = 'requisicion_admin') = (requisicion_admin_id is not null)));
alter table public.pagos drop constraint if exists pagos_fuente_check;
alter table public.pagos add constraint pagos_fuente_check
  check (fuente = any (array['orden_compra', 'acta', 'requisicion_admin']));
drop index if exists public.pagos_sinco_fila;
alter table public.pagos drop column if exists sinco_fila_id cascade;

drop table if exists public.sinco_filas;
drop table if exists public.sinco_cuadro_usuarios;
drop table if exists public.sinco_cuadros;
drop function if exists public._cuadros_sinco_visibles(uuid);

delete from public.rol_permisos where permiso in ('tab.ayf.cuadros_sinco', 'accion.cargar_cuadros_sinco');
update public.ajustes_correo set tipos = array_remove(tipos, 'cuadro_sinco_soportes') where id;

commit;
