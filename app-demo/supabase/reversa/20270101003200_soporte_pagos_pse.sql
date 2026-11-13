-- Reversa de 20270101003200_soporte_pagos_pse.sql. Las columnas pagos.pago_soporte_*
-- se dejan (con lo ya generado); el parche de deshacer_pago_pse también (no hace daño).

begin;

drop function if exists public.guardar_soportes_pago_manual(jsonb);

drop policy if exists dispersores_comprobante_pse_select on storage.objects;
create policy dispersores_comprobante_pse_select on storage.objects for select to authenticated
  using (bucket_id = 'dispersores' and (storage.foldername(name))[1] = 'pse'
         and name in (select p.pago_comprobante_ruta from public.pagos p where p.pago_comprobante_ruta is not null));
drop policy if exists dispersores_comprobante_pse_delete on storage.objects;
create policy dispersores_comprobante_pse_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dispersores' and (storage.foldername(name))[1] = 'pse'
         and (select public.tiene_accion((select auth.uid()), 'pagar_pse'))
         and name not in (select p.pago_comprobante_ruta from public.pagos p where p.pago_comprobante_ruta is not null));

commit;
