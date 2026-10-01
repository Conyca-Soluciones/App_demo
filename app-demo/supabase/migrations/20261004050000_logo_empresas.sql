-- Logo de cada empresa: imagen reducida en el navegador (máx. 256 px) y
-- guardada como data URL, sin depender de un bucket de Storage.
alter table empresas add column if not exists logo_url text;
