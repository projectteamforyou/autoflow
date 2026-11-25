import { Modal } from "../../components/ui";
import { useT } from "../../i18n";

/** True while the user is typing: editor shortcuts must not steal keys (or the browser's text undo) from a field. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform ?? "");
const MOD = isMac ? "⌘" : "Ctrl";
const ALT = isMac ? "⌥" : "Alt";

/** One row: alternative key combinations (each a list of keys pressed together) and what they do. */
type Row = { keys: string[][]; label: string };

/**
 * The editor's keyboard shortcuts in one place (opened with "?" or the keyboard button in the top
 * bar). `pro` adds the step shortcuts, which only exist in the Pro editor.
 */
export function ShortcutsSheet({ pro, onClose }: { pro: boolean; onClose: () => void }) {
  const t = useT();
  const general: Row[] = [
    { keys: [[MOD, "Z"]], label: t("common.undo") },
    { keys: [[MOD, "Shift", "Z"], [MOD, "Y"]], label: t("common.redo") },
    { keys: [[MOD, "S"]], label: t("shortcuts.save") },
    { keys: [[MOD, "Enter"]], label: t("shortcuts.run") },
    { keys: [["?"]], label: t("shortcuts.open") },
  ];
  const steps: Row[] = [
    { keys: [["↑"], ["↓"]], label: t("shortcuts.select") },
    { keys: [[ALT, "↑"], [ALT, "↓"]], label: t("shortcuts.move") },
    { keys: [[MOD, "C"]], label: t("shortcuts.copy") },
    { keys: [[MOD, "X"]], label: t("shortcuts.cut") },
    { keys: [[MOD, "V"]], label: t("shortcuts.paste") },
    { keys: [[MOD, "D"]], label: t("shortcuts.duplicate") },
    { keys: [[MOD, "/"]], label: t("shortcuts.toggleDisabled") },
    { keys: [["F9"]], label: t("shortcuts.toggleBreakpoint") },
    { keys: [["Delete"]], label: t("shortcuts.delete") },
    { keys: [["Esc"]], label: t("shortcuts.deselect") },
  ];
  const table = (rows: Row[]) => (
    <dl className="shortcut-list">
      {rows.map((r) => (
        <div key={r.label}>
          <dt>
            {r.keys.map((combo, i) => (
              <span key={i} className="combo">
                {i > 0 && <span className="subtle"> / </span>}
                {combo.map((k, j) => <kbd key={j}>{k}</kbd>)}
              </span>
            ))}
          </dt>
          <dd>{r.label}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <Modal title={t("shortcuts.title")} icon="Keyboard" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>{t("common.close")}</button>}>
      <h4 className="shortcut-head">{t("shortcuts.general")}</h4>
      {table(general)}
      {pro && (
        <>
          <h4 className="shortcut-head">{t("shortcuts.steps")}</h4>
          {table(steps)}
        </>
      )}
      <p className="hint">{t("shortcuts.typingHint")}</p>
    </Modal>
  );
}
