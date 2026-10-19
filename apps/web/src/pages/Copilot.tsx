import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LOCALES, explainFlow, explainFlowEn } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { Field, SafetyBadge, Switch } from "../components/ui";
import { useStore } from "../lib/store";
import { AI_KEY, PROVIDER_PRESETS, askText, draftFlow, isLocalUrl, previewRequest, testConnection, type DraftResult } from "../lib/ai";
import { vault } from "../lib/crypto";
import { confirmDialog } from "../lib/dialog";
import { getLocale, tp, useT } from "../i18n";

export function ProviderSettings() {
  const t = useT();
  const ai = useStore((s) => s.settings.ai);
  const update = useStore((s) => s.updateSettings);
  const toast = useStore((s) => s.toast);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const preset = PROVIDER_PRESETS.find((p) => p.baseUrl === ai.baseUrl && p.provider === ai.provider)?.id ?? (ai.provider === "none" ? "none" : "custom");
  useEffect(() => void vault.get(AI_KEY(ai.provider)).then((k) => setHasKey(!!k)), [ai.provider]);
  const set = (patch: Partial<typeof ai>) => void update({ ai: { ...ai, ...patch } });
  return (
    <div className="card stack">
      <div className="row between">
        <h3><Icon name="Brain" size={16} /> {t("copilot.provider")}</h3>
        <span className={`badge ${ai.provider === "none" ? "" : "ok"}`}>{ai.provider === "none" ? t("copilot.off") : t("copilot.on")}</span>
      </div>
      <p className="hint">{t("copilot.byok")}</p>
      <Field label={t("copilot.choose")}>
        <select className="select" value={preset} onChange={(e) => {
          const p = PROVIDER_PRESETS.find((x) => x.id === e.target.value);
          if (e.target.value === "none") set({ provider: "none" });
          else if (p) set({ provider: p.provider, baseUrl: p.baseUrl, model: p.model, localOnly: p.local ? ai.localOnly : false });
        }}>
          <option value="none">{t("copilot.none")}</option>
          {PROVIDER_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          {preset === "custom" && <option value="custom">{t("copilot.custom")}</option>}
        </select>
      </Field>
      {ai.provider !== "none" && (
        <>
          <div className="grid cols-2">
            <Field label={t("copilot.baseUrl")}><input className="input mono" value={ai.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} /></Field>
            <Field label={t("copilot.model")}><input className="input mono" value={ai.model} onChange={(e) => set({ model: e.target.value })} /></Field>
          </div>
          {ai.provider === "openai" && <Field label={t("copilot.imageModel")} hint={t("copilot.imageModelHint")}><input className="input mono" value={ai.imageModel} onChange={(e) => set({ imageModel: e.target.value })} /></Field>}
          <Field label={t("copilot.key")} hint={hasKey ? t("copilot.keyStored") : isLocalUrl(ai.baseUrl) ? t("copilot.keyOptional") : t("copilot.keyHint")}>
            <div className="input-group">
              <input className="input mono" type="password" autoComplete="off" value={key} placeholder={hasKey ? "••••••••••••" : "sk-…"} onChange={(e) => setKey(e.target.value)} />
              <button className="btn" disabled={!key} onClick={async () => { await vault.set(AI_KEY(ai.provider), key.trim()); setKey(""); setHasKey(true); toast("success", t("copilot.keySaved")); }}>{t("common.save")}</button>
              {hasKey && <button className="btn ghost" onClick={async () => { await vault.delete(AI_KEY(ai.provider)); setHasKey(false); }}><Icon name="Trash2" size={14} /></button>}
            </div>
          </Field>
          <div className="row between"><span className="label">{t("copilot.localOnly")}</span><Switch checked={ai.localOnly} onChange={(v) => set({ localOnly: v })} label={t("copilot.localOnly")} /></div>
          <div className="row between"><span className="label">{t("copilot.relay")}</span><Switch checked={ai.useRelay} onChange={(v) => set({ useRelay: v })} label={t("copilot.relay")} /></div>
          <p className="hint">{t("copilot.relayHint")}</p>
          <div className="row">
            <button className="btn sm" disabled={testing} onClick={async () => { setTesting(true); try { toast("success", `${t("copilot.connected")}: ${await testConnection()}`); } catch (e) { toast("error", (e as Error).message); } finally { setTesting(false); } }}>
              <Icon name="Zap" size={14} /> {testing ? t("common.loading") : t("copilot.test")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function CopilotPage() {
  const t = useT();
  const navigate = useNavigate();
  const ai = useStore((s) => s.settings.ai);
  const flows = useStore((s) => s.flows);
  const save = useStore((s) => s.saveFlow);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewFlow, setReviewFlow] = useState("");
  const [review, setReview] = useState<string | null>(null);
  const langName = LOCALES.find((l) => l.code === getLocale())?.english ?? "English";

  const confirmSend = async (text: string, includes: string[]) => {
    const p = previewRequest(ai, text, includes);
    return confirmDialog({
      title: t("copilot.sendTitle"),
      body: (
        <div className="stack-sm small">
          <div>{t("copilot.sendTo", { host: p.viaRelay ? `AutoFlow relay → ${p.host}` : p.host, model: p.model })}</div>
          <div>{t("copilot.sendSize", { n: p.bytes })}</div>
          <div>{t("copilot.sendIncludes", { what: p.includes.map((x) => t(x)).join(", ") })}</div>
        </div>
      ),
      confirmLabel: t("copilot.send"),
    });
  };

  const generate = async () => {
    if (!prompt.trim()) return;
    if (!(await confirmSend(prompt, ["copilot.inc.prompt"]))) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await draftFlow(prompt, langName));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const improve = async () => {
    const f = flows.find((x) => x.id === reviewFlow);
    if (!f) return;
    const text = explainFlowEn(f);
    if (!(await confirmSend(text, ["copilot.inc.flowSummary"]))) return;
    setBusy(true);
    setReview(null);
    try {
      setReview(await askText(`You review desktop/mobile automation flows for reliability and safety. Answer in ${langName}. Be concise: up to 6 bullet points with concrete improvements (waits, stop conditions, error handling, safer targets). Never suggest bypassing CAPTCHAs, anti-cheat or security prompts.`, text));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const EXAMPLES = ["copilot.ex1", "copilot.ex2", "copilot.ex3", "copilot.ex4"];

  return (
    <Shell title={<h2>{t("nav.copilot")}</h2>}>
      <div className="page">
        <div className="page-head">
          <div>
            <h1>{t("copilot.title")}</h1>
            <p>{t("copilot.sub")}</p>
          </div>
        </div>
        <div className="grid cols-2" style={{ alignItems: "start" }}>
          <div className="stack">
            <div className="card stack">
              <h3><Icon name="Wand2" size={16} /> {t("copilot.describe")}</h3>
              <textarea className="textarea" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t("copilot.placeholder")} maxLength={4000} />
              <div className="row wrap">
                {EXAMPLES.map((k) => <button key={k} className="badge" style={{ cursor: "pointer" }} onClick={() => setPrompt(t(k))}>{t(k).slice(0, 48)}…</button>)}
              </div>
              <div className="row end">
                <button className="btn primary" onClick={generate} disabled={busy || ai.provider === "none" || !prompt.trim()}>
                  <Icon name="Sparkles" size={15} /> {busy ? t("copilot.thinking") : t("copilot.generate")}
                </button>
              </div>
              {ai.provider === "none" && <div className="callout info small"><Icon name="Info" size={16} /> {t("copilot.setupFirst")}</div>}
              {error && <div className="callout err small"><Icon name="OctagonX" size={16} /> {error}</div>}
            </div>
            {result && (
              <div className="card stack">
                {result.refused ? (
                  <div className="callout warn"><Icon name="ShieldAlert" /> {t("copilot.refused")}: {result.refused}</div>
                ) : result.flow ? (
                  <>
                    <div className="row wrap">
                      <h3 className="grow">{result.flow.name}</h3>
                      <SafetyBadge flow={result.flow} />
                      {result.lint.length > 0 && <span className="badge warn">{t("editor.problems", { n: result.lint.length })}</span>}
                    </div>
                    <p className="small muted">{result.flow.description}</p>
                    <div className="card" style={{ background: "var(--af-bg-2)" }}>
                      <div className="stack-xs small">{explainFlow(result.flow).map((l, i) => <div key={i} style={{ paddingLeft: l.depth * 16 }}>{tp(l.phrase)}</div>)}</div>
                    </div>
                    <div className="callout info small"><Icon name="Info" size={16} /> {t("copilot.draftNote")}</div>
                    <div className="row end">
                      <button className="btn" onClick={() => setResult(null)}>{t("common.discard")}</button>
                      <button className="btn primary" onClick={async () => { const f = await save(result.flow!, { snapshot: false }); navigate(`/flows/${f.id}`); }}><Icon name="Save" size={15} /> {t("copilot.saveDraft")}</button>
                    </div>
                  </>
                ) : (
                  <div className="callout err small">
                    <Icon name="Bug" size={16} />
                    <ul className="bullets">{result.issues.slice(0, 6).map((i, n) => <li key={n}>{i.path}: {i.message}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
            <div className="card stack">
              <h3><Icon name="ShieldCheck" size={16} /> {t("copilot.review")}</h3>
              <div className="row">
                <select className="select" value={reviewFlow} onChange={(e) => setReviewFlow(e.target.value)} aria-label={t("editor.flow")}>
                  <option value="">—</option>
                  {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <button className="btn" onClick={improve} disabled={!reviewFlow || busy || ai.provider === "none"}><Icon name="Sparkles" size={14} /> {t("copilot.reviewBtn")}</button>
              </div>
              {review && <div className="card small" style={{ whiteSpace: "pre-wrap", background: "var(--af-bg-2)" }}>{review}</div>}
            </div>
          </div>
          <ProviderSettings />
        </div>
      </div>
    </Shell>
  );
}
