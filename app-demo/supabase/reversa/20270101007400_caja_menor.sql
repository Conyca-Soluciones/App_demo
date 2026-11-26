-- Reversa de 20270101007400_caja_menor.sql.
-- Solo si no hay cajas menores en uso: si ya hay legalizaciones o cuadros de caja
-- menor, se detiene (no se borra nada de lo que ya pasó a pagos).
begin;

do $$
begin
  if exists (select 1 from public.caja_menor_legalizaciones) or exists (select 1 from public.requisiciones_admin where tipo = 'caja_menor') then
    raise exception 'Ya hay legalizaciones o cuadros de caja menor: no se puede deshacer sin decidir qué hacer con ellos.';
  end if;
  if exists (select 1 from public.perfiles p join public.roles r on r.id = p.rol_id where r.clave = 'lider_financiera') then
    raise exception 'Hay usuarios con el rol Líder Financiera: cámbialos de rol antes de deshacer.';
  end if;
end;
$$;

-- Parches a funciones vivas (al revés, texto exacto).
do $$
declare
  v text;
  f text;
begin
  foreach f in array array['public.modificar_requisicion_admin(uuid, text, jsonb)', 'public.cancelar_requisicion_admin(uuid, text)'] loop
    v := pg_get_functiondef(f::regprocedure);
    execute replace(v,
         E'  if v_r.tipo = ''caja_menor'' then\n'
      || E'    raise exception ''Este pago es el reembolso de una caja menor: se corrige desde Caja menor.'';\n'
      || E'  end if;\n', '');
  end loop;

  v := pg_get_functiondef('public.detalle_requisicion_admin(uuid)'::regprocedure);
  execute replace(v, $a$'tipo', v_r.tipo,
    'caja_menor_legalizacion_id', (select l.id from public.caja_menor_legalizaciones l where l.requisicion_admin_id = v_r.id order by l.aprobada_en desc nulls last limit 1),
    'editable', v_r.tipo = 'cuadro' and v_r.estado in ('por_aprobar', 'rechazada')$a$,
    $a$'editable', v_r.estado in ('por_aprobar', 'rechazada')$a$);

  foreach f in array array['public.aprobar_requisicion_admin(uuid)', 'public.rechazar_requisicion_admin(uuid, text)'] loop
    v := pg_get_functiondef(f::regprocedure);
    execute replace(v, E'  if v_r.creado_por is distinct from auth.uid() and v_r.tipo = ''cuadro'' then\n',
                       E'  if v_r.creado_por is distinct from auth.uid() then\n');
  end loop;

  v := pg_get_functiondef('public._drive_destino(text, text)'::regprocedure);
  execute regexp_replace(v, E'  elsif p_bucket = ''cajas_menores'' then\n.*?    end if;\n\n(  elsif p_bucket = ''sinco'' then\n)', E'\\1');

  v := pg_get_functiondef('public._pendientes_de(uuid)'::regprocedure);
  execute regexp_replace(v,
    E'   group by c.id, c.numero, c.archivo, c.cargado_en, c.cargado_por\n\n  -- -+ Caja menor \\(20270101007400\\)\n.*;\n(end;)',
    E'   group by c.id, c.numero, c.archivo, c.cargado_en, c.cargado_por;\n\\1');
end;
$$;

drop trigger if exists trg_caja_menor_sigue_cuadro on public.requisiciones_admin;

drop function if exists public.personas_caja_menor();
drop function if exists public.legalizacion_de_cuadro(uuid);
drop function if exists public.detalle_legalizacion_caja_menor(uuid);
drop function if exists public.listar_legalizaciones_caja_menor(text, boolean);
drop function if exists public._legalizacion_caja_menor_fila(uuid);
drop function if exists public._caja_menor_sigue_cuadro();
drop function if exists public.aprobar_legalizacion_caja_menor(uuid, text, text, jsonb);
drop function if exists public.revisar_legalizacion_caja_menor(uuid, text, text);
drop function if exists public._devolver_legalizacion_caja_menor(public.caja_menor_legalizaciones, text, text);
drop function if exists public.cancelar_legalizacion_caja_menor(uuid, text);
drop function if exists public.enviar_legalizacion_caja_menor(uuid, jsonb);
drop function if exists public._guardar_gastos_caja_menor(uuid, uuid, jsonb);
drop function if exists public.listar_cajas_menores(boolean);
drop function if exists public.mi_caja_menor();
drop function if exists public._caja_menor_json(uuid);
drop function if exists public.cerrar_caja_menor(uuid, text);
drop function if exists public.guardar_caja_menor(uuid, jsonb);
drop function if exists public._enmascarar_cuenta(text);
drop function if exists public._evento_caja_menor(uuid, text, text, jsonb);
drop function if exists public._avisar_caja_menor(uuid[], text, uuid, text, text);
drop function if exists public._usuarios_con_accion_caja(text);

drop policy if exists cajas_menores_archivos_insert on storage.objects;
drop policy if exists cajas_menores_archivos_select on storage.objects;
drop policy if exists cajas_menores_archivos_delete on storage.objects;
drop function if exists public._rutas_cajas_menores_visibles();
-- El bucket se borra solo si quedó vacío (los archivos se borran desde el panel).
delete from storage.buckets b where b.id = 'cajas_menores'
   and not exists (select 1 from storage.objects o where o.bucket_id = 'cajas_menores');

drop table if exists public.caja_menor_gastos;
drop table if exists public.caja_menor_legalizaciones;
drop table if exists public.cajas_menores;
drop function if exists public._ve_cajas_menores(uuid);

delete from public.rol_permisos
 where permiso in ('tab.ayf.cajas_menores', 'accion.gestionar_cajas_menores', 'accion.aprobar_cajas_menores');
delete from public.rol_permisos where rol_id = (select id from public.roles where clave = 'lider_financiera');
delete from public.roles where clave = 'lider_financiera';

-- Los tipos nuevos de avisos e historial se dejan en los CHECK (no estorban).

alter table public.requisicion_admin_items drop constraint if exists requisicion_admin_items_soporte_check;
alter table public.requisicion_admin_items add constraint requisicion_admin_items_soporte_check check (
  (soporte_ruta is null and soporte_tipo is null)
  or (soporte_ruta is not null and soporte_tipo in ('factura', 'cuenta_cobro') and btrim(coalesce(soporte_nombre, '')) <> ''));
alter table public.requisiciones_admin drop constraint if exists requisiciones_admin_tipo_check;
alter table public.requisiciones_admin drop column if exists tipo;

commit;
