/**
 * Pickers fed by the native app: template images, open windows (Windows) and installed apps (Android).
 * Each one falls back to the plain text field when the command is missing (browser, older app
 * versions) — never an error toast; see lib/native.ts.
 */
import { useCallback, useEffect, useId, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { confirmDialog, promptDialog } from "../../lib/dialog";
import { IMAGE_MAX_BYTES, IMAGE_MAX_SIDE, checkPngDataUrl, deleteImage, importImage, isValidImageRef, listImages, readAsDataUrl, sanitizeImageRef } from "../../lib/images";
import { distinct, listApps, listWindows } from "../../lib/native";
import { useT } from "../../i18n";
import { hasNativeBridge, platform } from "../../platform";

/**
 * A native list that may not exist: `undefined` while loading, `null` when unavailable.
 * `refresh` resolves with the fresh list.
 */
function useNativeList<T>(load: () => Promise<T[] | null>, enabled: boolean): { items: T[] | null | undefined; refresh: () => Promise<T[] | null> } {
  const [items, setItems] = useState<T[] | null | undefined>(enabled ? undefined : null);
  const alive = useRef(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const refresh = useCallback(async () => {
    if (!enabled) return null;
    const next = await loadRef.current();
    if (alive.current) setItems(next);
    return next;
  }, [enabled]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  return { items, refresh };
}

/** The `ref` of a findImage step or an image target. */
export function ImageRefField({ value, onChange }: { value: string; onChange: (ref: string) => void }) {
  const t = useT();
  const { items: refs, refresh } = useNativeList(listImages, hasNativeBridge);
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Browser, or an app version without the image store: the name is typed by hand, as before.
  if (!refs) {
    return (
      <label className="field">
        <span>{t("editor.imageRef")}</span>
        <input className="input mono" value={value} onChange={(e) => onChange(e.target.value)} disabled={refs === undefined} spellCheck={false} />
        <small className="hint">{hasNativeBridge ? t("editor.imageRefHint") : t("editor.image.browserHint")}</small>
      </label>
    );
  }

  const stored = refs.includes(value);
  const missing = value !== "" && !stored;

  const add = async (blob: Blob, suggested: string) => {
    setError(null);
    if (blob.type !== "image/png") return setError(t("editor.image.notPng"));
    if (blob.size > IMAGE_MAX_BYTES) return setError(t("editor.image.tooBig", { mb: IMAGE_MAX_BYTES / (1024 * 1024) }));
    let dataUrl: string;
    try {
      dataUrl = await readAsDataUrl(blob);
    } catch {
      return setError(t("editor.image.notPng"));
    }
    const problem = checkPngDataUrl(dataUrl);
    if (problem) return setError(t(problem.key, "params" in problem ? problem.params : undefined));
    const typed = await promptDialog({ title: t("editor.image.nameTitle"), input: { label: t("editor.image.nameLabel"), value: sanitizeImageRef(suggested) || "image" }, confirmLabel: t("editor.image.import") });
    if (typed === null) return;
    const ref = sanitizeImageRef(typed);
    if (!isValidImageRef(ref)) return setError(t("editor.image.badName"));
    if (refs.includes(ref) && !(await confirmDialog({ title: t("editor.image.replaceTitle", { ref }), body: t("editor.image.replaceBody"), tone: "warning", confirmLabel: t("editor.image.replace") }))) return;
    setBusy(true);
    const r = await importImage(ref, dataUrl);
    setBusy(false);
    if (!r.ok) return setError(t("editor.image.importFailed", { error: r.error }));
    await refresh();
    onChange(ref);
  };

  const onPaste = (e: ClipboardEvent) => {
    const item = [...e.clipboardData.items].find((i) => i.kind === "file" && i.type.startsWith("image/"));
    const blob = item?.getAsFile();
    if (!blob) return;
    e.preventDefault();
    void add(blob, blob.name && blob.name !== "image.png" ? blob.name : `pasted_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}`);
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: t("editor.image.deleteTitle", { ref: value }), body: t("editor.image.deleteBody"), tone: "danger", confirmLabel: t("common.delete") }))) return;
    setError(null);
    const r = await deleteImage(value);
    if (!r.ok) setError(r.error);
    await refresh();
  };

  return (
    // Ctrl+V here pastes an image; it must not reach the editor's "paste step" shortcut (a window listener).
    <div className="field" onPaste={onPaste} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") e.stopPropagation(); }}>
      <span>{t("editor.imageRef")}</span>
      <div className="input-group">
        <select className="select mono" value={value} onChange={(e) => { setError(null); onChange(e.target.value); }} aria-label={t("editor.imageRef")} aria-invalid={missing}>
          <option value="">{t("editor.image.choose")}</option>
          {missing && <option value={value}>{t("editor.image.missingOption", { ref: value })}</option>}
          {refs.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="button" className="btn ghost icon sm" onClick={() => void refresh()} title={t("editor.pick.refresh")} aria-label={t("editor.pick.refresh")}><Icon name="RotateCcw" size={14} /></button>
        {stored && <button type="button" className="btn ghost icon sm" onClick={() => void remove()} title={t("common.delete")} aria-label={t("common.delete")}><Icon name="Trash2" size={14} /></button>}
      </div>
      <div className="row wrap">
        <button type="button" className="btn sm" disabled={busy} onClick={() => file.current?.click()}><Icon name="Upload" size={14} /> {t("editor.image.import")}</button>
        <input
          ref={file}
          type="file"
          accept="image/png"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = ""; // the same file can be picked again
            if (f) void add(f, f.name);
          }}
        />
      </div>
      {error && <small className="hint" role="alert" style={{ color: "var(--af-danger)" }}>{error}</small>}
      {missing && !error && <small className="hint" style={{ color: "var(--af-danger)" }}>{t("editor.image.missing", { ref: value })}</small>}
      <small className="hint">{t("editor.image.nativeHint", { mb: IMAGE_MAX_BYTES / (1024 * 1024), px: IMAGE_MAX_SIDE })}</small>
    </div>
  );
}

