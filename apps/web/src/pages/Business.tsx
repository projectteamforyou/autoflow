/**
 * /business — one place to buy a Business license: sign in (or create the account), pay with the provider for the
 * app language (ko → PortOne, others → PayPal), get the license key. Reached from the site's pricing page and from
 * Settings; works on a first visit (no onboarding redirect).
 */
import { useEffect, useState } from "react";
import { BUSINESS_PRICES, PROVIDER_CURRENCY, formatPrice } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { auth, type User } from "../lib/api";
import { providerForLocale } from "../lib/billing";
import { useLocale, useT } from "../i18n";
import { BillingSection } from "./Billing";
import { SignInCard } from "./Admin";

export function BusinessPage() {
  const t = useT();
  const loc = useLocale();
  const [me, setMe] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    auth.me().then(setMe).catch(() => setMe(null));
  }, []);
  const currency = PROVIDER_CURRENCY[providerForLocale(loc)];
  const price = (p: "month" | "year") => formatPrice(BUSINESS_PRICES[p][currency], currency, loc);
  const step = me ? 2 : 1;

  return (
    <Shell title={<h2>{t("business.title")}</h2>}>
      <div className="page" style={{ maxWidth: 820 }}>
        <section className="business-hero">
          <span className="badge primary"><Icon name="BadgeCheck" size={13} /> Business</span>
          <h1>{t("business.headline")}</h1>
          <p>{t("business.lead", { month: price("month"), year: price("year") })}</p>
          <ul className="business-points">
            {(["business.point1", "business.point2", "business.point3"] as const).map((k) => (
              <li key={k}><Icon name="Check" size={15} /> {t(k)}</li>
            ))}
          </ul>
        </section>

        <ol className="business-steps" aria-label={t("business.title")}>
          {(["business.step1", "business.step2", "business.step3"] as const).map((k, i) => (
            <li key={k} className={i + 1 < step ? "done" : i + 1 === step ? "current" : ""}>
              <span>{i + 1 < step ? <Icon name="Check" size={14} /> : i + 1}</span> {t(k)}
            </li>
          ))}
        </ol>

        {me === undefined ? (
          <p className="muted small">{t("common.loading")}</p>
        ) : me === null ? (
          <>
            <p className="small muted">{t("business.signinFirst")}</p>
            <SignInCard onSignedIn={setMe} />
          </>
        ) : (
          <BillingSection user={me} onUser={setMe} purchase />
        )}
      </div>
    </Shell>
  );
}
