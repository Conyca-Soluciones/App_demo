-- Revisión del 2026-11-06 (Auditoría):
-- * Adjuntar la certificación bancaria salía como "Cuenta editada" sin
--   detalle. Ahora es 'cuenta_certificacion' (con el nombre del archivo) y
--   las demás ediciones de una cuenta traen qué cambió ('cambios').
-- * Las actas salían "Acta 1"; en la app son "Acta 01".
-- Parches por texto exacto sobre las funciones VIVAS. Se puede correr dos
-- veces. Va después de 20261231600000.

do $$
declare
  d text;
  i int;
  f regprocedure;
  p text[][] := array[
    ['public._eventos_terceros_auditoria(bigint[])',
     'else ''cuenta_editada''',
     'when a.despues ->> ''certificacion_ruta'' is distinct from a.antes ->> ''certificacion_ruta'' then ''cuenta_certificacion'' else ''cuenta_editada'''],
    ['public._eventos_terceros_auditoria(bigint[])',
     '''estado'', coalesce(a.despues, a.antes) ->> ''estado'')',
     '''estado'', coalesce(a.despues, a.antes) ->> ''estado'', '
       || '''certificacion'', case when a.accion = ''UPDATE'' and a.despues ->> ''certificacion_ruta'' is distinct from a.antes ->> ''certificacion_ruta'' then a.despues ->> ''certificacion_nombre'' end, '
       || '''cambios'', case when a.accion = ''UPDATE'' then public._jsonb_cambios(a.antes, a.despues, array[''id'', ''tercero_id'', ''creado_por'', ''creado_en'', ''banco_id'', ''tipo_cuenta'', ''numero_cuenta'', ''estado'', ''verificada_en'', ''verificada_por'', ''certificacion_ruta'', ''certificacion_nombre'', ''certificacion_mime'', ''certificacion_subida_en'', ''certificacion_subida_por'']) end)'],
    ['public.listar_auditoria(text, uuid, date, date, integer, integer)',
     '''Acta '' || a.numero || '' · ''',
     '''Acta '' || lpad(a.numero::text, 2, ''0'') || '' · ''']
  ];
begin
  for i in 1 .. array_length(p, 1) loop
    f := p[i][1]::regprocedure;
    d := pg_get_functiondef(f);
    -- Primero si ya está aplicado (el texto nuevo del primero contiene el viejo).
    if position(p[i][3] in d) > 0 then
      continue;
    end if;
    if position(p[i][2] in d) = 0 then
      raise exception '% no tiene el texto esperado: %', f, p[i][2];
    end if;
    execute replace(d, p[i][2], p[i][3]);
  end loop;
end $$;
