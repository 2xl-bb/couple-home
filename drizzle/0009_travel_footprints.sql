CREATE TABLE travel_footprints (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  city_name TEXT NOT NULL,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  photos TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  note TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX travel_footprints_created_at_idx ON travel_footprints(created_at, id);
