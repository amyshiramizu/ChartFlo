-- Compatibility shim: recreates the Supabase primitives that ChartFlo's
-- schema depends on, so supabase/migrations/*.sql apply unchanged on Aurora.

-- Roles referenced by RLS policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END $$;

-- auth.uid(): PostgREST convention — the user id is the JWT 'sub' claim,
-- surfaced by PostgREST as the request.jwt.claims setting.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
$fn$;

-- Minimal auth.users so foreign keys / triggers that reference it resolve.
-- Cognito is the source of truth; this table mirrors ids and emails.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Supabase's storage schema exists only for clinic logos; provide a stub so
-- storage-related policy statements don't fail the migration run. Files
-- themselves move to S3 in a later phase.
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
