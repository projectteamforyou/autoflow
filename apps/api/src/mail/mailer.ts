/**
 * Outgoing email behind an interface: console (dev), memory (tests) and Resend (production).
 */
import type { Logger } from "../logger.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Message category, for logs and tests. */
  tag: "verify_email" | "password_reset" | "password_changed" | "account_deleted";
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Development mailer: logs the message (including links) to stdout. Never use in production. */
export class ConsoleMailer implements Mailer {
  constructor(private readonly logger: Logger) {}
  async send(m: MailMessage): Promise<void> {
    // Plain console output on purpose: the structured logger would redact the token-bearing link.
    process.stdout.write(`\n[dev mail] to=${m.to} subject=${JSON.stringify(m.subject)}\n${m.text}\n\n`);
    this.logger.info("mail.dev_sent", { tag: m.tag });
  }
}

/**
 * Production fallback when no provider is configured: drops the message and logs only its
 * category — never the body, which carries single-use tokens.
 */
export class DisabledMailer implements Mailer {
  constructor(private readonly logger: Logger) {}
  async send(m: MailMessage): Promise<void> {
    this.logger.warn("mail.not_configured", { tag: m.tag });
  }
}

/** Captures messages in memory (tests). */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(m: MailMessage): Promise<void> {
    this.sent.push(m);
  }
  last(to: string, tag?: MailMessage["tag"]): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to && (!tag || m.tag === tag));
  }
}

export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(m: MailMessage): Promise<void> {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text, tags: [{ name: "category", value: m.tag }] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      this.logger.error("mail.send_failed", { tag: m.tag, status: res.status });
      throw new Error(`Resend responded ${res.status}`);
    }
    this.logger.info("mail.sent", { tag: m.tag });
  }
}

/**
 * Wraps a mailer so delivery failures never break the request that triggered them
 * (e.g. a signup succeeds even if the verification email bounces).
 */
export function fireAndForget(mailer: Mailer, logger: Logger): Mailer {
  return {
    async send(m) {
      try {
        await mailer.send(m);
      } catch (err) {
        logger.error("mail.error", { tag: m.tag, err });
      }
    },
  };
}
