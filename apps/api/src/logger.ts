/**
 * Structured JSON logger (one line per event). Values under sensitive-looking keys are
 * redacted recursively so tokens, passwords, provider keys and ciphertext never reach logs.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
type LevelSetting = LogLevel | "silent";

const ORDER: Record<LevelSetting, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|provider[-_]?key|ciphertext|iv$|^key$|credential/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && value.length > 2000) return `${value.slice(0, 2000)}…[truncated]`;
    return value;
  }
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
  return out;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export type LogSink = (line: string) => void;

export function createLogger(level: LevelSetting = "info", base: Record<string, unknown> = {}, sink: LogSink = (l) => process.stdout.write(`${l}\n`)): Logger {
  const min = ORDER[level];
  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < min) return;
    const entry = { time: new Date().toISOString(), level: lvl, msg, ...(redact({ ...base, ...fields }) as Record<string, unknown>) };
    try {
      sink(JSON.stringify(entry));
    } catch {
      /* never let logging crash a request */
    }
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (fields) => createLogger(level, { ...base, ...fields }, sink),
  };
}
