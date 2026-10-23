-- Liquidación en el Consolidado (decisiones del usuario, 2026-10-23). ~300
-- pagos por semana: Financiera los prepara, Contabilidad los liquida (en la
-- pantalla o con el Excel de ida y vuelta) y comenta lo que no puede liquidar,
-- Financiera corrige y los devuelve. Pago por pago, en los tres consolidados.
-- La app NO calcula retenciones: Contabilidad escribe los valores.
--
-- Etapa de cada pago aprobado (pagos.liquidacion_estado; el estado del pago
-- sigue 'aprobado', así no se disparan los seguidores de OC y actas):
--   null          = en preparación (Financiera)
--   por_liquidar  = Financiera lo envió a Contabilidad
--   observado     = Contabilidad comentó algo que falta o está mal
--   liquidado     = Contabilidad lo liquidó (listo para pagar)
--
-- Acciones de la matriz: Gestionar pagos (Financiera: enviar a liquidar,
-- devolver a Contabilidad) y Liquidar pagos (nueva: Contabilidad Bogotá y
-- Barranquilla). Ver el pago sigue la regla de siempre (_ve_pago).

-- 1. Columnas ------------------------------------------------------------------

alter table public.pagos
  add column if not exists liquidacion_estado text,
  add column if not exists liq_base numeric(18,2),
  add column if not exists liq_iva numeric(18,2),
  add column if not exists retefuente numeric(18,2),
  add column if not exists reteiva numeric(18,2),
  add column if not exists reteica numeric(18,2),
  add column if not exists asumidas numeric(18,2),
  add column if not exists liquidaciones numeric(18,2),
  add column if not exists liq_anticipos_descuentos numeric(18,2),
  add column if not exists valor_a_pagar numeric(18,2),
  add column if not exists enviado_liquidar_en timestamptz,
  add column if not exists enviado_liquidar_por uuid references public.perfiles(id),
  add column if not exists liquidado_en timestamptz,
  add column if not exists liquidado_por uuid references public.perfiles(id);
alter table public.pagos drop constraint if exists pagos_liquidacion_estado_check;
alter table public.pagos add constraint pagos_liquidacion_estado_check
  check (liquidacion_estado is null or liquidacion_estado in ('por_liquidar', 'observado', 'liquidado'));
create index if not exists idx_pagos_consolidado_semana_liquidacion
  on public.pagos(consolidado_id, anio, semana, liquidacion_estado) where item is not null;
create index if not exists idx_pagos_enviado_liquidar_por on public.pagos(enviado_liquidar_por) where enviado_liquidar_por is not null;
create index if not exists idx_pagos_liquidado_por on public.pagos(liquidado_por) where liquidado_por is not null;

-- Comentarios de cada pago (Contabilidad <-> Financiera). Solo por funciones.
create table if not exists public.pago_comentarios (
  id uuid primary key default gen_random_uuid(),
  pago_id uuid not null references public.pagos(id) on delete cascade,
  autor_id uuid not null references public.perfiles(id),
  texto text not null check (btrim(texto) <> '' and length(texto) <= 2000),
  tipo text not null default 'comentario' check (tipo in ('comentario', 'observacion', 'respuesta')),
  creado_en timestamptz not null default now()
);
create index if not exists idx_pago_comentarios_pago on public.pago_comentarios(pago_id, creado_en);
create index if not exists idx_pago_comentarios_autor on public.pago_comentarios(autor_id);
alter table public.pago_comentarios enable row level security;
drop policy if exists pago_comentarios_select on public.pago_comentarios;
create policy pago_comentarios_select on public.pago_comentarios for select to authenticated
  using (exists (select 1 from public.pagos g where g.id = pago_comentarios.pago_id));
revoke insert, update, delete on public.pago_comentarios from anon, authenticated;
grant select on public.pago_comentarios to authenticated;

-- Último comentario y cuántos hay (columna calculada para la lista).
create or replace function public.ultimo_comentario(public.pagos)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object('texto', c.texto, 'tipo', c.tipo, 'creado_en', c.creado_en,
                            'autor', f.nombre,
                            'total', (select count(*) from public.pago_comentarios x where x.pago_id = $1.id))
    from public.pago_comentarios c
    left join public.perfiles f on f.id = c.autor_id
   where c.pago_id = $1.id
   order by c.creado_en desc
   limit 1
