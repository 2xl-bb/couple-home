ALTER TABLE photos ADD COLUMN taken_at TEXT;

UPDATE photos
SET taken_at = CAST(created_at AS TEXT)
WHERE taken_at IS NULL;

CREATE INDEX photos_taken_at_idx ON photos (taken_at, id);
