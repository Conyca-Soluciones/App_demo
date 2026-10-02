-- Solo para cargar el volcado en un Postgres vacío (sin Supabase). En Supabase ya existen.
do $$ begin if not exists (select 1 from pg_roles where rolname=$q$anon$q$) then create role anon; create role authenticated; create role service_role; end if; end $$;
create schema extensions; create schema auth; create schema storage; create schema vault;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function auth.role() returns text language sql stable as $$ select 'authenticated' $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[], owner uuid);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
