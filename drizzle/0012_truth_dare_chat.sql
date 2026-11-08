ALTER TABLE truth_dare_games
  ADD COLUMN chat_messages TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(chat_messages) AND json_type(chat_messages) = 'array');
