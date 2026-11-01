CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  stage TEXT NOT NULL,
  won INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Best first, ties below older scores, as on the local table.
CREATE INDEX IF NOT EXISTS scores_by_rank ON scores (score DESC, id ASC);
