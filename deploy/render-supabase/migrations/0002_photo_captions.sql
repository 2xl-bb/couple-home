CREATE TABLE photo_captions (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
  created_at BIGINT NOT NULL,
  user_id TEXT NOT NULL,
  author_slot INTEGER NOT NULL CHECK (author_slot IN (1, 2))
);

CREATE INDEX photo_captions_photo_created_idx ON photo_captions (photo_id, created_at);

ALTER TABLE public.photo_captions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.photo_captions FROM PUBLIC;

DO $roles$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.photo_captions FROM %I', role_name);
    END IF;
  END LOOP;
END
$roles$;