/** Text input with suggestions (free text stays possible) and an optional refresh button. */
function SuggestInput({ value, onChange, options, onRefresh, placeholder, label, mono }: { value: string; onChange: (v: string) => void; options: { value: string; label?: string }[] | null; onRefresh?: () => void; placeholder?: string; label?: string; mono?: boolean }) {
  const t = useT();
  const id = useId();
  const input = <input className={`input${mono ? " mono" : ""}`} value={value} placeholder={placeholder} aria-label={label} list={options ? id : undefined} onChange={(e) => onChange(e.target.value)} spellCheck={false} />;
  if (!options) return input;
  return (
    <div className="input-group">
      {input}
      <datalist id={id}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</datalist>
      {onRefresh && <button type="button" className="btn ghost icon sm" onClick={onRefresh} title={t("editor.pick.refresh")} aria-label={t("editor.pick.refresh")}><Icon name="RotateCcw" size={14} /></button>}
    </div>
  );
}

/**
 * An app name: program name on Windows (suggestions from the open windows), package name on Android
 * (picked from the installed apps by label; the package is what is stored). Free text always works.
 */
export function AppInput({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  const t = useT();
  const windows = useNativeList(listWindows, platform === "windows");
  const apps = useNativeList(listApps, platform === "android");
  if (platform === "android" && apps.items) {
    const known = apps.items.find((a) => a.package === value);
    return (
      <div className="stack-sm" style={{ minWidth: 0 }}>
        <div className="input-group">
          <select className="select" value={known ? value : ""} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label={t("editor.pick.app")}>
            <option value="">{t("editor.pick.app")}</option>
            {apps.items.map((a) => <option key={a.package} value={a.package}>{a.label}</option>)}
          </select>
          <button type="button" className="btn ghost icon sm" onClick={() => void apps.refresh()} title={t("editor.pick.refresh")} aria-label={t("editor.pick.refresh")}><Icon name="RotateCcw" size={14} /></button>
        </div>
        <input className="input mono" value={value} placeholder={placeholder} aria-label={label} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      </div>
    );
  }
  const options = platform === "windows" && windows.items ? distinct(windows.items.map((w) => w.app)).map((a) => ({ value: a })) : null;
  return <SuggestInput mono value={value} onChange={onChange} options={options} onRefresh={() => void windows.refresh()} placeholder={placeholder} label={label} />;
}

/** "Window title contains" + "App" of a window step, with suggestions from the open windows (Windows app). */
export function WindowMatchFields({ title, app, onChange, labels }: { title: string | undefined; app: string | undefined; onChange: (m: { title?: string; app?: string }) => void; labels: { title: ReactNode; app: ReactNode } }) {
  const { items, refresh } = useNativeList(listWindows, platform === "windows");
  // Typing an app narrows the title suggestions to that app's windows, and the other way round.
  const titles = items ? distinct(items.filter((w) => !app || w.app === app).map((w) => w.title)).map((x) => ({ value: x })) : null;
  const appsOf = items ? distinct(items.filter((w) => !title || w.title.includes(title)).map((w) => w.app)) : null;
  const apps = items ? (appsOf!.length ? appsOf! : distinct(items.map((w) => w.app))).map((x) => ({ value: x })) : null;
  return (
    <>
      <label className="field">
        <span>{labels.title}</span>
        <SuggestInput value={title ?? ""} onChange={(v) => onChange({ title: v || undefined, app })} options={titles} onRefresh={() => void refresh()} />
      </label>
      <label className="field">
        <span>{labels.app}</span>
        <SuggestInput mono value={app ?? ""} onChange={(v) => onChange({ title, app: v || undefined })} options={apps} onRefresh={() => void refresh()} />
      </label>
    </>
  );
}
