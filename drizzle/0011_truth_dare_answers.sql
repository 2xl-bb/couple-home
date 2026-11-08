CREATE TABLE truth_dare_games_new (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  p1_roll INTEGER CHECK (p1_roll IS NULL OR p1_roll BETWEEN 1 AND 6),
  p2_roll INTEGER CHECK (p2_roll IS NULL OR p2_roll BETWEEN 1 AND 6),
  status TEXT NOT NULL CHECK (status IN (
    'waiting_p1_roll', 'waiting_p2_roll', 'waiting_loser_choice',
    'waiting_winner_question', 'waiting_loser_answer', 'finished'
  )),
  loser_id TEXT,
  choice_type TEXT CHECK (choice_type IS NULL OR choice_type IN ('truth', 'dare')),
  question_text TEXT CHECK (question_text IS NULL OR length(question_text) <= 300),
  answer_text TEXT CHECK (answer_text IS NULL OR length(answer_text) <= 1000),
  created_at INTEGER NOT NULL,
  CHECK (creator_id <> partner_id)
);

INSERT INTO truth_dare_games_new (
  id, creator_id, partner_id, p1_roll, p2_roll, status, loser_id,
  choice_type, question_text, created_at
)
SELECT
  id, creator_id, partner_id, p1_roll, p2_roll, status, loser_id,
  choice_type, question_text, created_at
FROM truth_dare_games;

DROP TABLE truth_dare_games;
ALTER TABLE truth_dare_games_new RENAME TO truth_dare_games;

CREATE UNIQUE INDEX truth_dare_games_one_active_idx
  ON truth_dare_games ((1))
  WHERE status <> 'finished';

CREATE INDEX truth_dare_games_created_at_idx ON truth_dare_games(created_at, id);
