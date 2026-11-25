import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Flow } from "@autoflow/core";
import { Icon } from "../components/Icon";
import { Field } from "../components/ui";
import { useStore } from "../lib/store";
import { confirmDialog, promptDialog } from "../lib/dialog";
import { SECRET_NAME, deleteSecret, listSecrets, secretUsage, setSecret } from "../lib/secrets";
import { hasNativeBridge } from "../platform";
import { useT } from "../i18n";
import { blockImeSubmit } from "../lib/ime";

/**
 * Settings card for flow secrets ({{secret:name}}). Values are write-only: this screen lists names,
 * which flows use them, and which referenced names have no value on this device yet.
 */
export function SecretsCard() {
  const t = useT();
  const flows = useStore((s) => s.flows);
  const toast = useStore((s) => s.toast);
  const [names, setNames] = useState<string[] | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = () => listSecrets().then(setNames).catch((e) => { setNames([]); toast("error", (e as Error).message); });
  useEffect(() => void reload(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const usage = useMemo(() => secretUsage(flows), [flows]);
  const missing = useMemo(() => (names ? [...usage.keys()].filter((n) => !names.includes(n)).sort() : []), [usage, names]);
  const nameOk = SECRET_NAME.test(name);

  const save = async (n: string, v: string) => {
    setBusy(true);
    try {
      await setSecret(n, v);
      toast("success", t("secrets.saved", { name: n }));
      await reload();
      return true;
    } catch (e) {
      toast("error", (e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Asks for a value in a password field (set a missing secret, or replace an existing one). */
  const ask = async (n: string) => {
    const v = await promptDialog({ title: t("secrets.valueTitle", { name: n }), input: { label: t("secrets.value"), type: "password" }, confirmLabel: t("common.save") });
    if (v) await save(n, v);
  };

  const add = async () => {
    if (!nameOk || !value) return;
    if (names?.includes(name) && !(await confirmDialog({ title: t("secrets.replace"), body: t("secrets.replaceExisting", { name }), tone: "warning", confirmLabel: t("secrets.replace") }))) return;
    if (await save(name, value)) {
      setName("");
      setValue("");
    }
  };

  const remove = async (n: string) => {
    if (!(await confirmDialog({ title: t("secrets.deleteTitle", { name: n }), body: usage.has(n) ? t("secrets.deleteBody") : undefined, tone: "danger", confirmLabel: t("common.delete") }))) return;
    try {
      await deleteSecret(n);
      toast("info", t("secrets.deleted", { name: n }));
    } catch (e) {
      toast("error", (e as Error).message);
    }
    await reload();
  };

  return (
    <section className="card stack">
      <h3><Icon name="KeyRound" size={16} /> {t("secrets.title")}</h3>
      <p className="hint">{t(hasNativeBridge ? "secrets.hint.native" : "secrets.hint.web")}</p>
      {missing.length > 0 && (
        <div className="callout warn">
          <Icon name="TriangleAlert" />
          <div className="stack-sm grow" style={{ minWidth: 0 }}>
            <b>{t("secrets.missing")}</b>
            {missing.map((n) => (
              <div key={n} className="row wrap between">
                <div style={{ minWidth: 0 }}>
                  <code>{n}</code>
                  <UsedBy flows={usage.get(n) ?? []} />
                </div>
                {/* Names the manager cannot store (too long) are listed so the flow can be fixed, without a button. */}
                {SECRET_NAME.test(n) && <button className="btn sm" disabled={busy} onClick={() => void ask(n)}><Icon name="KeyRound" size={14} /> {t("secrets.set")}</button>}
              </div>
            ))}
          </div>
        </div>
      )}
      {names === null ? (
        <p className="muted small">{t("common.loading")}</p>
      ) : names.length === 0 ? (
        <p className="muted small">{t("secrets.empty")}</p>
      ) : (
        <div className="stack-xs">
          {names.map((n) => (
            <div key={n} className="row wrap between secret-row">
              <div style={{ minWidth: 0 }}>
                <code>{n}</code>
                <UsedBy flows={usage.get(n) ?? []} />
              </div>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn sm ghost" disabled={busy} onClick={() => void ask(n)}><Icon name="Pen" size={14} /> {t("secrets.replace")}</button>
                <button className="btn sm ghost icon" disabled={busy} title={t("common.delete")} aria-label={`${t("common.delete")} ${n}`} onClick={() => void remove(n)}><Icon name="Trash2" size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <form className="grid cols-2" style={{ alignItems: "start" }} onKeyDown={blockImeSubmit} onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <Field label={t("secrets.name")} error={name && !nameOk ? t("secrets.nameRule") : null}>
          <input className="input mono" value={name} maxLength={40} onChange={(e) => setName(e.target.value.trim())} placeholder="recorded_1" spellCheck={false} autoComplete="off" aria-invalid={!!name && !nameOk} />
        </Field>
        <Field label={t("secrets.value")}>
          <div className="input-group">
            <input className="input" type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="new-password" />
            <button className="btn primary" disabled={busy || !nameOk || !value}><Icon name="Plus" size={15} /> {t("secrets.add")}</button>
          </div>
        </Field>
      </form>
    </section>
  );
}

function UsedBy({ flows }: { flows: Flow[] }) {
  const t = useT();
  if (!flows.length) return <div className="small subtle">{t("secrets.unused")}</div>;
  return (
    <div className="small muted" style={{ overflowWrap: "anywhere" }}>
      {t("secrets.usedBy")}{" "}
      {flows.map((f, i) => (
        <span key={f.id}>{i > 0 && ", "}<Link to={`/flows/${f.id}`}>{f.name}</Link></span>
      ))}
    </div>
  );
}
