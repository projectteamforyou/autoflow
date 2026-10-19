-- Billing: usage type, one-time Business plan orders, entitlements, admin-managed payment
-- settings (secrets encrypted at rest by the API) and an audit log of admin changes.
-- Policy and prices live in @autoflow/core (plans.ts).

ALTER TABLE users ADD COLUMN usage_type text NOT NULL DEFAULT 'personal' CHECK (usage_type IN ('personal', 'business'));

-- Orders are kept when an account is deleted (user_id becomes NULL): Korean e-commerce law
-- requires payment and contract records to be retained for five years.
CREATE TABLE orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  buyer_email         text NOT NULL,
  provider            text NOT NULL CHECK (provider IN ('portone', 'paypal')),
  -- PortOne: the paymentId we generate before checkout. PayPal: the order id PayPal returns
  -- (NULL for the instant between our insert and PayPal's answer).
  provider_payment_id text,
  plan                text NOT NULL CHECK (plan IN ('business')),
  period              text NOT NULL CHECK (period IN ('month', 'year')),
  -- Integer minor units (KRW: won, USD: cents).
  amount              integer NOT NULL CHECK (amount > 0),
  currency            text NOT NULL CHECK (currency IN ('KRW', 'USD')),
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
  failure_reason      text,
  valid_until         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz,
  raw                 jsonb,
  -- One provider payment can only ever settle one order (race-safe, idempotent confirmation).
  UNIQUE (provider, provider_payment_id)
);
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_created_idx ON orders (created_at DESC);

CREATE TABLE entitlements (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan        text NOT NULL CHECK (plan IN ('business')),
  valid_until timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, plan)
);

-- Runtime settings edited by administrators (e.g. key 'billing'). Secret fields inside `value`
-- are AES-256-GCM ciphertext; plaintext secrets never touch the database.
CREATE TABLE app_settings (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE admin_audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email text NOT NULL,
  action      text NOT NULL,
  target      text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created_idx ON admin_audit_log (created_at DESC);
