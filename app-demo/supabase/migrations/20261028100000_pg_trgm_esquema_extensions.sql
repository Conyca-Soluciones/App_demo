-- Mueve la extensión pg_trgm del esquema `public` al esquema `extensions`
-- (aviso de seguridad extension_in_public de Supabase).
--
-- Los índices trigram existentes (gin_trgm_ops / gist_trgm_ops) y las
-- búsquedas con ILIKE siguen funcionando igual: los índices guardan la clase
-- de operadores por referencia, no por nombre de esquema.
--
-- OJO (corregido al mezclar con la rama de unidades): las búsquedas de
-- candidatos (buscar_insumos_candidatos, buscar_insumos_candidatos_lote,
-- buscar_mano_obra_candidatos, buscar_equipo_candidatos...) usan el operador
-- `<->` de pg_trgm y tienen `search_path = public`. Con la extensión en
-- `extensions`, Postgres ya no encuentra el operador ("operator does not
-- exist: text <-> text") y el import de APU deja de funcionar. Por eso, en la
-- misma transacción, a toda función de `public` con search_path fijo que use
-- operadores o funciones de pg_trgm se le agrega `extensions` al search_path.
-- Probado en la copia local del esquema.

create schema if not exists extensions;

do $$
declare
  f record;
begin
  if exists (
    select 1 from pg_extension
     where extname = 'pg_trgm' and extnamespace = 'public'::regnamespace
  ) then
    alter extension pg_trgm set schema extensions;
  end if;

  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and not exists (select 1 from pg_depend d
                        where d.objid = p.oid and d.deptype = 'e')   -- no las de la extensión
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
       and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%extensions%')
       and p.prosrc ~ '(<->|<<->|<%|%>|\s%\s|similarity\(|word_similarity\(|show_trgm\()'
  loop
    execute format('alter function %s set search_path = public, extensions', f.firma);
  end loop;
end $$;
