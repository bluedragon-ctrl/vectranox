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

-- The challenge mode's table: `stage` is the challenge room's name, `won` whether it was cleared.
CREATE TABLE IF NOT EXISTS challenge_scores (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  stage TEXT NOT NULL,
  won INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS challenge_scores_by_rank ON challenge_scores (score DESC, id ASC);
