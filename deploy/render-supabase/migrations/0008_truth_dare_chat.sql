ALTER TABLE public.truth_dare_games
  ADD COLUMN chat_messages TEXT NOT NULL DEFAULT '[]'
  CHECK (jsonb_typeof(chat_messages::jsonb) = 'array');
