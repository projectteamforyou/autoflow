-- AutoFlow API — initial schema.
-- Every user-owned row references users(id) ON DELETE CASCADE so account deletion removes all data.

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL,
  email_normalized    text NOT NULL UNIQUE,
  password_hash       text NOT NULL,
  email_verified_at   timestamptz,
  display_name        text,
  locale              text NOT NULL DEFAULT 'en',
  role                text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  password_changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  platform     text NOT NULL CHECK (platform IN ('windows', 'android', 'web', 'macos', 'linux', 'ios', 'other')),
  app_version  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_user_idx ON devices (user_id);

-- Opaque session tokens; only the SHA-256 of the token is stored.
-- Deleting a device deletes (revokes) the sessions bound to it.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,
  device_id    uuid REFERENCES devices(id) ON DELETE CASCADE,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Single-use tokens for email verification and password reset (hashed).
CREATE TABLE email_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify_email', 'password_reset')),
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX email_tokens_user_idx ON email_tokens (user_id, purpose);

-- End-to-end encrypted sync items. The server never sees plaintext.
-- seq comes from a global sequence and is taken while the user's row is locked, so per-user
-- commit order equals seq order and `since` cursors never skip an item.
CREATE SEQUENCE item_seq AS bigint;

CREATE TABLE items (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('flow', 'profile', 'settings')),
  item_id      text NOT NULL CHECK (item_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  ciphertext   text,
  iv           text,
  content_hash text,
  revision     integer NOT NULL CHECK (revision > 0),
  size_bytes   integer NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  deleted      boolean NOT NULL DEFAULT false,
  seq          bigint NOT NULL,
  device_id    uuid REFERENCES devices(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, item_id),
  CHECK (deleted OR (ciphertext IS NOT NULL AND iv IS NOT NULL AND content_hash IS NOT NULL))
);
CREATE UNIQUE INDEX items_user_seq_idx ON items (user_id, seq);

-- Atlas community templates.
CREATE TABLE atlas_templates (
  id            text PRIMARY KEY CHECK (id ~ '^[0-9A-Za-z]{10}$'),
  author_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text NOT NULL DEFAULT '',
  category      text NOT NULL,
  locale        text NOT NULL DEFAULT 'en',
  platforms     text[] NOT NULL,
  flow          jsonb NOT NULL,
  content_hash  text NOT NULL,
  risk_level    text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  risk_score    integer NOT NULL,
  permissions   text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'pending_review', 'hidden', 'removed')),
  installs      bigint NOT NULL DEFAULT 0,
  rating_sum    integer NOT NULL DEFAULT 0,
  rating_count  integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  search        tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, ''))) STORED,
  UNIQUE (author_id, content_hash)
);
CREATE INDEX atlas_status_created_idx ON atlas_templates (status, created_at DESC);
CREATE INDEX atlas_status_installs_idx ON atlas_templates (status, installs DESC);
CREATE INDEX atlas_author_idx ON atlas_templates (author_id);
CREATE INDEX atlas_search_idx ON atlas_templates USING gin (search);
CREATE INDEX atlas_platforms_idx ON atlas_templates USING gin (platforms);

CREATE TABLE atlas_ratings (
  template_id text NOT NULL REFERENCES atlas_templates(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars       smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, user_id)
);
CREATE INDEX atlas_ratings_user_idx ON atlas_ratings (user_id);

-- Keep the denormalised rating aggregate exact, including when ratings vanish through cascades.
CREATE FUNCTION atlas_ratings_aggregate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tid text := COALESCE(NEW.template_id, OLD.template_id);
BEGIN
  UPDATE atlas_templates t
     SET rating_sum = COALESCE((SELECT sum(stars) FROM atlas_ratings r WHERE r.template_id = tid), 0),
         rating_count = (SELECT count(*) FROM atlas_ratings r WHERE r.template_id = tid)
   WHERE t.id = tid;
  RETURN NULL;
END;
$$;
CREATE TRIGGER atlas_ratings_aggregate_trg
  AFTER INSERT OR UPDATE OR DELETE ON atlas_ratings
  FOR EACH ROW EXECUTE FUNCTION atlas_ratings_aggregate();

CREATE TABLE atlas_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id text NOT NULL REFERENCES atlas_templates(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      text NOT NULL CHECK (reason IN ('spam', 'malicious', 'cheating', 'inappropriate', 'copyright', 'broken', 'other')),
  details     text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'actioned')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (template_id, reporter_id)
);
CREATE INDEX atlas_reports_pending_idx ON atlas_reports (template_id) WHERE status = 'pending';
CREATE INDEX atlas_reports_reporter_idx ON atlas_reports (reporter_id);

CREATE TABLE atlas_installs (
  template_id text NOT NULL REFERENCES atlas_templates(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, user_id)
);
CREATE INDEX atlas_installs_user_idx ON atlas_installs (user_id);

-- Short share links for sanitized flows. owner_id is null for anonymous shares.
CREATE TABLE shares (
  id           text PRIMARY KEY CHECK (id ~ '^[0-9A-Za-z]{10}$'),
  owner_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  flow         jsonb NOT NULL,
  content_hash text NOT NULL,
  risk_level   text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  risk_score   integer NOT NULL,
  permissions  text[] NOT NULL DEFAULT '{}',
  size_bytes   integer NOT NULL,
  views        bigint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz
);
CREATE INDEX shares_owner_idx ON shares (owner_id);
CREATE INDEX shares_expires_idx ON shares (expires_at) WHERE expires_at IS NOT NULL;
