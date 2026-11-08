CREATE TABLE public.truth_dare_games (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  p1_roll INTEGER CHECK (p1_roll IS NULL OR p1_roll BETWEEN 1 AND 6),
  p2_roll INTEGER CHECK (p2_roll IS NULL OR p2_roll BETWEEN 1 AND 6),
  status TEXT NOT NULL CHECK (status IN (
    'waiting_p1_roll', 'waiting_p2_roll', 'waiting_loser_choice',
    'waiting_winner_question', 'finished'
  )),
  loser_id TEXT,
  choice_type TEXT CHECK (choice_type IS NULL OR choice_type IN ('truth', 'dare')),
  question_text TEXT CHECK (question_text IS NULL OR length(question_text) <= 300),
  created_at BIGINT NOT NULL,
  CHECK (creator_id <> partner_id)
);

CREATE UNIQUE INDEX truth_dare_games_one_active_idx
  ON public.truth_dare_games ((1))
  WHERE status <> 'finished';

CREATE INDEX truth_dare_games_created_at_idx ON public.truth_dare_games(created_at, id);

ALTER TABLE public.truth_dare_games ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.truth_dare_games FROM PUBLIC;

DO $roles$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.truth_dare_games FROM %I', role_name);
    END IF;
  END LOOP;
END
$roles$;
