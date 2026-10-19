import { SITE_URL } from "../lib/site";
import { useEffect, useState } from "react";
import { BUSINESS_FREE_UNTIL, LOCALES, formatPolicyDate, type LocaleCode } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { Field, HotkeyInput, Seg, Switch, download } from "../components/ui";
import { DEFAULT_API_URL, useStore } from "../lib/store";
import { ApiError, auth, type User } from "../lib/api";
import { deriveSyncKey, keyCheck } from "../lib/crypto";
import { hasSyncKey, setSyncKey, syncNow } from "../lib/sync";
import { confirmDialog, promptDialog } from "../lib/dialog";
import { formatNumber, formatRelative, getLocale, setLocale, useLocale, useT } from "../i18n";
import { usePublicStats } from "../lib/stats";
import { hasNativeBridge, invoke } from "../platform";
import { Link } from "react-router-dom";
import { BillingPolicy, BillingSection } from "./Billing";

export function SettingsPage() {
  const t = useT();
  const s = useStore((x) => x.settings);
  const update = useStore((x) => x.updateSettings);
  const loc = useLocale();
  return (
    <Shell title={<h2>{t("nav.settings")}</h2>}>
      <div className="page" style={{ maxWidth: 860 }}>
        <section className="card stack">
          <h3><Icon name="Palette" size={16} /> {t("settings.appearance")}</h3>
          <Field label={t("settings.language")}>
            <select className="select" value={loc} onChange={(e) => void setLocale(e.target.value as LocaleCode)}>
              {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.name} — {l.english}</option>)}
            </select>
          </Field>
          <Field label={t("settings.theme")}>
            <Seg value={s.theme} onChange={(theme) => void update({ theme })} options={[{ value: "system", label: t("settings.theme.system"), icon: "Monitor" }, { value: "dark", label: t("settings.theme.dark"), icon: "Moon" }, { value: "light", label: t("settings.theme.light"), icon: "Sun" }]} />
          </Field>
          <div className="row between"><span className="label">{t("settings.reduceMotion")}</span><Switch checked={s.reduceMotion} onChange={(v) => void update({ reduceMotion: v })} label={t("settings.reduceMotion")} /></div>
          <Field label={t("settings.defaultMode")}>
            <Seg value={s.defaultMode} onChange={(defaultMode) => void update({ defaultMode })} options={[{ value: "easy", label: t("mode.easy") }, { value: "pro", label: t("mode.pro") }]} />
          </Field>
        </section>

        <section className="card stack">
          <h3><Icon name="Shield" size={16} /> {t("settings.safety")}</h3>
          <Field label={t("settings.halt")} hint={t("settings.haltHint")}>
            <HotkeyInput value={s.haltHotkey} onChange={(h) => h && void update({ haltHotkey: h })} />
          </Field>
          <div className="grid cols-2">
            <Field label={t("editor.countdown")}>
              <div className="input-group"><input className="input" type="number" min={0} max={60} value={s.countdownMs / 1000} onChange={(e) => void update({ countdownMs: Math.max(0, Math.min(60, Number(e.target.value) || 0)) * 1000 })} /><span className="small muted">s</span></div>
            </Field>
            <Field label={t("editor.maxDuration")}>
              <div className="input-group"><input className="input" type="number" min={1} max={10080} value={s.maxDurationMs / 60_000} onChange={(e) => void update({ maxDurationMs: Math.max(1, Number(e.target.value) || 1) * 60_000 })} /><span className="small muted">{t("common.minutes")}</span></div>
            </Field>
          </div>
          <Field label={t("settings.ledgerRetention")}>
            <div className="input-group"><input className="input" type="number" min={1} max={365} value={s.ledgerRetentionDays} onChange={(e) => void update({ ledgerRetentionDays: Math.max(1, Math.min(365, Number(e.target.value) || 30)) })} style={{ maxWidth: 140 }} /><span className="small muted">{t("common.days")}</span></div>
          </Field>
          {hasNativeBridge && <AutostartRow />}
        </section>

        <AccountSection />

        <section className="card stack">
          <h3><Icon name="FileJson" size={16} /> {t("settings.data")}</h3>
          <p className="hint">{t("settings.dataHint")}</p>
          <div className="row wrap">
            <button className="btn" onClick={() => { const st = useStore.getState(); download(`autoflow-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: "autoflow.backup", version: 1, exportedAt: new Date().toISOString(), flows: st.flows, profiles: st.profiles, settings: { ...st.settings, sync: undefined } }, null, 2)); }}><Icon name="Download" size={15} /> {t("settings.exportAll")}</button>
            <button className="btn danger" onClick={async () => {
              if (!(await confirmDialog({ title: t("settings.wipeTitle"), body: t("settings.wipeBody"), tone: "danger", confirmLabel: t("settings.wipe") }))) return;
              await useStore.getState().wipeLocalData();
              location.reload();
            }}><Icon name="Trash2" size={15} /> {t("settings.wipe")}</button>
          </div>
        </section>

        <section className="card stack">
          <h3><Icon name="Wrench" size={16} /> {t("settings.advanced")}</h3>
          <Field label={t("settings.apiUrl")} hint={t("settings.apiUrlHint")}>
            <div className="input-group">
              <input className="input mono" value={s.apiUrl} onChange={(e) => void update({ apiUrl: e.target.value.trim() })} />
              <button className="btn ghost" onClick={() => void update({ apiUrl: DEFAULT_API_URL })}>{t("common.reset")}</button>
            </div>
          </Field>
        </section>

        <section className="card stack-sm">
          <h3><Icon name="Info" size={16} /> {t("settings.about")}</h3>
          <div className="small muted">AutoFlow {__APP_VERSION__} · {t("settings.madeBy")}</div>
          <LiveStats />
          <BusinessInfo />
          <div className="row wrap small">
            <a href={`${SITE_URL}/${loc}/privacy/`} target="_blank" rel="noopener">{t("settings.privacy")}</a>
            <a href={`${SITE_URL}/${loc}/terms/`} target="_blank" rel="noopener">{t("settings.terms")}</a>
            <a href="mailto:projectteamforyou@gmail.com">projectteamforyou@gmail.com</a>
          </div>
        </section>
      </div>
    </Shell>
  );
}

function LiveStats() {
  const t = useT();
  const s = usePublicStats();
  if (!s) return null;
  const f = (n: number) => formatNumber(n);
  return (
    <div className="row wrap" style={{ gap: 18, padding: "10px 0" }}>
      <span className="row small"><span className="pulse-dot" /><b>{f(s.visitsTotal)}</b> <span className="muted">{t("stats.visits")}</span></span>
      <span className="row small"><b>{f(Math.max(1, s.onlineNow))}</b> <span className="muted">{t("stats.online")}</span></span>
      <span className="row small"><b>{f(s.downloads.total)}</b> <span className="muted">{t("stats.downloads")}</span></span>
    </div>
  );
}

/** 전자상거래법상 사업자 정보 표시. */
function BusinessInfo() {
  const t = useT();
  const ko = useLocale() === "ko";
  const rows: [string, React.ReactNode][] = [
    [t("biz.company"), ko ? "프로젝트팀포유" : "ProjectTeamForYou (프로젝트팀포유)"],
    [t("biz.ceo"), ko ? "이유상" : "Yusang Lee (이유상)"],
    [t("biz.regNo"), "495-25-02209"],
    [t("biz.mailOrder"), "제2026-경북봉화-0037호"],
    [t("biz.address"), ko ? "경상북도 봉화군 상운면 예봉로 1166-68" : "1166-68 Yebong-ro, Sangun-myeon, Bonghwa-gun, Gyeongsangbuk-do, Republic of Korea"],
    [t("biz.phone"), <a href="tel:+827076207256">{ko ? "070-7620-7256" : "+82-70-7620-7256"}</a>],
    [t("biz.email"), <a href="mailto:projectteamforyou@gmail.com">projectteamforyou@gmail.com</a>],
    [t("biz.website"), <a href="https://projectteamforyou.com" target="_blank" rel="noopener">projectteamforyou.com</a>],
  ];
  return (
    <details className="small">
      <summary className="label" style={{ cursor: "pointer" }}>{t("biz.title")}</summary>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 14px", margin: "8px 0 0" }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt className="muted">{k}</dt>
            <dd style={{ margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="subtle" style={{ marginTop: 8 }}>© Copyright 2026, Projectteamforyou. All rights reserved.</p>
    </details>
  );
}

function AutostartRow() {
  const t = useT();
  const [on, setOn] = useState(() => localStorage.getItem("af.autostart") === "1");
  return (
    <div className="row between">
      <span className="label">{t("settings.autostart")}</span>
      <Switch checked={on} onChange={async (v) => { try { await invoke("autostart_set", { enabled: v }); setOn(v); localStorage.setItem("af.autostart", v ? "1" : "0"); } catch (e) { useStore.getState().toast("error", (e as Error).message); } }} label={t("settings.autostart")} />
    </div>
  );
}

function AccountSection() {
  const t = useT();
  const sync = useStore((s) => s.settings.sync);
  const update = useStore((s) => s.updateSettings);
  const toast = useStore((s) => s.toast);
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState(hasSyncKey());

  useEffect(() => {
    auth.me().then(setUser).catch(() => setUser(null)).finally(() => setChecking(false));
  }, []);

  const submit = async () => {
    setBusy(true);
    try {
      const u = mode === "login" ? await auth.login(email, password) : await auth.signup(email, password);
      setUser(u);
      setPassword("");
      await update({ sync: { ...sync, accountId: u.id, email: u.email } });
      toast("success", t("account.welcome", { email: u.email }));
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    if (!user) return;
    const pass = await promptDialog({ title: t("sync.passTitle"), body: t("sync.passBody"), input: { label: t("sync.passphrase"), type: "password" }, confirmLabel: t("sync.unlock") });
    if (!pass || pass.length < 10) {
      if (pass !== null) toast("error", t("sync.passTooShort"));
      return;
    }
    const key = await deriveSyncKey(pass, user.id);
    const check = await keyCheck(key);
    if (sync.keyCheck && sync.keyCheck !== check && !(await confirmDialog({ title: t("sync.mismatchTitle"), body: t("sync.mismatchBody"), tone: "warning" }))) return;
    setSyncKey(key);
    setUnlocked(true);
    await update({ sync: { ...sync, enabled: true, accountId: user.id, email: user.email, keyCheck: check } });
  };

  const doSync = async () => {
    setBusy(true);
    try {
      const r = await syncNow();
      toast("success", t("sync.done", { up: r.uploaded, down: r.downloaded, conflicts: r.conflicts }));
    } catch (e) {
      if (e instanceof ApiError && e.code === "business_plan_required") toast("warning", t("billing.requiredBody", { date: formatPolicyDate(BUSINESS_FREE_UNTIL, getLocale()) }));
      else toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <section className="card stack">
      <h3><Icon name="Cloud" size={16} /> {t("account.title")}</h3>
      <p className="hint">{t("account.optional")}</p>
      {!checking && !user && <BillingPolicy />}
      {checking ? (
        <p className="muted small">{t("common.loading")}</p>
      ) : user ? (
        <>
          <div className="row">
            <div className="tile-icon" style={{ background: "var(--af-gradient)" }}><Icon name="User" /></div>
            <div className="grow"><b>{user.email}</b><div className="small muted">{t("account.signedIn")}</div></div>
            <button className="btn sm ghost" onClick={async () => { await auth.logout(); setUser(null); setSyncKey(null); setUnlocked(false); await update({ sync: { enabled: false } }); }}><Icon name="LogOut" size={14} /> {t("account.logout")}</button>
          </div>
          <div className="callout info small"><Icon name="Lock" size={16} /> {t("sync.e2e")}</div>
          <div className="row wrap">
            {!unlocked ? (
              <button className="btn primary" onClick={unlock}><Icon name="KeyRound" size={15} /> {sync.keyCheck ? t("sync.unlock") : t("sync.enable")}</button>
            ) : (
              <button className="btn primary" onClick={doSync} disabled={busy}><Icon name="Cloud" size={15} /> {busy ? t("common.loading") : t("sync.now")}</button>
            )}
            {sync.keyCheck && <span className="badge">{t("sync.fingerprint")}: <code>{sync.keyCheck}</code></span>}
            {sync.lastSyncAt && <span className="small muted">{t("sync.last", { when: formatRelative(sync.lastSyncAt) })}</span>}
          </div>
          <div className="row wrap">
            <button className="btn sm ghost" onClick={async () => download(`autoflow-account-export-${Date.now().toString(36)}.json`, JSON.stringify(await auth.exportData(), null, 2))}><Icon name="Download" size={14} /> {t("account.export")}</button>
            <button className="btn sm ghost" style={{ color: "var(--af-danger)" }} onClick={async () => {
              const pw = await promptDialog({ title: t("account.deleteTitle"), body: t("account.deleteBody"), tone: "danger", input: { label: t("account.password"), type: "password" }, confirmLabel: t("account.delete") });
              if (!pw) return;
              try { await auth.deleteAccount(pw); setUser(null); setSyncKey(null); await update({ sync: { enabled: false } }); toast("success", t("account.deleted")); } catch (e) { toast("error", (e as Error).message); }
            }}><Icon name="Trash2" size={14} /> {t("account.delete")}</button>
            {user.isAdmin && <Link className="btn sm ghost" to="/admin"><Icon name="Shield" size={14} /> {t("admin.open")}</Link>}
          </div>
        </>
      ) : (
        <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Seg value={mode} onChange={setMode} options={[{ value: "login", label: t("account.login") }, { value: "signup", label: t("account.signup") }]} />
          <Field label={t("account.email")}><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label={t("account.password")} hint={mode === "signup" ? t("account.passwordHint") : undefined}><input className="input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "signup" ? 10 : 1} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <div className="row between">
            {mode === "login" ? <button type="button" className="btn sm ghost" onClick={async () => { if (!email) return toast("info", t("account.enterEmail")); await auth.requestReset(email).catch(() => undefined); toast("success", t("account.resetSent")); }}>{t("account.forgot")}</button> : <span className="hint">{t("account.consent")}</span>}
            <button className="btn primary" disabled={busy}>{busy ? t("common.loading") : mode === "login" ? t("account.login") : t("account.signup")}</button>
          </div>
        </form>
      )}
    </section>
    {user && <BillingSection user={user} onUser={setUser} />}
    </>
  );
}
