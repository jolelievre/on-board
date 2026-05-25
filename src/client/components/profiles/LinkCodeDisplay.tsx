import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { requestLinkToken } from "../../lib/mutations";
import { Button } from "../ui/Button";
import styles from "./LinkCodeDisplay.module.css";

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; token: string; expiresAt: number }
  | { kind: "expired" }
  | { kind: "error"; message: string };

/**
 * Render the caller's link token as a scannable QR. The friend points
 * their owner-app's scanner at this surface to bind one of their
 * profiles to the caller's auth account.
 *
 * Token lifecycle (matches server `LINK_TOKEN_TTL_MS = 60_000`):
 *   - On mount, request a fresh token; render QR.
 *   - Tick a 1 s countdown; at expiry, swap the QR for an explicit
 *     "Refresh" button — minting silently would risk a stale display
 *     between renders.
 *   - On unmount, the in-flight token simply lapses; no server cleanup.
 *
 * No prop for the User id: the server reads it from the session.
 */
export function LinkCodeDisplay() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [, setTick] = useState(0);

  const mint = async () => {
    setState({ kind: "loading" });
    try {
      const res = await requestLinkToken();
      setState({
        kind: "ready",
        token: res.token,
        expiresAt: new Date(res.expiresAt).getTime(),
      });
    } catch (err) {
      setState({
        kind: "error",
        message:
          err instanceof Error ? err.message : t("link.code.error"),
      });
    }
  };

  useEffect(() => {
    void mint();
    // mint only runs on mount; subsequent refreshes are user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render the QR onto the canvas whenever a new token arrives. We use
  // a canvas (not an <img>) so the encoder writes pixels directly and
  // we sidestep generating an intermediate data URL each second.
  useEffect(() => {
    if (state.kind !== "ready" || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, state.token, {
      width: 256,
      margin: 0,
      errorCorrectionLevel: "M",
    }).catch(() => {
      setState({ kind: "error", message: t("link.code.error") });
    });
  }, [state, t]);

  // 1 s tick: re-renders to update countdown and trip the "expired"
  // transition. We only flip to `kind: "expired"` once — the user sees
  // a stable Refresh button instead of a wobbling negative timer.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const id = window.setInterval(() => {
      if (state.expiresAt <= Date.now()) {
        setState({ kind: "expired" });
      } else {
        setTick((t) => t + 1);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [state]);

  if (state.kind === "loading" || state.kind === "idle") {
    return (
      <div className={styles.root} data-testid="link-code-display">
        <p className={styles.hint}>{t("link.code.loading")}</p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className={styles.root} data-testid="link-code-display">
        <p className={styles.error}>{state.message}</p>
        <Button type="button" variant="primary" onClick={() => void mint()}>
          {t("link.code.retry")}
        </Button>
      </div>
    );
  }

  if (state.kind === "expired") {
    return (
      <div className={styles.root} data-testid="link-code-display">
        <p className={styles.hint}>{t("link.code.expired")}</p>
        <Button
          type="button"
          variant="primary"
          onClick={() => void mint()}
          data-testid="link-code-refresh"
        >
          {t("link.code.refresh")}
        </Button>
      </div>
    );
  }

  // state.kind === "ready"
  const secondsLeft = Math.max(
    0,
    Math.ceil((state.expiresAt - Date.now()) / 1000),
  );

  return (
    <div className={styles.root} data-testid="link-code-display">
      <div className={styles.qrFrame}>
        <canvas ref={canvasRef} data-testid="link-code-qr" />
      </div>
      <p
        className={
          secondsLeft <= 10
            ? `${styles.countdown} ${styles.countdownStale}`
            : styles.countdown
        }
        data-testid="link-code-countdown"
      >
        {t("link.code.expiresIn", { seconds: secondsLeft })}
      </p>
      <p className={styles.hint}>{t("link.code.hint")}</p>
    </div>
  );
}
