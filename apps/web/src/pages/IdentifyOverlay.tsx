/**
 * Content of the transparent "identify monitors" windows the desktop shell opens on every monitor
 * (`displays_identify`): just the monitor's number, as numbered in the Stage panel. Rendered on its
 * own by main.tsx (no store, no bridge calls), and closed by the shell after a moment.
 */
export function IdentifyOverlay({ n, primary }: { n: number; primary: boolean }) {
  return (
    <div className="identify-overlay" aria-label={`Monitor ${n}`}>
      <div className="identify-badge">
        <b>{n}</b>
        {primary && <span>★</span>}
      </div>
    </div>
  );
}

/** Parses `#/identify?n=2&primary=1`; undefined for every other route. */
export function identifyParams(hash: string): { n: number; primary: boolean } | undefined {
  const m = /^#\/identify\?(.*)$/.exec(hash);
  if (!m) return undefined;
  const q = new URLSearchParams(m[1]);
  const n = Math.max(1, Math.min(16, Number(q.get("n")) || 1));
  return { n, primary: q.get("primary") === "1" };
}
