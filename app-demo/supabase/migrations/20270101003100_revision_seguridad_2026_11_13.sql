-- Revisión de seguridad y rendimiento de los cambios del 12 y 13 de noviembre (2026-11-13).
-- No toca datos.
-- 1. _norm_texto_sinco y _norm_banco_sinco: search_path fijo (aviso de Supabase).
-- 2. _cuadros_sinco_visibles: la acción se revisa una vez por consulta, no por cada cuadro.
-- 3. respaldo_informacion_bancaria_20261023 tenía la RLS apagada; nadie tenía permiso por
--    la API, pero se enciende (sin políticas: solo el dueño la lee).

begin;

alter function public._norm_texto_sinco(text) set search_path = public;
alter function public._norm_banco_sinco(text) set search_path = public;

create or replace function public._cuadros_sinco_visibles(p_uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id from public.sinco_cuadros c where (select public.tiene_accion(p_uid, 'cargar_cuadros_sinco'))
  union
  select u.cuadro_id from public.sinco_cuadro_usuarios u
   where u.usuario_id = p_uid and not (select public.tiene_accion(p_uid, 'cargar_cuadros_sinco'))
$$;
revoke all on function public._cuadros_sinco_visibles(uuid) from public, anon;
grant execute on function public._cuadros_sinco_visibles(uuid) to authenticated;  -- se usa en políticas

alter table public.respaldo_informacion_bancaria_20261023 enable row level security;

commit;