$$;

-- 2. Acción nueva ----------------------------------------------------------------

insert into public.rol_permisos (rol_id, permiso)
select r.id, 'accion.liquidar_pagos' from public.roles r
 where r.clave in ('contabilidad_bogota', 'contabilidad_barranquilla')
on conflict do nothing;

-- 3. Funciones ---------------------------------------------------------------------

-- El pago que se va a tocar: existe, se ve y sigue aprobado (no en dispersión,
-- pagado ni anulado). Lo bloquea.
create or replace function public._pago_para_liquidar(p_pago_id uuid)
returns public.pagos
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.pagos;
begin
  select * into v from public.pagos where id = p_pago_id for update;
  if not found or not public._ve_pago(auth.uid(), p_pago_id) then
    raise exception 'El pago no existe o no tienes acceso.';
  end if;
  if v.estado <> 'aprobado' then
    raise exception 'El pago ITEM % ya no se puede liquidar (está %).', coalesce(v.item::text, '—'), v.estado;
  end if;
  return v;
end;
$$;

-- Financiera: de preparación a "por liquidar" (los que ya se enviaron se saltan).
create or replace function public.enviar_pagos_a_liquidar(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para gestionar pagos.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 2000 then
    raise exception 'Como mucho 2000 pagos a la vez.';
  end if;
  for v_id in
    update public.pagos g
       set liquidacion_estado = 'por_liquidar', enviado_liquidar_en = now(), enviado_liquidar_por = auth.uid()
     where g.id = any (coalesce(p_ids, '{}'))
       and g.estado = 'aprobado' and g.liquidacion_estado is null and g.item is not null
       and (public.tiene_pestana(auth.uid(), 'ayf.aprobacion_pagos')
            or g.consolidado_id in (select public._consolidados_visibles(auth.uid())))
    returning g.id
  loop
    perform public._anotar_historial('pago', v_id, 'enviado_liquidar', null, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Un comentario. 'observacion' (Contabilidad): el pago queda observado.
-- 'respuesta' (Financiera): de observado vuelve a por liquidar.
-- 'comentario': cualquiera de las dos acciones, no cambia la etapa.
create or replace function public.comentar_pago(p_pago_id uuid, p_texto text, p_tipo text default 'comentario')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.pagos;
  v_texto text := btrim(coalesce(p_texto, ''));
begin
  if p_tipo not in ('comentario', 'observacion', 'respuesta') then
    raise exception 'Tipo de comentario no válido.';
  end if;
  if (p_tipo = 'observacion' and not public.tiene_accion(auth.uid(), 'liquidar_pagos'))
     or (p_tipo = 'respuesta' and not public.tiene_accion(auth.uid(), 'gestionar_pagos'))
     or (p_tipo = 'comentario' and not (public.tiene_accion(auth.uid(), 'liquidar_pagos')
                                        or public.tiene_accion(auth.uid(), 'gestionar_pagos'))) then
    raise exception 'No autorizado -- no puedes comentar este pago.';
  end if;
  if v_texto = '' then
    raise exception 'Escribe el comentario.';
  end if;
  v := public._pago_para_liquidar(p_pago_id);
  if v.liquidacion_estado is null and p_tipo <> 'comentario' then
    raise exception 'El pago ITEM % todavía no se ha enviado a liquidar.', coalesce(v.item::text, '—');
  end if;
  insert into public.pago_comentarios (pago_id, autor_id, texto, tipo) values (p_pago_id, auth.uid(), left(v_texto, 2000), p_tipo);
  if p_tipo = 'observacion' then
    update public.pagos set liquidacion_estado = 'observado', liquidado_en = null, liquidado_por = null where id = p_pago_id;
    perform public._anotar_historial('pago', p_pago_id, 'observado', null, left(v_texto, 500));
  elsif p_tipo = 'respuesta' and v.liquidacion_estado = 'observado' then
    update public.pagos set liquidacion_estado = 'por_liquidar' where id = p_pago_id;
    perform public._anotar_historial('pago', p_pago_id, 'devuelto_contabilidad', null, left(v_texto, 500));
  end if;
end;
$$;

-- Contabilidad, en lote (la pantalla o el Excel). Cada fila:
--   {pago_id, base, iva, retefuente, reteiva, reteica, asumidas, liquidaciones,
--    anticipos_descuentos, valor_a_pagar, sin_retenciones, comentario}
-- Con comentario nuevo: se guardan los valores escritos y queda observado.
-- Sin retenciones: retenciones en 0 y valor a pagar = el valor del pago.
-- Con valor a pagar: liquidado (lo vacío cuenta 0). Si no: sin cambios.
-- Devuelve una fila por fila: {pago_id, resultado, mensaje}; un error en una
-- fila no deshace las otras.
create or replace function public.liquidar_pagos_lote(p_filas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fila jsonb;
  v public.pagos;
  v_salida jsonb := '[]';
  v_coment text;
  v_ultimo text;
  v_valor numeric;
  v_n jsonb;
  v_campos constant text[] := array['base', 'iva', 'retefuente', 'reteiva', 'reteica', 'asumidas',
                                     'liquidaciones', 'anticipos_descuentos', 'valor_a_pagar'];
  c text;
  v_num numeric;
  v_res text;
begin
  if not public.tiene_accion(auth.uid(), 'liquidar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para liquidar pagos.';
  end if;
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) > 2000 then
    raise exception 'Se esperaba una lista de hasta 2000 pagos.';
  end if;

  for v_fila in select * from jsonb_array_elements(p_filas) loop
    begin
      -- Números: vacío = null; no negativos.
      v_n := '{}';
      foreach c in array v_campos loop
        if nullif(btrim(coalesce(v_fila ->> c, '')), '') is null then
          v_n := v_n || jsonb_build_object(c, null);
        else
          v_num := round((v_fila ->> c)::numeric, 2);
          if v_num < 0 then
            raise exception 'El valor de % no puede ser negativo.', replace(c, '_', ' ');
          end if;
          v_n := v_n || jsonb_build_object(c, v_num);
        end if;
      end loop;

      v := public._pago_para_liquidar((v_fila ->> 'pago_id')::uuid);
      if v.liquidacion_estado is null then
        raise exception 'Financiera todavía no lo ha enviado a liquidar.';
      end if;

      v_coment := nullif(btrim(coalesce(v_fila ->> 'comentario', '')), '');
      select c2.texto into v_ultimo from public.pago_comentarios c2 where c2.pago_id = v.id order by c2.creado_en desc limit 1;
      if v_coment is not null and v_coment is distinct from v_ultimo then
        -- Observación: los valores escritos quedan como borrador.
        update public.pagos
           set liq_base = (v_n ->> 'base')::numeric, liq_iva = (v_n ->> 'iva')::numeric,
               retefuente = (v_n ->> 'retefuente')::numeric, reteiva = (v_n ->> 'reteiva')::numeric,
               reteica = (v_n ->> 'reteica')::numeric, asumidas = (v_n ->> 'asumidas')::numeric,
               liquidaciones = (v_n ->> 'liquidaciones')::numeric,
               liq_anticipos_descuentos = (v_n ->> 'anticipos_descuentos')::numeric,
               valor_a_pagar = (v_n ->> 'valor_a_pagar')::numeric
         where id = v.id;
        perform public.comentar_pago(v.id, v_coment, 'observacion');
        v_res := 'observado';
      elsif coalesce((v_fila ->> 'sin_retenciones')::boolean, false) or (v_n ->> 'valor_a_pagar') is not null then
        if coalesce((v_fila ->> 'sin_retenciones')::boolean, false) then
          v_valor := v.valor;
          v_n := v_n || jsonb_build_object('retefuente', 0, 'reteiva', 0, 'reteica', 0, 'asumidas', 0, 'liquidaciones', 0,
            'anticipos_descuentos', coalesce((v_n ->> 'anticipos_descuentos')::numeric,
                                             v.descuento_anticipos + v.retencion_garantia + v.otros_descuentos));
        else
          v_valor := (v_n ->> 'valor_a_pagar')::numeric;
        end if;
        if v_valor <= 0 then
          raise exception 'El valor a pagar debe ser mayor que cero.';
        end if;
        if v_valor > coalesce(v.valor_documento, v.valor) then
          raise exception 'El valor a pagar no puede ser mayor que el valor del documento.';
        end if;
        if v.liquidacion_estado = 'liquidado'
           and v.valor_a_pagar = v_valor
           and coalesce(v.retefuente, 0) = coalesce((v_n ->> 'retefuente')::numeric, 0)
           and coalesce(v.reteiva, 0) = coalesce((v_n ->> 'reteiva')::numeric, 0)
           and coalesce(v.reteica, 0) = coalesce((v_n ->> 'reteica')::numeric, 0)
           and coalesce(v.asumidas, 0) = coalesce((v_n ->> 'asumidas')::numeric, 0)
           and coalesce(v.liquidaciones, 0) = coalesce((v_n ->> 'liquidaciones')::numeric, 0)
           and coalesce(v.liq_anticipos_descuentos, 0) = coalesce((v_n ->> 'anticipos_descuentos')::numeric, 0)
           and v.liq_base is not distinct from coalesce((v_n ->> 'base')::numeric, v.base_gravable)
           and v.liq_iva is not distinct from coalesce((v_n ->> 'iva')::numeric, v.iva) then
          v_res := 'sin_cambios';
        else
          update public.pagos
             set liq_base = coalesce((v_n ->> 'base')::numeric, v.base_gravable),
                 liq_iva = coalesce((v_n ->> 'iva')::numeric, v.iva),
                 retefuente = coalesce((v_n ->> 'retefuente')::numeric, 0),
                 reteiva = coalesce((v_n ->> 'reteiva')::numeric, 0),
                 reteica = coalesce((v_n ->> 'reteica')::numeric, 0),
                 asumidas = coalesce((v_n ->> 'asumidas')::numeric, 0),
                 liquidaciones = coalesce((v_n ->> 'liquidaciones')::numeric, 0),
                 liq_anticipos_descuentos = coalesce((v_n ->> 'anticipos_descuentos')::numeric, 0),
                 valor_a_pagar = v_valor,
                 liquidacion_estado = 'liquidado', liquidado_en = now(), liquidado_por = auth.uid()
           where id = v.id;
          perform public._anotar_historial('pago', v.id,
            case when v.liquidacion_estado = 'liquidado' then 'reliquidado' else 'liquidado' end,
            jsonb_build_object('valor_a_pagar', v_valor), null);
          v_res := 'liquidado';
        end if;
      else
        v_res := 'sin_cambios';
      end if;
      v_salida := v_salida || jsonb_build_object('pago_id', v.id, 'resultado', v_res, 'mensaje', null);
    exception when others then
      v_salida := v_salida || jsonb_build_object('pago_id', v_fila ->> 'pago_id', 'resultado', 'error', 'mensaje', sqlerrm);
    end;
  end loop;
  return v_salida;
end;
$$;

-- Cuántos pagos hay en cada etapa (las pestañas del Consolidado). Con la RLS
-- de quien consulta.
create or replace function public.conteo_etapas_consolidado(p_consolidado_id uuid, p_anios int[], p_semanas int[])
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'preparacion', count(*) filter (where liquidacion_estado is null and estado = 'aprobado'),
    'por_liquidar', count(*) filter (where liquidacion_estado = 'por_liquidar' and estado = 'aprobado'),
    'observado', count(*) filter (where liquidacion_estado = 'observado' and estado = 'aprobado'),
    'liquidado', count(*) filter (where liquidacion_estado = 'liquidado' and estado = 'aprobado'),
    'todos', count(*))
    from public.pagos
   where consolidado_id = p_consolidado_id and item is not null
     and (coalesce(array_length(p_anios, 1), 0) = 0 or anio = any (p_anios))
     and (coalesce(array_length(p_semanas, 1), 0) = 0 or semana = any (p_semanas))
$$;

revoke all on function public._pago_para_liquidar(uuid) from public, anon, authenticated;
revoke all on function public.enviar_pagos_a_liquidar(uuid[]) from public, anon;
grant execute on function public.enviar_pagos_a_liquidar(uuid[]) to authenticated;
revoke all on function public.comentar_pago(uuid, text, text) from public, anon;
grant execute on function public.comentar_pago(uuid, text, text) to authenticated;
revoke all on function public.liquidar_pagos_lote(jsonb) from public, anon;
grant execute on function public.liquidar_pagos_lote(jsonb) to authenticated;
revoke all on function public.conteo_etapas_consolidado(uuid, int[], int[]) from public, anon;
grant execute on function public.conteo_etapas_consolidado(uuid, int[], int[]) to authenticated;
revoke all on function public.ultimo_comentario(public.pagos) from public, anon;
grant execute on function public.ultimo_comentario(public.pagos) to authenticated;
