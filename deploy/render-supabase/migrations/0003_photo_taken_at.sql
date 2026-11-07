ALTER TABLE photos ADD COLUMN taken_at TIMESTAMPTZ;

UPDATE photos
SET taken_at = TO_TIMESTAMP(created_at / 1000.0)
WHERE taken_at IS NULL;

ALTER TABLE photos ALTER COLUMN taken_at SET NOT NULL;

CREATE INDEX photos_taken_at_idx ON photos (taken_at, id);
