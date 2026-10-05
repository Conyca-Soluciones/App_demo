-- Mueve la extensión pg_trgm del esquema `public` al esquema `extensions`
-- (aviso de seguridad extension_in_public de Supabase).
--
-- Verificado antes de moverla (consulta a pg_proc): las únicas funciones del
-- esquema public que mencionan similarity / word_similarity / show_trgm /
-- *_trgm_ops son las propias de la extensión; ninguna función ni consulta de la
-- app las llama directamente. Los índices trigram existentes (gin_trgm_ops) y
-- las búsquedas con ILIKE siguen funcionando igual: los índices guardan la
-- clase de operadores por referencia, no por nombre de esquema.

create schema if not exists extensions;

do $$
begin
  if exists (
    select 1 from pg_extension
     where extname = 'pg_trgm' and extnamespace = 'public'::regnamespace
  ) then
    alter extension pg_trgm set schema extensions;
  end if;
end $$;
