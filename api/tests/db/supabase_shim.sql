-- Test databases only. This file imitates what Supabase already provides (the API roles and the
-- auth schema), so migrations can run on a plain Postgres. It never runs against Supabase.
-- Idempotent: roles are shared by the whole cluster and outlive a test database.

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;

-- Supabase keeps its extensions here; migrations create btree_gist in it.
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY,
    email text
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
    SELECT coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Imitation of Supabase Storage, for test databases only. It has the columns and helper
-- functions that the policies use; Storage's own triggers and the real owner role
-- (supabase_storage_admin) are not imitated. Supabase grants broad privileges on these tables
-- and relies on RLS, so this does the same.
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
    id text PRIMARY KEY,
    name text NOT NULL UNIQUE,
    owner uuid,
    public boolean NOT NULL DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id text REFERENCES storage.buckets (id),
    name text,
    owner uuid,
    owner_id text,
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
    version text,
    user_metadata jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    last_accessed_at timestamptz DEFAULT now()
);

-- Supabase already has RLS enabled here, and migrations never alter this table.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Every path segment except the last.
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
    SELECT (string_to_array(name, '/'))[1:cardinality(string_to_array(name, '/')) - 1]
$$;

-- The last path segment.
CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
    SELECT (string_to_array(name, '/'))[cardinality(string_to_array(name, '/'))]
$$;

-- The part of the file name after its last dot ('' when there is none).
CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
        WHEN storage.filename(name) LIKE '%.%'
            THEN (string_to_array(storage.filename(name), '.'))[
                cardinality(string_to_array(storage.filename(name), '.'))]
        ELSE ''
    END
$$;

GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON storage.objects, storage.buckets TO anon, authenticated, service_role;
