CREATE TABLE IF NOT EXISTS directory_publication (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  source_version INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  published_at INTEGER NOT NULL,
  body TEXT NOT NULL
);
