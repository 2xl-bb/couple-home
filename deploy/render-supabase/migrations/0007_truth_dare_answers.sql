ALTER TABLE public.truth_dare_games
  ADD COLUMN answer_text TEXT CHECK (answer_text IS NULL OR length(answer_text) <= 1000);

ALTER TABLE public.truth_dare_games
  DROP CONSTRAINT IF EXISTS truth_dare_games_status_check;

ALTER TABLE public.truth_dare_games
  ADD CONSTRAINT truth_dare_games_status_check
  CHECK (status IN (
    'waiting_p1_roll', 'waiting_p2_roll', 'waiting_loser_choice',
    'waiting_winner_question', 'waiting_loser_answer', 'finished'
  ));
