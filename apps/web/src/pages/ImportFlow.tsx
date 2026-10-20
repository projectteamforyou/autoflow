import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { decodeShareCode, explainFlow, newId, type ImportResult } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { Modal, SafetyBadge } from "../components/ui";
import { useStore } from "../lib/store";
import { tp, useT } from "../i18n";

/** Review sheet shown before any imported/shared flow is saved: validation, Safety Score, permissions, lint and a plain-language explanation. */
export function ImportReview({ result, onClose }: { result: ImportResult; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const save = useStore((s) => s.saveFlow);
  const flows = useStore((s) => s.flows);
  if (!result.ok || !result.flow) {
    return (
      <Modal title={t("import.invalid")} icon="ShieldAlert" onClose={onClose} footer={<button className="btn" onClick={onClose}>{t("common.close")}</button>}>
        <ul className="bullets small">
          {result.issues.slice(0, 8).map((i, n) => (
            <li key={n}>
              <code>{i.path || "/"}</code> {i.message}
            </li>
          ))}
        </ul>
      </Modal>
    );
  }
  const flow = result.flow;
  const errors = result.lint?.filter((l) => l.severity === "error") ?? [];
  const lines = explainFlow(flow);
  const onSave = async () => {
    const now = new Date().toISOString();
    const saved = await save({ ...flow, id: flows.some((f) => f.id === flow.id) ? newId("f") : flow.id, createdAt: now, updatedAt: now, revision: 0 }, { snapshot: false });
    onClose();
    navigate(`/flows/${saved.id}`);
  };
  return (
    <Modal
      wide
      title={t("import.review")}
      icon="ShieldCheck"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn primary" onClick={onSave}><Icon name="Save" size={15} /> {t("import.save")}</button>
        </>
      }
    >
      <div className="stack">
        <div className="row wrap">
          <h3 className="grow">{flow.name}</h3>
          <SafetyBadge flow={flow} />
          {result.hashMatches === true && <span className="badge ok"><Icon name="BadgeCheck" size={13} /> {t("import.hashOk")}</span>}
          {result.hashMatches === false && <span className="badge err"><Icon name="ShieldAlert" size={13} /> {t("import.hashBad")}</span>}
        </div>
        {flow.description && <p className="muted">{flow.description}</p>}
        {result.risk && result.risk.permissions.length > 0 && (
          <div className="stack-sm">
            <span className="label">{t("import.permissions")}</span>
            <div className="row wrap">
              {result.risk.permissions.map((p) => (
                <span key={p} className="badge">{t(p)}</span>
              ))}
            </div>
          </div>
        )}
        {result.risk && result.risk.findings.length > 0 && (
          <div className={`callout ${result.risk.level === "high" ? "err" : result.risk.level === "medium" ? "warn" : "info"}`}>
            <Icon name="ShieldAlert" />
            <ul className="bullets small">
              {result.risk.findings.map((f, i) => (
                <li key={i}>{t(f.key)}</li>
              ))}
            </ul>
          </div>
        )}
        {errors.length > 0 && <div className="callout err small"><Icon name="Bug" /> {t("import.lintErrors", { n: errors.length })}</div>}
        <div className="card" style={{ background: "var(--af-bg-2)" }}>
          <span className="label">{t("editor.explain")}</span>
          <div className="stack-xs small" style={{ marginTop: 8 }}>
            {lines.slice(0, 40).map((l, i) => (
              <div key={i} style={{ paddingLeft: l.depth * 16 }}>{tp(l.phrase)}</div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function ImportFlowPage() {
  const t = useT();
  const [params] = useSearchParams();
  const [result, setResult] = useState<ImportResult | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const code = params.get("code");
    if (code) void decodeShareCode(code).then(setResult);
    else setResult({ ok: false, issues: [{ path: "", message: "missing share code" }] });
  }, [params]);
  return (
    <Shell title={<h2>{t("import.review")}</h2>}>
      <div className="page">{result ? <ImportReview result={result} onClose={() => navigate("/flows")} /> : <p className="muted">{t("common.loading")}</p>}</div>
    </Shell>
  );
}
