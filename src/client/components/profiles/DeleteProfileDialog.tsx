import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { deleteProfile } from "../../lib/mutations";
import type { LocalProfile } from "../../lib/db";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import styles from "./DeleteProfileDialog.module.css";

type Props = {
  profile: LocalProfile;
  /** Threaded through to `deleteProfile` so the queued DELETE carries
   * an authoritative `ownerId` stamp. Without it, the sync engine's
   * ownership inferer would return null (the local Profile row is
   * gone post-mutation) and `filterOwnedBy` would drop the entry. */
  viewerId: string;
  /** Number of matches the profile has participated in — used to
   * pluralise the confirm body. Computed by the caller via
   * `useProfileStats(profileId).totalMatches`, which lives in the same
   * page tree. Pass `0` when no matches are known yet. */
  matchCount: number;
  onClose: () => void;
  /** Called after the local Dexie row + queued DELETE both commit. The
   * caller typically navigates back to the Players tab listing since
   * the profile has just disappeared from the local mirror. */
  onDeleted: () => void;
};

/**
 * Owner-facing confirm dialog for profile deletion (Phase 8-G).
 *
 * The mutation is local-first: `deleteProfile` writes to Dexie + queues
 * the server DELETE in one transaction. The local Player rows that
 * reference this profile keep their embedded `profile` snapshot intact
 * so historical multi-player matches keep rendering verbatim — that's
 * the load-bearing rendering contract documented on the server-side
 * `playerProfileInclude`.
 *
 * For linked profiles the server runs the existing bilateral-unlink
 * transaction first (mirrors the dedicated unlink endpoint), then sets
 * `deletedAt`. The friend loses match-visibility through the existing
 * 6-C link-transition cursor reset on their device — no additional
 * propagation channel needed here.
 */
export function DeleteProfileDialog({
  profile,
  viewerId,
  matchCount,
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
      await deleteProfile({ profileId: profile.id, viewerId });
      onDeleted();
    } catch {
      setError(t("players.delete.error"));
      setSubmitting(false);
    }
  }, [profile.id, viewerId, onDeleted, t]);

  const isLinked = profile.linkedUserId !== null;

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      data-testid="delete-profile-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className={styles.sheet}>
        <header className={styles.header}>
          <span className={styles.headerIcon} aria-hidden="true">
            <Icon name="trash" size={18} />
          </span>
          <h2 className={styles.title}>{t("players.delete.title")}</h2>
        </header>
        <p className={styles.body}>
          {matchCount === 0
            ? t("players.delete.bodyNoMatches", { alias: profile.alias })
            : t("players.delete.body", {
                count: matchCount,
                alias: profile.alias,
              })}
        </p>
        {isLinked && (
          <p className={styles.warning} data-testid="delete-profile-linked-warning">
            {t("players.delete.linkedWarning", { alias: profile.alias })}
          </p>
        )}
        {error && (
          <p className={styles.error} data-testid="delete-profile-error">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={submitting}
            data-testid="delete-profile-cancel"
          >
            {t("players.delete.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={submitting}
            data-testid="delete-profile-confirm"
          >
            {submitting
              ? t("players.delete.submitting")
              : t("players.delete.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
