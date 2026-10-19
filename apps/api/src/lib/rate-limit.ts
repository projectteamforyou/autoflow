/**
 * Rate limiting behind a small interface so the in-memory token bucket can be swapped for a
 * shared store (Redis, Postgres) when the API runs on more than one instance.
 */
import type { RateRule } from "../config.js";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until one more token is available (0 when allowed). */
  retryAfterMs: number;
}

export interface RateLimiter {
  consume(key: string, cost?: number): Promise<RateLimitResult> | RateLimitResult;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class MemoryTokenBucket implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly perMs: number;

  constructor(
    private readonly rule: RateRule,
    private readonly now: () => number = Date.now,
    /** Hard cap on tracked keys so a flood of distinct IPs cannot exhaust memory. */
    private readonly maxKeys = 100_000,
  ) {
    this.perMs = rule.refillPerMinute / 60_000;
  }

  consume(key: string, cost = 1): RateLimitResult {
    const t = this.now();
    let b = this.buckets.get(key);
    if (b) {
      b.tokens = Math.min(this.rule.capacity, b.tokens + (t - b.updatedAt) * this.perMs);
      b.updatedAt = t;
      // Refresh insertion order so eviction drops the least recently used key.
      this.buckets.delete(key);
      this.buckets.set(key, b);
    } else {
      b = { tokens: this.rule.capacity, updatedAt: t };
      this.buckets.set(key, b);
      if (this.buckets.size > this.maxKeys) this.evict();
    }
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return { allowed: true, remaining: Math.floor(b.tokens), retryAfterMs: 0 };
    }
    const missing = cost - b.tokens;
    return { allowed: false, remaining: 0, retryAfterMs: this.perMs > 0 ? Math.ceil(missing / this.perMs) : 60_000 };
  }

  private evict(): void {
    const t = this.now();
    for (const [k, b] of this.buckets) {
      // Full buckets carry no state worth keeping.
      if (b.tokens + (t - b.updatedAt) * this.perMs >= this.rule.capacity) this.buckets.delete(k);
    }
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

export interface Limiters {
  global: RateLimiter;
  authIp: RateLimiter;
  authAccount: RateLimiter;
  publish: RateLimiter;
  shareIp: RateLimiter;
  relay: RateLimiter;
  install: RateLimiter;
}

export function createMemoryLimiters(rules: Record<keyof Limiters, RateRule>): Limiters {
  return {
    global: new MemoryTokenBucket(rules.global),
    authIp: new MemoryTokenBucket(rules.authIp),
    authAccount: new MemoryTokenBucket(rules.authAccount),
    publish: new MemoryTokenBucket(rules.publish),
    shareIp: new MemoryTokenBucket(rules.shareIp),
    relay: new MemoryTokenBucket(rules.relay),
    install: new MemoryTokenBucket(rules.install),
  };
}
