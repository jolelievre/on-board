import { useTranslation } from "react-i18next";
import type {
  AvatarFrame,
  AvatarRing,
  LocalProfile,
} from "../../../lib/db";
import { Avatar } from "../../ui/Avatar";
import { Icon } from "../../ui/Icon";
import { patchProfile } from "../../../lib/mutations";
import shared from "./Studio.module.css";
import styles from "./StudioHub.module.css";

type Props = {
  profile: LocalProfile;
  viewerId: string;
  isSubmitting: boolean;
  previewFrame: AvatarFrame;
  previewRing: AvatarRing;
  onNewPhoto: () => void;
  onFromGallery: () => void;
  onStyleStamp: () => void;
  onClearPhoto: () => void;
  onDone?: () => void;
};

/**
 * Phase 7 — Capture Studio Hub. Three action rows lead into the
 * sub-flows; a dashed monogram row clears the photo back to the
 * initial-letter fallback. The "Style stamp" row is highlighted with
 * an accent border and disabled when no photo exists (the design
 * handoff's critical UX fix: styling must be reachable without
 * retaking the photo).
 */
export function StudioHub({
  profile,
  viewerId,
  isSubmitting,
  previewFrame,
  previewRing,
  onNewPhoto,
  onFromGallery,
  onStyleStamp,
  onClearPhoto,
}: Props) {
  const { t } = useTranslation();

  const hasPhoto = Boolean(profile.customAvatarUrl);
  const hasLinkedPhoto =
    profile.useLinkedAvatar &&
    profile.linkedUserId !== null &&
    profile.linkedUser?.avatarUrl != null;
  const styleEnabled = hasPhoto || hasLinkedPhoto;

  // Monogram initial — first character of the alias, mirrors the
  // initial-letter fallback drawn by `<Avatar>` when no photo resolves.
  const initial = (profile.alias.trim()[0] ?? "?").toUpperCase();

  const showLinkedToggle = profile.linkedUserId !== null;
  const isSelf =
    profile.linkedUserId !== null &&
    profile.linkedUserId === viewerId &&
    profile.ownerId === viewerId;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={shared.eyebrow}>{t("studio.eyebrow")}</span>
      </header>

      <div className={styles.previewBlock}>
        <Avatar
          profile={profile}
          viewerId={viewerId}
          size="lg"
          frame={previewFrame}
          ring={previewRing}
          className={styles.preview}
        />
        <div className={styles.previewMeta}>
          <span className={styles.alias}>{profile.alias}</span>
          <span className={shared.caption}>
            {hasPhoto || hasLinkedPhoto
              ? t("studio.currentStamp")
              : t("studio.noPhotoYet")}
          </span>
        </div>
      </div>

      <div className={styles.actionList}>
        <button
          type="button"
          className={styles.actionRow}
          onClick={onNewPhoto}
          disabled={isSubmitting}
          data-testid="studio-new-photo"
        >
          <Icon name="camera" size={20} className={styles.actionIcon} />
          <span className={styles.actionText}>
            <span className={styles.actionTitle}>
              {t("studio.newPhoto.title")}
            </span>
            <span className={styles.actionSubtitle}>
              {t("studio.newPhoto.subtitle")}
            </span>
          </span>
          <Icon name="arrow-left" size={16} className={styles.chevron} />
        </button>

        <button
          type="button"
          className={styles.actionRow}
          onClick={onFromGallery}
          disabled={isSubmitting}
          data-testid="studio-from-gallery"
        >
          <Icon name="image" size={20} className={styles.actionIcon} />
          <span className={styles.actionText}>
            <span className={styles.actionTitle}>
              {t("studio.fromGallery.title")}
            </span>
            <span className={styles.actionSubtitle}>
              {t("studio.fromGallery.subtitle")}
            </span>
          </span>
          <Icon name="arrow-left" size={16} className={styles.chevron} />
        </button>

        <button
          type="button"
          className={`${styles.actionRow} ${styles.actionRowAccent}`}
          onClick={onStyleStamp}
          disabled={isSubmitting || !styleEnabled}
          data-testid="studio-style-stamp"
        >
          <Icon name="sparkle" size={20} className={styles.actionIcon} />
          <span className={styles.actionText}>
            <span className={styles.actionTitle}>
              {t("studio.styleStamp.title")}
            </span>
            <span className={styles.actionSubtitle}>
              {t("studio.styleStamp.subtitle")}
            </span>
          </span>
          <Icon name="arrow-left" size={16} className={styles.chevron} />
        </button>

        {hasPhoto && (
          <button
            type="button"
            className={styles.monogramRow}
            onClick={onClearPhoto}
            disabled={isSubmitting}
            data-testid="studio-clear-photo"
          >
            {t("studio.monogramFallback", { initial })}
          </button>
        )}
      </div>

      {showLinkedToggle && (
        <div className={styles.toggleRow}>
          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={profile.useLinkedAvatar}
              onChange={(e) =>
                void patchProfile({
                  profileId: profile.id,
                  useLinkedAvatar: e.target.checked,
                })
              }
              data-testid="profile-use-linked-avatar"
            />
            <span>
              {isSelf
                ? t("avatar.useLinkedAvatarSelf")
                : t("avatar.useLinkedAvatar")}
            </span>
          </label>
          <p className={styles.toggleHint}>
            {isSelf
              ? t("avatar.useLinkedAvatarSelfHint")
              : t("avatar.useLinkedAvatarHint")}
          </p>
        </div>
      )}
    </div>
  );
}
