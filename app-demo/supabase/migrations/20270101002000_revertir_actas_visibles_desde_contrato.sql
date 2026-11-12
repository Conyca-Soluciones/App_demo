-- Deshace 20270101001800_actas_visibles_desde_contrato (decisión del usuario,
-- 2026-11-12: las actas se quedan en su módulo, el detalle del contrato no las
-- muestra).
--
-- Vuelve puede_ver_actas y la política actas_select a como estaban después de
-- 20261225000000_actas_generales: Actas por grupos, Aprobación de actas
-- (Consulta de actas) o Actas generales, y el proyecto. No toca las otras
-- políticas de actas (actas_select_de_pagos, actas_select_autorizacion) ni los
-- permisos de la función (create or replace los conserva).
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
          or public.tiene_pestana(auth.uid(), 'contratos.actas_generales'))
     and public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id)
$$;

drop policy if exists actas_select on public.actas;
create policy actas_select on public.actas for select to authenticated
  using (((select public.tiene_pestana((select auth.uid()), 'contratos.cortes'))
          or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_actas'))
          or (select public.tiene_pestana((select auth.uid()), 'contratos.actas_generales')))
         and exists (select 1 from public.contratos c
                      where c.id = actas.contrato_id
                        and c.proyecto_id in (select public.proyectos_visibles((select auth.uid())))));
