import { Component, type ErrorInfo, type ReactNode } from "react";
import { Icon } from "./Icon";
import { t } from "../i18n";

interface Props {
  children: ReactNode;
  /** Changing this (the route path) clears the error, so navigating away from a broken screen works. */
  resetKey?: string;
}

interface State {
  error: unknown;
}

/**
 * Around the routes: a screen whose chunk could not be loaded (see lib/lazyPage.ts) or that threw
 * while rendering shows "Couldn't load this screen" with a Reload button — never a blank page.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error ?? new Error("unknown error") };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("AutoFlow: a screen failed to load or render", error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="page-error" role="alert" style={{ display: "grid", placeItems: "center", minHeight: "60vh", padding: 24 }}>
        <div className="card stack" style={{ maxWidth: 420, textAlign: "center", justifyItems: "center" }}>
          <Icon name="OctagonX" size={28} />
          <h2>{t("app.loadFailed")}</h2>
          <p className="muted small">{t("app.loadFailedHint")}</p>
          <div className="row wrap" style={{ justifyContent: "center" }}>
            <button className="btn primary" onClick={() => location.reload()}><Icon name="RotateCcw" size={15} /> {t("app.reload")}</button>
            <a className="btn" href="#/">{t("nav.home")}</a>
          </div>
        </div>
      </div>
    );
  }
}
