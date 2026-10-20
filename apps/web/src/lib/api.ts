/**
 * Client for the AutoFlow API (Railway). Optional: the app is fully usable offline without an account.
 * Bearer session tokens are kept encrypted in the device vault.
 */
import { useStore } from "./store";
import { vault } from "./crypto";

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly body?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

const TOKEN = "session:token";

export async function getToken(): Promise<string | undefined> {
  return vault.get(TOKEN);
}

export async function setToken(token: string | null): Promise<void> {
  if (token) await vault.set(TOKEN, token);
  else await vault.delete(TOKEN);
}

export async function api<T>(path: string, init: Omit<RequestInit, "headers"> & { json?: unknown; auth?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
  const base = useStore.getState().settings.apiUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { Accept: "application/json", ...(init.headers ?? {}) };
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.auth !== false) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, signal: init.signal ?? ctrl.signal });
  } catch (e) {
    throw new ApiError(0, "network", (e as Error).name === "AbortError" ? "request timed out" : "network unavailable");
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? res.statusText, body);
  }
  return body as T;
}

export interface User {
  id: string;
  email: string;
  emailVerified?: boolean;
  usageType?: "personal" | "business";
  /** Operator of this deployment: sees the Admin page. */
  isAdmin?: boolean;
  createdAt?: string;
}

export const auth = {
  async signup(email: string, password: string): Promise<User> {
    const r = await api<{ session: { token: string }; user: User }>("/v1/auth/signup", { method: "POST", json: { email, password }, auth: false });
    await setToken(r.session.token);
    return r.user;
  },
  async login(email: string, password: string): Promise<User> {
    const r = await api<{ session: { token: string }; user: User }>("/v1/auth/login", { method: "POST", json: { email, password }, auth: false });
    await setToken(r.session.token);
    return r.user;
  },
  async me(): Promise<User | null> {
    if (!(await getToken())) return null;
    try {
      return (await api<{ user: User }>("/v1/me")).user;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await setToken(null);
        return null;
      }
      throw e;
    }
  },
  async logout(): Promise<void> {
    try {
      await api("/v1/auth/logout", { method: "POST" });
    } finally {
      await setToken(null);
    }
  },
  async update(patch: { usageType?: "personal" | "business" }): Promise<User> {
    return (await api<{ user: User }>("/v1/me", { method: "PATCH", json: patch })).user;
  },
  async requestReset(email: string): Promise<void> {
    await api("/v1/auth/password/forgot", { method: "POST", json: { email }, auth: false });
  },
  async deleteAccount(password: string): Promise<void> {
    await api("/v1/me", { method: "DELETE", json: { password } });
    await setToken(null);
  },
  async exportData(): Promise<unknown> {
    return api("/v1/me/export");
  },
};
