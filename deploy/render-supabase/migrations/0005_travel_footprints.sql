CREATE TABLE public.travel_footprints (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  city_name TEXT NOT NULL,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  photos TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  note TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX travel_footprints_created_at_idx ON public.travel_footprints(created_at, id);

ALTER TABLE public.travel_footprints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.travel_footprints FROM PUBLIC;

DO $roles$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.travel_footprints FROM %I', role_name);
    END IF;
  END LOOP;
END
$roles$;
