import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { LocalProfile3 } from "../../lib/db";
import { useProfileList } from "../../hooks/data/useProfiles";
import { mergeProfile } from "../../lib/mutations";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import styles from "./MergeDialog.module.css";

/**
 * Bottom-sheet dialog for the "Merge into another profile" action.
 *
 * Lists every unclaimed profile the viewer can see (excluding the
 * source) as a tappable target. Submit calls `mergeProfile`, which
 * optimistically rewrites Dexie + queues the server POST. The dialog
 * closes immediately after a successful submit; callers should
 * navigate to the surviving profile (the merge is local before the
 * POST returns, so the source row is already gone from Dexie).
 *
 * Linked profiles are intentionally absent from the candidate list:
 * the 6-B server endpoint rejects them, and the token-required path
 * lands in 6-C.
 */
export function MergeDialog({
  source,
  viewerId,
  onClose,
  onMerged,
}: {
  source: LocalProfile3;
  viewerId: string;
  onClose: () => void;
  onMerged: (targetId: string) => void;
}) {
  const { t } = useTranslation();
  const { data: profiles } = useProfileList(viewerId);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape; mirrors native dialog UX.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Candidates are every profile the viewer owns (any linked state),
  // minus the source itself. Friend-owned profiles linked to the
  // viewer don't qualify — the merge resolver requires the caller to
  // own *both* sides. Source is always unclaimed here (the entry
  // point in the profile detail page only renders MergeDialog for
  // `!isLinked` profiles), so:
  //   - target unclaimed → 6-B behavior, no link state changes.
  //   - target linked → 6-C-relaxed behavior: source folds in,
  //     target keeps its link.
  const candidates = (profiles ?? []).filter(
    (p) => p.id !== source.id && p.ownerId === viewerId,
  );

  const handleConfirm = async () => {
    if (!targetId) return;
    setError(null);
    setSubmitting(true);
    try {
      await mergeProfile({
        targetProfileId: targetId,
        sourceProfileId: source.id,
      });
      onMerged(targetId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("merge.confirm"));
      setSubmitting(false);
    }
  };

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      data-testid="merge-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.sheet}>
        <h2 className={styles.title}>{t("merge.title")}</h2>
        <p className={styles.hint}>
          {t("merge.hint", { alias: source.alias })}
        </p>

        {source.linkedUserId !== null && (
          <p className={styles.error}>{t("merge.linkedBlocked")}</p>
        )}

        {candidates.length === 0 ? (
          <p className={styles.empty}>{t("merge.noCandidates")}</p>
        ) : (
          <div className={styles.candidates}>
            {candidates.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => setTargetId(p.id)}
                className={`${styles.candidate} ${
                  targetId === p.id ? styles.candidateSelected : ""
                }`}
                data-testid={`merge-candidate-${p.id}`}
              >
                <Avatar profile={p} viewerId={viewerId} size="sm" />
                <span>{p.alias}</span>
              </button>
            ))}
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={submitting}
            data-testid="merge-cancel"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => void handleConfirm()}
            disabled={
              submitting ||
              !targetId ||
              source.linkedUserId !== null ||
              candidates.length === 0
            }
            data-testid="merge-confirm"
          >
            {submitting ? t("merge.confirming") : t("merge.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
