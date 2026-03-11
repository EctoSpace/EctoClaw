-- EctoClaw Ledger Schema v1
-- SQLite-optimized for zero-config local development

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  goal         TEXT NOT NULL,
  goal_hash    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'sealed', 'aborted')),
  policy_name  TEXT,
  policy_hash  TEXT,
  public_key   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sealed_at    TEXT,
  event_count  INTEGER NOT NULL DEFAULT 0,
  tip_hash     TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL REFERENCES sessions(id),
  sequence     INTEGER NOT NULL,
  payload      TEXT NOT NULL,  -- JSON
  content_hash TEXT NOT NULL,
  prev_hash    TEXT NOT NULL,
  public_key   TEXT,
  signature    TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(session_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_events_hash ON events(content_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

CREATE TABLE IF NOT EXISTS tokens (
  token_hash  TEXT PRIMARY KEY,
  role        TEXT NOT NULL CHECK(role IN ('admin', 'auditor', 'agent')),
  label       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS policies (
  name        TEXT PRIMARY KEY,
  content     TEXT NOT NULL,
  hash        TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
