import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { deleteMatch } from "../../lib/mutations";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import styles from "./DeleteMatchDialog.module.css";

type Props = {
  matchId: string;
  /** Threaded through to `deleteMatch` so the queued DELETE carries
   * an authoritative `ownerId` stamp. Without it, the sync engine's
   * ownership inferer would return null (the local Match row is gone
   * post-mutation) and `filterOwnedBy` would drop the entry. */
  viewerId: string;
  onClose: () => void;
  /** Called after the local Dexie row + queued DELETE both commit. The
   * caller typically navigates away from the match-detail screen since
   * the match no longer exists in the local mirror. */
  onDeleted: () => void;
};

/**
 * Owner-facing confirm dialog for match deletion (Phase 8-G).
 *
 * The mutation is local-first: `deleteMatch` writes to Dexie + queues
 * the server DELETE in one transaction, so the dialog closes as soon
 * as the local write succeeds. The queued DELETE replays on the next
 * online flush; server tombstones the match; pull-sync propagates the
 * tombstone to every other device.
 *
 * No "are you sure" loading state — the local write is synchronous
 * enough that there's nothing to wait for. The error path covers the
 * Dexie transaction failing (extremely unlikely) and shows a retry
 * affordance.
 */
export function DeleteMatchDialog({
  matchId,
  viewerId,
  onClose,
  onDeleted,
}: Props) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, submitting]);

  const handleConfirm = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      await deleteMatch({ matchId, viewerId });
      onDeleted();
    } catch {
      setError(t("matches.delete.error"));
      setSubmitting(false);
    }
  }, [matchId, viewerId, onDeleted, t]);

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      data-testid="delete-match-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className={styles.sheet}>
        <header className={styles.header}>
          <span className={styles.headerIcon} aria-hidden="true">
            <Icon name="trash" size={18} />
          </span>
          <h2 className={styles.title}>{t("matches.delete.title")}</h2>
        </header>
        <p className={styles.body}>{t("matches.delete.body")}</p>
        {error && (
          <p className={styles.error} data-testid="delete-match-error">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={submitting}
            data-testid="delete-match-cancel"
          >
            {t("matches.delete.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={submitting}
            data-testid="delete-match-confirm"
          >
            {submitting
              ? t("matches.delete.submitting")
              : t("matches.delete.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
