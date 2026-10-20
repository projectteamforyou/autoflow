/** "Personal edition — for individual users", with a link to the in-app Business license page (/business). */
import { Icon } from "./Icon";
import { Link } from "react-router-dom";
import { useT } from "../i18n";

export function EditionNote({ compact = false }: { compact?: boolean }) {
  const t = useT();
  return (
    <div className={`edition-note${compact ? " compact" : ""}`}>
      <span className="edition-name">
        <Icon name="User" size={compact ? 14 : 15} />
        <b className="truncate">{t(compact ? "edition.personal" : "edition.personalLong")}</b>
      </span>
      <Link className="truncate" to="/business">{t("edition.business")} →</Link>
    </div>
  );
}
