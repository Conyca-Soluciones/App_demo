-- Textos que todavía decían el número viejo (revisión del 2026-11-06):
-- * aviso al aprobar o rechazar una requisición: "Tu requisición #12" -> RQ-001-0012;
-- * aviso de precio alto en una línea de OC: "Orden de compra #5" -> OC-001-0005;
-- * historial de una entrada de almacén: la orden se guarda con su código.
-- Parches por texto exacto sobre las funciones VIVAS. Se puede correr dos
-- veces. Va después de 20261231400000.

do $$
declare
  d text;
  i int;
  p text[][] := array[
    ['public._resolver_requisicion_sin_proyecto', ''' #'' || v_h.numero', ''' '' || v_h.codigo'],
    ['public.notificar_precio_sobre_efectivo_oc_item', 'Orden de compra #'' || v_numero_orden', 'Orden de compra '' || coalesce((select codigo from public.ordenes_compra where id = new.orden_compra_id), ''?'')'],
    ['public._historial_entrada', '''orden'', (select o.numero from public.ordenes_compra o', '''orden'', (select o.codigo from public.ordenes_compra o']
  ];
  f regprocedure;
begin
  for i in 1 .. array_length(p, 1) loop
    select oid::regprocedure into f from pg_proc
     where pronamespace = 'public'::regnamespace and proname = replace(p[i][1], 'public.', '')
     order by oid limit 1;
    if f is null then
      raise exception 'No existe la función %.', p[i][1];
    end if;
    d := pg_get_functiondef(f);
    if position(p[i][2] in d) = 0 then
      if position(p[i][3] in d) > 0 then
        continue;  -- ya aplicado
      end if;
      raise exception '% no tiene el texto esperado: %', f, p[i][2];
    end if;
    execute replace(d, p[i][2], p[i][3]);
  end loop;
end $$;
