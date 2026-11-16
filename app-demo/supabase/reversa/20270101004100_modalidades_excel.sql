-- Reversa de 20270101004100_modalidades_excel.sql: quita info_modalidades_version.
-- _info_modalidad_item se deja con la corrección (una línea "Es herramienta
-- menor" no es insumo): volver atrás solo reintroduciría el error.

begin;
drop function if exists public.info_modalidades_version(uuid);
commit;
