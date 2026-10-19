import { STUDIO_URL, studioPromo } from "@autoflow/core";
import { Icon } from "./Icon";
import { useLocale } from "../i18n";

const href = (lang: string, medium: string) => `${STUDIO_URL}/?utm_source=autoflow&utm_medium=${medium}&utm_campaign=${lang}`;

/** Wide card for Home: "More from Projectteamforyou". */
export function StudioPromoCard() {
  const lang = useLocale();
  const p = studioPromo(lang);
  return (
    <a className="card studio-promo" href={href(lang, "app-home")} target="_blank" rel="noopener">
      <div className="tile-icon"><Icon name="Sparkles" size={22} /></div>
      <div className="grow" style={{ minWidth: 0 }}>
        <strong>{p.title}</strong>
        <p className="small muted" style={{ margin: "2px 0 0" }}>{p.body}</p>
      </div>
      <span className="btn sm primary">{p.cta} <Icon name="ExternalLink" size={14} /></span>
    </a>
  );
}

/** Compact sidebar link. */
export function StudioPromoLink() {
  const lang = useLocale();
  const p = studioPromo(lang);
  return (
    <a className="nav-link studio-link" href={href(lang, "app-sidebar")} target="_blank" rel="noopener" title={p.body}>
      <Icon name="Sparkles" size={16} /> <span className="truncate">{p.title}</span> <Icon name="ExternalLink" size={13} />
    </a>
  );
}
