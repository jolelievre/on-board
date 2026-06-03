import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import styles from "./ShareMatchDialog.module.css";

type Props = {
  matchId: string;
  onClose: () => void;
};

type TokenState =
  | { kind: "loading" }
  | { kind: "ready"; token: string }
  | { kind: "error"; message: string };

type TokenResponse = { token: string; createdAt: string };

/**
 * Owner-facing share-link dialog. Hydrates the existing token (if any)
 * on mount, mints one on demand, copies to clipboard, exposes a Web
 * Share API entry point, and revokes the token outright.
 *
 * No optimistic UI — the share link is a single owner-only mutation,
 * the revoke is destructive (kills the public link), and both round-
 * trip fast enough that an explicit loading state reads better than a
 * silent flicker.
 */
export function ShareMatchDialog({ matchId, onClose }: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState<TokenState>({ kind: "loading" });
  const [copied, setCopied] = useState(false);

  const fetchOrCreate = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      // GET first — avoid minting an unused token if the caller opens
      // and closes the dialog. The endpoint returns 204 when none
      // exists yet (treated as `undefined` by `api()`).
      const existing = await api<TokenResponse | undefined>(
        `/api/matches/${matchId}/share-token`,
      );
      if (existing) {
        setState({ kind: "ready", token: existing.token });
        return;
      }
      const created = await api<TokenResponse>(
        `/api/matches/${matchId}/share-token`,
        { method: "POST" },
      );
      setState({ kind: "ready", token: created.token });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : t("share.dialog.error");
      setState({ kind: "error", message });
    }
  }, [matchId, t]);

  useEffect(() => {
    void fetchOrCreate();
  }, [fetchOrCreate]);

  // Escape closes the dialog — mirrors the merge / unlink dialogs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const shareUrl =
    state.kind === "ready"
      ? `${window.location.origin}/share/${state.token}`
      : null;

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard write can fail in non-secure contexts or when
      // permissions are denied — surface the URL so the user can
      // long-press the input and copy manually.
      setCopied(false);
    }
  }, [shareUrl]);

  const handleWebShare = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.share({
        title: t("share.dialog.shareTitle"),
        url: shareUrl,
      });
    } catch {
      // User cancelled or browser refused — silent, the URL is still
      // displayed for the manual-copy fallback.
    }
  }, [shareUrl, t]);

  const handleRevoke = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      await api(`/api/matches/${matchId}/share-token`, { method: "DELETE" });
      onClose();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : t("share.dialog.error");
      setState({ kind: "error", message });
    }
  }, [matchId, onClose, t]);

  const canWebShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      data-testid="share-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.sheet}>
        <header className={styles.header}>
          <h2 className={styles.title}>{t("share.dialog.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            className={styles.closeButton}
            data-testid="share-dialog-close"
          >
            <Icon name="x" size={20} />
          </button>
        </header>
        <p className={styles.body}>{t("share.dialog.body")}</p>

        {state.kind === "loading" && (
          <p className={styles.status}>{t("common.loading")}</p>
        )}

        {state.kind === "error" && (
          <p
            className={styles.statusError}
            data-testid="share-dialog-error"
          >
            {state.message}
          </p>
        )}

        {state.kind === "ready" && shareUrl && (
          <>
            <div className={styles.urlRow}>
              <input
                type="text"
                value={shareUrl}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                className={styles.urlInput}
                aria-label={t("share.dialog.urlLabel")}
                data-testid="share-dialog-url"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleCopy()}
                iconBefore={<Icon name="check" size={16} />}
                data-testid="share-dialog-copy"
              >
                {copied ? t("share.dialog.copied") : t("share.dialog.copy")}
              </Button>
            </div>

            <div className={styles.actions}>
              {canWebShare && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleWebShare()}
                  iconBefore={<Icon name="link" size={16} />}
                  data-testid="share-dialog-web-share"
                >
                  {t("share.dialog.shareCta")}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={() => void handleRevoke()}
                data-testid="share-dialog-revoke"
              >
                {t("share.dialog.revoke")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
