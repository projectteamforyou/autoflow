/** "Personal edition — for individual users", with a link to the Business license on the website. */
import { Icon } from "./Icon";
import { SITE_URL } from "../lib/site";
import { useLocale, useT } from "../i18n";

export function EditionNote({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const loc = useLocale();
  return (
    <div className={`edition-note${compact ? " compact" : ""}`}>
      <span className="edition-name">
        <Icon name="User" size={compact ? 14 : 15} />
        <b className="truncate">{t(compact ? "edition.personal" : "edition.personalLong")}</b>
      </span>
      <a className="truncate" href={`${SITE_URL}/${loc}/pricing/`} target="_blank" rel="noopener">{t("edition.business")} →</a>
    </div>
  );
}
