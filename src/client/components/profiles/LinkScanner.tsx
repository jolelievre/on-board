import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import QrScanner from "qr-scanner";
import { linkProfile, mergeProfile } from "../../lib/mutations";
import type { LocalProfile } from "../../lib/db";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { LinkCelebration } from "./LinkCelebration";
import styles from "./LinkScanner.module.css";

type ScannerState =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "submitting"; token: string }
  | { kind: "linked" }
  | {
      kind: "merge_required_scanner";
      existing: { id: string; alias: string };
      target: { id: string; alias: string };
    }
  | {
      kind: "merge_required_shower";
      existingAlias: string;
      targetAlias: string;
    }
  | { kind: "merging" }
  | { kind: "merged"; survivorId: string }
  | { kind: "error"; message: string };

/**
 * Owner-side QR scanner for the link-to-account flow.
 *
 * Lifecycle:
 *   1. Mount → request camera, start QR detection loop via `qr-scanner`.
 *   2. First valid decode → stop the scanner, POST `/api/profiles/:id/link`.
 *      Stopping immediately prevents a second decode firing while we
 *      wait on the network and would otherwise double-submit.
 *   3a. `linked` → success state; parent closes the scanner via `onDone`.
 *   3b. `merge_required` → render an inline confirmation; on confirm,
 *      call `mergeProfile` with the same token.
 *   3c. Any other error → render the message + a "Try again" button
 *      that restarts the scanner with a fresh token from the friend.
 *
 * The scanner is also reachable via the test-only path used by the
 * E2E suite, where the parent injects a token directly into the
 * `submit` callback rather than driving the camera.
 */
