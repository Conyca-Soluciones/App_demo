-- Caja menor: el soporte del reembolso (la relación de gastos en PDF que se genera
-- cuando Líder Financiera la aprueba) lleva las firmas registradas ("Mi firma")
-- del responsable, de quien revisó en Financiera y de quien aprueba (decisión del
-- usuario, 2026-11-26). firmas_usuario solo la lee su dueño: esta función las da
-- a quien aprueba cajas menores, solo para esa legalización. Sin firma
-- registrada, el PDF deja el nombre y la línea para firmar.
-- Reversa: supabase/reversa/20270101007700_caja_menor_firmas.sql
begin;

create or replace function public.firmas_caja_menor(p_legalizacion uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_l public.caja_menor_legalizaciones;
begin
  if not (public.es_admin(auth.uid()) or public.tiene_accion(auth.uid(), 'aprobar_cajas_menores')) then
    raise exception 'No autorizado.';
  end if;
  select * into v_l from public.caja_menor_legalizaciones where id = p_legalizacion;
  if v_l.id is null then
    raise exception 'La legalización no existe.';
  end if;
  return jsonb_build_array(
    (select jsonb_build_object('papel', 'responsable', 'nombre', p.nombre, 'fecha', v_l.enviada_en,
                               'imagen', (select f.imagen from public.firmas_usuario f where f.perfil_id = p.id))
       from public.perfiles p where p.id = v_l.responsable_id),
    (select jsonb_build_object('papel', 'revisor', 'nombre', p.nombre, 'fecha', v_l.revisada_en,
                               'imagen', (select f.imagen from public.firmas_usuario f where f.perfil_id = p.id))
       from public.perfiles p where p.id = v_l.revisada_por),
    (select jsonb_build_object('papel', 'aprobador', 'nombre', p.nombre, 'fecha', now(),
                               'imagen', (select f.imagen from public.firmas_usuario f where f.perfil_id = p.id))
       from public.perfiles p where p.id = auth.uid()));
end;
$$;
revoke execute on function public.firmas_caja_menor(uuid) from public;
grant execute on function public.firmas_caja_menor(uuid) to authenticated;

commit;
