-- Proyecto de los pagos para A&F (2026-11-06). Financiera y Contabilidad no
-- tienen proyectos asignados, así que la tabla `proyectos` (RLS: solo los
-- asignados) les devolvía vacío y el soporte del dispersor salía "(sin
-- proyecto)", igual que la columna Proyecto de los consolidados.
-- `proyectos_de_pagos(ids)` da número, código y nombre SOLO de los proyectos
-- de pagos que la persona ya puede ver (`_ve_pago`). No da acceso a nada más
-- (el selector de proyecto sigue igual). Se puede correr dos veces.

create or replace function public.proyectos_de_pagos(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'numero', p.numero, 'codigo', p.codigo, 'nombre', p.nombre)), '[]'::jsonb)
    from public.proyectos p
   where p.id = any (coalesce(p_ids, '{}'))
     and exists (select 1 from public.pagos g
                  where g.proyecto_id = p.id and public._ve_pago(auth.uid(), g.id)
                  limit 1)
$$;
revoke all on function public.proyectos_de_pagos(uuid[]) from public, anon;
grant execute on function public.proyectos_de_pagos(uuid[]) to authenticated;