export function LinkScanner({
  profile,
  onDone,
  onMerged,
}: {
  profile: LocalProfile;
  /** Closes the scanner surface. Called on success and on cancel. */
  onDone: () => void;
  /** Called when a link-time merge collapses two profiles. Lets the
   * parent navigate to the surviving profile rather than the now-
   * deleted source. */
  onMerged?: (survivorId: string) => void;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [state, setState] = useState<ScannerState>({ kind: "idle" });

  // Submit the token once we have one — shared by the QR-decode path
  // and any future explicit-paste fallback. Stopping the scanner is
  // the caller's job (we don't know if it was running).
  const submitToken = async (token: string) => {
    setState({ kind: "submitting", token });
    try {
      const res = await linkProfile({ profileId: profile.id, token });
      if (res.status === "linked") {
        setState({ kind: "linked" });
      } else if (res.side === "scanner") {
        setState({
          kind: "merge_required_scanner",
          existing: res.existing,
          target: res.target,
        });
      } else {
        setState({
          kind: "merge_required_shower",
          existingAlias: res.existingAlias,
          targetAlias: res.targetAlias,
        });
      }
    } catch (err) {
      setState({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : t("link.scanner.error"),
      });
    }
  };

  const startScanner = async () => {
    if (!videoRef.current) return;
    setState({ kind: "scanning" });
    try {
      // Defensive teardown before re-creating — covers Retry after an
      // error where the previous instance might still hold the stream.
      scannerRef.current?.stop();
      scannerRef.current?.destroy();
      const scanner = new QrScanner(
        videoRef.current,
        (result) => {
          const token = result.data?.trim();
          if (!token) return;
          // Stop *before* the async submit so a duplicate frame can't
          // race a second link request.
          scanner.stop();
          void submitToken(token);
        },
        {
          preferredCamera: "environment",
          highlightScanRegion: false,
          highlightCodeOutline: false,
          maxScansPerSecond: 5,
        },
      );
      scannerRef.current = scanner;
      await scanner.start();
    } catch (err) {
      // Only fall to error state if we were still scanning. The
      // user may already have submitted a token through the
      // out-of-band path (E2E `__onboardSubmitLinkToken`, or a
      // future paste-token UI) by the time the camera promise
      // rejects, and overwriting their post-submit state would
      // strand them in a stale "camera failed" screen.
      setState((prev) =>
        prev.kind === "scanning"
          ? {
              kind: "error",
              message:
                err instanceof Error && err.message
                  ? err.message
                  : t("link.scanner.cameraError"),
            }
          : prev,
      );
    }
  };

  useEffect(() => {
    void startScanner();
    return () => {
      scannerRef.current?.stop();
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
    // Mount-only; restart is user-driven via the Retry button below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMergeConfirm = async () => {
    if (state.kind !== "merge_required_scanner") return;
    const survivorId = state.existing.id;
    const sourceId = state.target.id;
    setState({ kind: "merging" });
    try {
      // Navigate to the survivor *before* awaiting the merge: the
      // mutation deletes the source profile from Dexie inside its
      // transaction, and the source page (which currently hosts
      // this scanner) would briefly re-render to "profile not
      // found" between the local delete and our own state update.
      // Telling the parent to navigate first lets the scanner
      // unmount cleanly under control of the survivor page.
      onMerged?.(survivorId);
      await mergeProfile({
        targetProfileId: survivorId,
        sourceProfileId: sourceId,
      });
      // No further state update — the component has already
      // unmounted via the parent's navigation. We could call
      // `setState({ kind: "merged" })` defensively but React would
      // warn about updating an unmounted component.
    } catch (err) {
      // Navigation has already happened; the survivor page is up.
      // Log and surface a console error — the user can re-attempt
      // a manual merge from the survivor page if anything looks
      // wrong. A toast surface would be the right home for this
      // when one ships.
      console.error("[LinkScanner] merge after navigation failed", err);
    }
  };

  const handleRetry = () => {
    void startScanner();
  };

  // Test-only injection point: the E2E suite stubs window-level
  // helpers so it can drive the link flow without rendering a real
  // QR. The gate compares against a build-time-inlined string from
  // `vite.config.ts` (set from DEPLOY_ENV), so production builds
  // tree-shake the entire block — `window.__onboardSubmitLinkToken`
  // is never exposed in prod. Dev / integration / preview keep it.
  useEffect(() => {
    if (import.meta.env.VITE_ENABLE_TEST_HOOKS !== "true") return;
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      __onboardSubmitLinkToken?: (token: string) => Promise<void>;
    };
    w.__onboardSubmitLinkToken = async (token: string) => {
      scannerRef.current?.stop();
      await submitToken(token);
    };
    return () => {
      delete w.__onboardSubmitLinkToken;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The camera viewport stays mounted only while we're actively
  // looking for a code or submitting one. Once the link succeeds (or
  // surfaces a merge / error) we drop the big video block so the
  // message and the celebration animation are the only things on
  // screen — that's where the user's attention should land.
  const showViewport =
    state.kind === "idle" ||
    state.kind === "scanning" ||
    state.kind === "submitting";

  // Bring the panel into view on mount. The button row sits below
  // the hero + alias + stats, so the panel often spawns below the
  // fold — auto-scrolling avoids a "where did it go?" beat.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  return (
    <div ref={rootRef} className={styles.root} data-testid="link-scanner">
      {showViewport && (
        <div className={styles.viewport}>
          <video
            ref={videoRef}
            className={styles.video}
            autoPlay
            playsInline
            muted
          />
          {(state.kind === "scanning" || state.kind === "submitting") && (
            <div className={styles.reticle} />
          )}
        </div>
      )}

      {state.kind === "scanning" && (
        <p className={styles.hint}>{t("link.scanner.hint")}</p>
      )}

      {state.kind === "submitting" && (
        <p className={styles.status} data-testid="link-scanner-submitting">
          {t("link.scanner.submitting")}
        </p>
      )}

      {state.kind === "linked" && (
        <div data-testid="link-scanner-linked">
          <LinkCelebration onDone={onDone} />
        </div>
      )}

      {state.kind === "merge_required_scanner" && (
        <>
          <p
            className={styles.hint}
            data-testid="link-scanner-merge-required"
          >
            {t("link.scanner.mergePrompt", {
              existing: state.existing.alias,
              target: state.target.alias,
            })}
          </p>
          <div className={styles.actions}>
            <Button
              type="button"
              variant="secondary"
              onClick={onDone}
              data-testid="link-scanner-merge-cancel"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void handleMergeConfirm()}
              data-testid="link-scanner-merge-confirm"
              iconBefore={<Icon name="merge" size={16} />}
            >
              {t("link.scanner.mergeConfirm")}
            </Button>
          </div>
        </>
      )}

      {state.kind === "merge_required_shower" && (
        <>
          <p
            className={styles.error}
            data-testid="link-scanner-shower-merge"
          >
            {t("link.scanner.showerMergeNeeded", {
              existing: state.existingAlias,
              target: state.targetAlias,
            })}
          </p>
          <div className={styles.actions}>
            <Button type="button" variant="primary" onClick={onDone}>
              {t("common.done")}
            </Button>
          </div>
        </>
      )}

      {state.kind === "merging" && (
        <p className={styles.status}>{t("link.scanner.merging")}</p>
      )}

      {state.kind === "merged" && (
        <>
          <p className={styles.status} data-testid="link-scanner-merged">
            {t("link.scanner.merged")}
          </p>
          <div className={styles.actions}>
            <Button type="button" variant="primary" onClick={onDone}>
              {t("common.done")}
            </Button>
          </div>
        </>
      )}

      {state.kind === "error" && (
        <>
          <p className={styles.error} data-testid="link-scanner-error">
            {state.message}
          </p>
          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={onDone}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleRetry}
              data-testid="link-scanner-retry"
            >
              {t("link.scanner.retry")}
            </Button>
          </div>
        </>
      )}

      {(state.kind === "scanning" || state.kind === "submitting") && (
        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("common.cancel")}
          </Button>
        </div>
      )}
    </div>
  );
}
