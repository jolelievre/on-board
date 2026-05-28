import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { requestLinkToken } from "../../lib/mutations";
import { pullSync, resetPullCursors } from "../../lib/pull-sync";
import { db, type LocalProfile3 } from "../../lib/db";
import { Button } from "../ui/Button";
import { LinkCelebration } from "./LinkCelebration";
import styles from "./LinkCodeDisplay.module.css";

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; token: string; expiresAt: number }
  | { kind: "expired" }
  | { kind: "celebrating" }
  | { kind: "error"; message: string };

/**
 * Render the caller's link token as a scannable QR. The friend points
 * their owner-app's scanner at this surface to bilaterally link their
 * own profile with the one this display is anchored to.
 *
 * Token lifecycle (matches server `LINK_TOKEN_TTL_MS = 60_000`):
 *   - On mount, request a fresh token scoped to `profile.id`; render QR.
 *   - Tick a 1 s countdown; at expiry, swap the QR for an explicit
 *     "Refresh" button — minting silently would risk a stale display
 *     between renders.
 *   - While the QR is live, poll `/api/profiles/:id` every 2 s. The
 *     moment the scanner POSTs and the server flips `linkedUserId` on
 *     our row, we mirror it into Dexie, swap the QR for a celebration
 *     overlay, then signal the parent via `onLinked` so it can collapse
 *     into the linked card.
 *   - Polling stops automatically on link success, on token expiry, on
 *     unmount, and on a fetch failure (we don't loop forever on a
 *     network error).
 */
export function LinkCodeDisplay({
  profile,
  onLinked,
}: {
  profile: LocalProfile3;
  /** Called when the bilateral link lands. Parent typically collapses
   * the QR panel + the linked-card view takes over (which is driven by
   * Dexie's reactive read of the profile). */
  onLinked?: (linkedProfile: LocalProfile3) => void;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [, setTick] = useState(0);

  const mint = async () => {
    setState({ kind: "loading" });
    try {
      const res = await requestLinkToken({ sourceProfileId: profile.id });
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

  // Poll for the bilateral link landing. Active only while we have a
  // live QR on screen; the moment we detect `linkedUserId` on our own
  // profile flipped from null → set, we mirror Dexie and flip to the
  // celebration overlay. The parent's reactive `useProfile` query
  // already drives the linked-card render once Dexie updates, so all
  // we owe here is the brief celebration window.
  useEffect(() => {
    if (state.kind !== "ready") return;
    let cancelled = false;
    const id = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/profiles/${profile.id}`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const fresh = (await res.json()) as LocalProfile3;
        if (cancelled) return;
        if (fresh.linkedUserId !== null) {
          await db.profiles.put(fresh);
          // The shower's side needs the same retroactive-visibility
          // refresh that `linkProfile` triggers on the scanner's
          // side: linking doesn't bump `Match.updatedAt`, so the next
          // `?since=` delta would miss the friend's pre-link history.
          // Drop the cursors and force a full pull before celebrating.
          await resetPullCursors();
          try {
            await pullSync({ force: true });
          } catch {
            // Network blip — next routine pullSync (boot / route /
            // online event) retries with the cleared cursor.
          }
          setState({ kind: "celebrating" });
        }
      } catch {
        // Network blip — try again on the next tick. We don't surface
        // a transient poll failure as an error state because the QR
        // is still valid and the next interval may succeed.
      }
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [state.kind, profile.id]);

  if (state.kind === "loading" || state.kind === "idle") {
    return (
      <div className={styles.root} data-testid="link-code-display">
        <p className={styles.hint}>{t("link.code.loading")}</p>
      </div>
    );
  }

  if (state.kind === "celebrating") {
    return (
      <div className={styles.root} data-testid="link-code-display">
        <LinkCelebration
          onDone={() => {
            // Hand control back to the parent — Dexie already holds the
            // linked row, so the linked-card branch of the parent's
            // reactive render will display immediately.
            void db.profiles.get(profile.id).then((linked) => {
              if (linked) onLinked?.(linked);
            });
          }}
        />
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
    </div>
  );
}
