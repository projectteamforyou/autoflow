-- Business license keys (format and checksum: @autoflow/core license.ts).
--
-- Only the SHA-256 of the canonical key is stored, plus its last four symbols as a hint for
-- lists. The plaintext is shown exactly once: to the buyer when their payment is confirmed, or to
-- the operator who issued it.
--
-- A paid order already extends the buyer's own entitlement; the key issued for that order is
-- therefore recorded as redeemed by the buyer and serves as their license number (proof of
-- license). Keys meant for another account (e.g. a company licensing an employee) are issued by
-- an operator and redeemed with POST /v1/billing/redeem — once only.
CREATE TABLE license_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash    text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  key_hint    text NOT NULL CHECK (char_length(key_hint) = 4),
  plan        text NOT NULL DEFAULT 'business' CHECK (plan IN ('business')),
  period      text NOT NULL CHECK (period IN ('month', 'year')),
  status      text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'redeemed', 'revoked')),
  order_id    uuid UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
  issued_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  redeemed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  redeemed_at timestamptz,
  -- End of the redeemer's entitlement right after this key was applied (informational).
  valid_until timestamptz,
  revoked_at  timestamptz,
  note        text CHECK (note IS NULL OR char_length(note) <= 300),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'redeemed') = (redeemed_at IS NOT NULL))
);
CREATE INDEX license_keys_created_idx ON license_keys (created_at DESC);
CREATE INDEX license_keys_redeemed_by_idx ON license_keys (redeemed_by) WHERE redeemed_by IS NOT NULL;
