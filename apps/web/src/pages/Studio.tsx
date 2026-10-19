import { useEffect, useState } from "react";
import { sha256Hex } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { Field, Seg, download } from "../components/ui";
import { useStore } from "../lib/store";
import { askText, generateImage, previewRequest, type ImageRequest } from "../lib/ai";
import { confirmDialog } from "../lib/dialog";
import { kv } from "../lib/db";
import { formatRelative, useT } from "../i18n";

interface StudioItem {
  id: string;
  kind: "image" | "text";
  prompt: string;
  model: string;
  at: number;
  file?: string;
}

const BRIEFS = ["studio.brief.landing", "studio.brief.screens", "studio.brief.copy", "studio.brief.flowchart"] as const;

/** Studio: site/app planning and visual assets with the user's own AI provider. Nothing is published automatically. */
export function StudioPage() {
  const t = useT();
  const ai = useStore((s) => s.settings.ai);
  const toast = useStore((s) => s.toast);
  const [tab, setTab] = useState<"image" | "text">("image");
  const [img, setImg] = useState<ImageRequest>({ prompt: "", size: "1536x1024", background: "auto", format: "webp", quality: "high" });
  const [preview, setPreview] = useState<{ url: string; blob: Blob } | null>(null);
  const [brief, setBrief] = useState<(typeof BRIEFS)[number]>(BRIEFS[0]);
  const [idea, setIdea] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<StudioItem[]>([]);

  useEffect(() => void kv.get<StudioItem[]>("studio:history").then((h) => setHistory(h ?? [])), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const remember = async (item: StudioItem) => {
    const next = [item, ...history].slice(0, 50);
    setHistory(next);
    await kv.set("studio:history", next);
  };

  const ok = async (prompt: string) => {
    const p = previewRequest(ai, prompt, ["copilot.inc.prompt"]);
    return confirmDialog({ title: t("copilot.sendTitle"), body: t("copilot.sendTo", { host: p.viaRelay ? `AutoFlow relay → ${p.host}` : p.host, model: tab === "image" ? ai.imageModel : p.model }), confirmLabel: t("copilot.send") });
  };

  const makeImage = async () => {
    if (!img.prompt.trim() || !(await ok(img.prompt))) return;
    setBusy(true);
    try {
      const blob = await generateImage(img);
      setPreview({ url: URL.createObjectURL(blob), blob });
      await remember({ id: crypto.randomUUID(), kind: "image", prompt: img.prompt, model: ai.imageModel, at: Date.now() });
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveImage = async () => {
    if (!preview) return;
    const hash = (await sha256Hex(img.prompt + Date.now())).slice(0, 8);
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
    download(`autoflow-studio-${stamp}-${hash}.${img.format === "jpeg" ? "jpg" : img.format}`, preview.blob, preview.blob.type);
  };

  const makeText = async () => {
    const prompt = `${t(brief)}\n\n${idea}`;
    if (!idea.trim() || !(await ok(prompt))) return;
    setBusy(true);
    try {
      const out = await askText("You are a senior product designer and copywriter helping plan websites and apps. Produce structured, practical Markdown. Respect accessibility, privacy and honest marketing.", prompt);
      setText(out);
      await remember({ id: crypto.randomUUID(), kind: "text", prompt: idea, model: ai.model, at: Date.now() });
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title={<h2>{t("nav.studio")}</h2>}>
      <div className="page">
        <div className="page-head">
          <div>
            <h1>{t("studio.title")}</h1>
            <p>{t("studio.sub")}</p>
          </div>
          <Seg value={tab} onChange={setTab} options={[{ value: "image", label: t("studio.images"), icon: "Image" }, { value: "text", label: t("studio.plans"), icon: "FileText" }]} />
        </div>
        {ai.provider === "none" && <div className="callout info small"><Icon name="Info" size={16} /> {t("copilot.setupFirst")}</div>}
        {tab === "image" ? (
          <div className="grid cols-2" style={{ alignItems: "start" }}>
            <div className="card stack">
              <Field label={t("studio.prompt")}><textarea className="textarea" rows={5} value={img.prompt} onChange={(e) => setImg({ ...img, prompt: e.target.value })} placeholder={t("studio.promptPlaceholder")} maxLength={4000} /></Field>
              <Field label={t("studio.size")}><Seg value={img.size} onChange={(size) => setImg({ ...img, size })} options={[{ value: "1024x1024", label: "1:1" }, { value: "1536x1024", label: "3:2" }, { value: "1024x1536", label: "2:3" }]} /></Field>
              <Field label={t("studio.background")}><Seg value={img.background} onChange={(background) => setImg({ ...img, background, format: background === "transparent" && img.format === "jpeg" ? "png" : img.format })} options={[{ value: "auto", label: t("studio.bg.auto") }, { value: "transparent", label: t("studio.bg.transparent") }, { value: "opaque", label: t("studio.bg.opaque") }]} /></Field>
              <div className="grid cols-2">
                <Field label={t("studio.format")}><Seg value={img.format} onChange={(format) => setImg({ ...img, format })} options={[{ value: "webp", label: "WebP" }, { value: "png", label: "PNG" }, { value: "jpeg", label: "JPG" }]} /></Field>
                <Field label={t("studio.quality")}><Seg value={img.quality} onChange={(quality) => setImg({ ...img, quality })} options={[{ value: "low", label: t("studio.q.low") }, { value: "medium", label: t("studio.q.medium") }, { value: "high", label: t("studio.q.high") }]} /></Field>
              </div>
              <div className="row end"><button className="btn primary" onClick={makeImage} disabled={busy || ai.provider !== "openai" || !img.prompt.trim()}><Icon name="Sparkles" size={15} /> {busy ? t("copilot.thinking") : t("studio.generate")}</button></div>
              {ai.provider !== "openai" && ai.provider !== "none" && <p className="hint">{t("studio.needsOpenai")}</p>}
            </div>
            <div className="card stack">
              {preview ? (
                <>
                  <img src={preview.url} alt={img.prompt} style={{ width: "100%", borderRadius: 12, background: "repeating-conic-gradient(#8882 0 25%, transparent 0 50%) 0 0/20px 20px" }} />
                  <div className="row end"><button className="btn primary" onClick={saveImage}><Icon name="Download" size={15} /> {t("studio.save")}</button></div>
                  <p className="hint">{t("studio.reviewNote")}</p>
                </>
              ) : (
                <div className="empty"><div className="tile-icon"><Icon name="Image" size={26} /></div><p className="small">{t("studio.previewEmpty")}</p></div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid cols-2" style={{ alignItems: "start" }}>
            <div className="card stack">
              <Field label={t("studio.briefType")}>
                <select className="select" value={brief} onChange={(e) => setBrief(e.target.value as (typeof BRIEFS)[number])}>
                  {BRIEFS.map((b) => <option key={b} value={b}>{t(`${b}.label`)}</option>)}
                </select>
              </Field>
              <Field label={t("studio.idea")}><textarea className="textarea" rows={6} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder={t("studio.ideaPlaceholder")} maxLength={6000} /></Field>
              <div className="row end"><button className="btn primary" onClick={makeText} disabled={busy || ai.provider === "none" || !idea.trim()}><Icon name="Sparkles" size={15} /> {busy ? t("copilot.thinking") : t("studio.write")}</button></div>
            </div>
            <div className="card stack">
              {text ? (
                <>
                  <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "var(--af-font)" }}>{text}</pre>
                  <div className="row end">
                    <button className="btn sm" onClick={() => void navigator.clipboard.writeText(text)}><Icon name="Copy" size={14} /> {t("common.copy")}</button>
                    <button className="btn sm" onClick={() => download(`autoflow-brief-${Date.now().toString(36)}.md`, text, "text/markdown")}><Icon name="Download" size={14} /> .md</button>
                  </div>
                </>
              ) : (
                <div className="empty"><div className="tile-icon"><Icon name="FileText" size={26} /></div><p className="small">{t("studio.textEmpty")}</p></div>
              )}
            </div>
          </div>
        )}
        {history.length > 0 && (
          <div className="card stack-sm">
            <h3>{t("studio.history")}</h3>
            {history.slice(0, 10).map((h) => (
              <div key={h.id} className="row small">
                <Icon name={h.kind === "image" ? "Image" : "FileText"} size={14} />
                <span className="grow truncate">{h.prompt}</span>
                <span className="subtle">{h.model}</span>
                <span className="subtle">{formatRelative(h.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
