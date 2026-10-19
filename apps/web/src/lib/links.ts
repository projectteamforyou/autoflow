/**
 * Handles links that arrive on a real path (from emails and server share links) rather than a
 * hash route: /verify-email#token=…, /reset-password#token=…, /s/<shareId>.
 * Tokens travel in the URL fragment so they never reach server logs; we clear them right away.
 */
import { api } from "./api";
import { promptDialog } from "./dialog";
import { useStore } from "./store";
import { t } from "../i18n";

export async function handleIncomingLink(): Promise<void> {
  const path = location.pathname;
  const base = path.replace(/\/(verify-email|reset-password|s\/[A-Za-z0-9_-]+)\/?$/, "/");
  const token = new URLSearchParams(location.hash.replace(/^#/, "")).get("token");
  const go = (hash: string) => history.replaceState(null, "", `${base}${hash}`);

  if (/\/verify-email\/?$/.test(path) && token) {
    go("#/settings");
    try {
      await api("/v1/auth/verify-email", { method: "POST", json: { token }, auth: false });
      useStore.getState().toast("success", t("links.verified"));
    } catch (e) {
      useStore.getState().toast("error", (e as Error).message);
    }
    return;
  }
  if (/\/reset-password\/?$/.test(path) && token) {
    go("#/settings");
    const password = await promptDialog({ title: t("links.resetTitle"), input: { label: t("account.password"), type: "password" }, confirmLabel: t("common.save") });
    if (!password) return;
    try {
      await api("/v1/auth/password/reset", { method: "POST", json: { token, password }, auth: false });
      useStore.getState().toast("success", t("links.resetDone"));
    } catch (e) {
      useStore.getState().toast("error", (e as Error).message);
    }
    return;
  }
  const share = /\/s\/([A-Za-z0-9_-]+)\/?$/.exec(path);
  if (share) {
    try {
      const r = await api<{ share: { flow: unknown } }>(`/v1/shares/${share[1]}`, { auth: false });
      const { encodeShareCode, parseFlow } = await import("@autoflow/core");
      const parsed = parseFlow(r.share.flow);
      if (parsed.ok) return go(`#/import?code=${await encodeShareCode(parsed.flow)}`);
    } catch {
      /* fall through */
    }
    go("#/");
    useStore.getState().toast("error", t("import.invalid"));
  }
}
