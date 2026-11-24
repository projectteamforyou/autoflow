-- Indexes on the device_id foreign keys (001).
--
-- sessions.device_id (ON DELETE CASCADE) and items.device_id (ON DELETE SET NULL) had no index, so every
-- DELETE /v1/devices/:id and every account deletion (users → devices cascade) scanned both tables once per
-- device to enforce the constraint; items is the largest table. Partial: device_id is NULL for most rows.
CREATE INDEX IF NOT EXISTS sessions_device_idx ON sessions (device_id) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS items_device_idx ON items (device_id) WHERE device_id IS NOT NULL;
