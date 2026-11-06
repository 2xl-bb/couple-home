-- Initial durable schema for the Render/Supabase deployment. Keep this file
-- immutable after it has been applied; future changes belong in new migrations.
CREATE TABLE home_events (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE members (
  user_id TEXT PRIMARY KEY,
  slot INTEGER NOT NULL UNIQUE CHECK (slot IN (1, 2)),
  display_name TEXT NOT NULL,
  last_seen BIGINT NOT NULL
);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  caption TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  user_id TEXT NOT NULL
);

CREATE TABLE room_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE auth_attempts (
  ip_hash TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE home_keys (
  slot INTEGER PRIMARY KEY CHECK (slot IN (1, 2)),
  key_hash TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE home_sessions (
  token_hash TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE member_passwords (
  slot INTEGER PRIMARY KEY CHECK (slot IN (1, 2)),
  user_id TEXT NOT NULL,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  version TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE recovery_codes (
  slot INTEGER PRIMARY KEY CHECK (slot IN (1, 2)),
  code_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE photo_ai (
  photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  tags TEXT NOT NULL,
  category TEXT NOT NULL,
  embedding TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE photo_ai_jobs (
  photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);

CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  caption TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  created_at BIGINT NOT NULL,
  user_id TEXT NOT NULL,
  owner_slot INTEGER NOT NULL CHECK (owner_slot IN (1, 2)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready'))
);

CREATE TABLE identity_names (
  slot INTEGER PRIMARY KEY CHECK (slot IN (1, 2)),
  name TEXT NOT NULL
);
INSERT INTO identity_names (slot, name) VALUES (1, '成员一'), (2, '成员二');

-- Supabase may grant public-schema tables to its Data API roles by default.
-- The app uses a server-side postgres connection, so API roles need no access.
ALTER TABLE public.home_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.home_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.home_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_passwords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_ai ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_names ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.home_events, public.members, public.photos, public.room_state,
  public.auth_attempts, public.home_keys, public.home_sessions,
  public.member_passwords, public.recovery_codes, public.photo_ai,
  public.photo_ai_jobs, public.videos, public.identity_names
FROM PUBLIC;

-- Supabase defines Data API roles; Neon and ordinary PostgreSQL do not. Revoke
-- those roles only when they exist so the same migration is portable.
DO $roles$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.home_events, public.members, public.photos, public.room_state, public.auth_attempts, public.home_keys, public.home_sessions, public.member_passwords, public.recovery_codes, public.photo_ai, public.photo_ai_jobs, public.videos, public.identity_names FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$roles$;
