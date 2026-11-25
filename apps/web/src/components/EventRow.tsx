import { walkSteps, type Flow, type RunEvent } from "@autoflow/core";
import { formatDuration, useT } from "../i18n";

// Shared by the Practice Canvas and the Ledger; a component module of its own so that opening the
// Ledger does not load the Canvas page chunk (and the other way round).
/** One line of the run log (Practice Canvas and Ledger). Successful step ends are not shown: the start line already says what ran. */
export function EventRow({ e, t0, flow }: { e: RunEvent; t0: number; flow?: Flow }) {
  const t = useT();
  const time = `+${((e.at - t0) / 1000).toFixed(2)}s`;
  let text = "";
  let cls = "";
  // Every RunEvent variant has a line; `never` below makes a new variant a compile error instead of an empty row.
  switch (e.type) {
    case "state": text = t(`pulse.state.${e.state}`); break;
    case "countdown": text = t("pulse.countdown", { s: Math.ceil(e.remainingMs / 1000) }); break;
    case "stepStart": text = `▶ ${t(`step.${e.stepType}`)} ${labelOf(flow, e.stepId)}`; break;
    case "stepEnd": if (e.ok) return null; text = `✕ ${nameOf(flow, e.stepId)}${e.error ? ` — ${e.error.message}` : ""}`; cls = "err"; break;
    case "breakpoint": text = `● ${t("editor.breakpoint")} ${nameOf(flow, e.stepId)}`; cls = "warn"; break;
    case "log": text = e.message; cls = e.level === "error" ? "err" : e.level === "warn" ? "warn" : ""; break;
    case "var": text = `${e.name} = ${(JSON.stringify(e.value) ?? "").slice(0, 80)}`; break;
    case "retry": text = `↻ ${t("onError.retry")} #${e.attempt} ${labelOf(flow, e.stepId)}${e.error ? ` — ${e.error}` : ""}`; cls = "warn"; break;
    case "timeout": text = `⏱ ${t("errcat.timeout")} (${formatDuration(e.timeoutMs)}) ${labelOf(flow, e.stepId)}`; cls = "warn"; break;
    case "error": text = `${t(`errcat.${e.error.category}`)}: ${e.error.message}`; cls = "err"; break;
    default: { const unknown: never = e; text = String((unknown as { type?: unknown }).type ?? ""); }
  }
  return (
    <div className={`event ${cls}`}>
      <time>{time}</time>
      <span style={{ overflowWrap: "anywhere" }}>{text}</span>
    </div>
  );
}

/** Step label when it has one, else its id (for lines that have no step type to show). */
function nameOf(flow: Flow | undefined, id: string): string {
  return labelOf(flow, id).replace(/^· /, "") || id;
}

function labelOf(flow: Flow | undefined, id: string): string {
  if (!flow) return "";
  let label = "";
  walkSteps(flow.steps, (s) => {
    if (s.id === id && s.label) label = `· ${s.label}`;
  });
  return label;
}
