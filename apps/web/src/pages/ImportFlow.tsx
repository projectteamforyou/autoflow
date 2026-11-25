import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { decodeShareCode, type ImportResult } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { ImportReview } from "../components/ImportReview";
import { useT } from "../i18n";

export function ImportFlowPage() {
  const t = useT();
  const [params] = useSearchParams();
  const [result, setResult] = useState<ImportResult | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const code = params.get("code");
    if (code) void decodeShareCode(code).then(setResult);
    else setResult({ ok: false, issues: [{ path: "", message: t("import.missingCode") }] });
  }, [params]);
  return (
    <Shell title={<h2>{t("import.review")}</h2>}>
      <div className="page">{result ? <ImportReview result={result} onClose={() => navigate("/flows")} /> : <p className="muted">{t("common.loading")}</p>}</div>
    </Shell>
  );
}
