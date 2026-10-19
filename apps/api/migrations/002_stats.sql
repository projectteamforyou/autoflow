-- Public, anonymous usage counters (no IPs, no user ids, no personal data).
CREATE TABLE stats_counters (
  key   text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{1,40}$'),
  value bigint NOT NULL DEFAULT 0
);
INSERT INTO stats_counters (key) VALUES ('visits_total'), ('downloads_windows'), ('downloads_android') ON CONFLICT DO NOTHING;

-- Same counters per UTC day, for trends.
CREATE TABLE stats_daily (
  day   date NOT NULL,
  key   text NOT NULL CHECK (key ~ '^[a-z0-9_]{1,40}$'),
  value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);

-- "Online now": a random per-tab id (generated in the browser) and when it was last seen.
CREATE TABLE stats_presence (
  session_id text PRIMARY KEY CHECK (session_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  surface    text NOT NULL CHECK (surface IN ('site', 'app', 'windows', 'android')),
  last_seen  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stats_presence_seen_idx ON stats_presence (last_seen);
