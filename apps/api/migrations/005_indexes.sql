-- Indexes for housekeeping and operator queries.
--
-- sessions: purgeDeadSessions deletes by expires_at (sessions_expires_idx, 001) and by revoked_at;
-- the partial index keeps the (mostly NULL) revoked_at column cheap to search.
-- orders: the admin list filters by status, and reconciliation / expiry walk pending orders by age.
CREATE INDEX IF NOT EXISTS sessions_revoked_idx ON sessions (revoked_at) WHERE revoked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_status_created_idx ON orders (status, created_at DESC);
