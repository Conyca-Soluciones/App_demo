-- Las actas se ven desde el contrato (decisión del usuario, 2026-11-12).
--
-- El detalle de un contrato (Contratos por grupos, Contratos generales,
-- Pre-aprobación, Aprobación de contratos) muestra sus actas, su póliza y sus
-- otrosí con lo que se pueda descargar. Pólizas y otrosí ya se leían con esas
-- pestañas (_puede_ver_otrosis / _puede_ver_polizas); las actas no:
-- puede_ver_actas y la política actas_select pedían una pestaña de Actas.
-- Ahora también valen las pestañas que ven contratos (solo lectura: crear y
-- editar siguen exigiendo elaborar_actas). Control del proyecto
-- (admin.visualizacion) no: ve los datos de los contratos, no sus documentos
-- (S1, 20261115100000). Los soportes y los archivos del bucket actas siguen la
-- política de actas.
--
-- Se puede correr más de una vez.

create or replace function public.puede_ver_actas(p_proyecto_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (public.tiene_pestana(auth.uid(), 'contratos.cortes')
          or public.tiene_pestana(auth.uid(), 'contratos.aprobar_actas')
          or public.tiene_pestana(auth.uid(), 'contratos.actas_generales')
          or public.tiene_pestana(auth.uid(), 'contratos.solicitar')
          or public.tiene_pestana(auth.uid(), 'contratos.contratos')
          or public.tiene_pestana(auth.uid(), 'contratos.preaprobacion')
          or public.tiene_pestana(auth.uid(), 'contratos.aprobar_minutas'))
     and public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id)
$$;

drop policy if exists actas_select on public.actas;
create policy actas_select on public.actas for select to authenticated
using (
  ((select public.tiene_pestana((select auth.uid()), 'contratos.cortes'))
   or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_actas'))
   or (select public.tiene_pestana((select auth.uid()), 'contratos.actas_generales'))
   or (select public.tiene_pestana((select auth.uid()), 'contratos.solicitar'))
   or (select public.tiene_pestana((select auth.uid()), 'contratos.contratos'))
   or (select public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion'))
   or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_minutas')))
  and exists (select 1 from public.contratos c
               where c.id = actas.contrato_id
                 and c.proyecto_id in (select public.proyectos_visibles((select auth.uid())))));
