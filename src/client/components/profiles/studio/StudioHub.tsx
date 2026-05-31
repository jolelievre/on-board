import { useTranslation } from "react-i18next";
import type {
  AvatarFrame,
  AvatarRing,
  LocalProfile,
} from "../../../lib/db";
import { Avatar } from "../../ui/Avatar";
import { Icon } from "../../ui/Icon";
import { patchProfile } from "../../../lib/mutations";
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
};

/**
 * Capture Studio Hub. Compact layout: large stamp preview on top,
 * 2-column icon grid of source actions underneath.
 *
 * Action buttons (in order):
 *   1. **Photo** — open the camera.
 *   2. **Gallery** — native file picker → reposition.
 *   3. **Account** — only on linked profiles. Acts as a TOGGLE between
 *      the linked Google photo and the custom upload (preserves
 *      `customAvatarUrl`, flips `useLinkedAvatar`). The button's
 *      `aria-pressed` flips with the current state so the same icon
 *      is both visible and indicates which side is active.
 *   4. **Style** — opens the Style screen (frame + ring picker). Was
 *      previously a small sparkle overlay on the preview avatar; promoted
 *      to a first-class grid button per the feedback round so the
 *      Style affordance is consistent with the other source actions.
 *
 * The earlier "Initial" monogram clear-photo button is gone — the
 * Account toggle replaces it for linked profiles, and unlinked
 * profiles re-upload to change the photo.
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
}: Props) {
  const { t } = useTranslation();

  const hasLinkedAccount =
    profile.linkedUserId !== null && profile.linkedUser !== null;
  const showAccountToggle = hasLinkedAccount;
  const accountActive = profile.useLinkedAvatar;

  const handleToggleAccount = () => {
    void patchProfile({
      profileId: profile.id,
      useLinkedAvatar: !accountActive,
    });
  };

  return (
    <div className={styles.root}>
      <div className={styles.previewBlock}>
        <Avatar
          profile={profile}
          viewerId={viewerId}
          size="lg"
          frame={previewFrame}
          ring={previewRing}
          className={styles.preview}
        />
        <span className={styles.alias}>{profile.alias}</span>
      </div>

      <div className={styles.actionGrid}>
        <ActionButton
          onClick={onNewPhoto}
          disabled={isSubmitting}
          label={t("studio.newPhoto.title")}
          testid="studio-new-photo"
        >
          <Icon name="camera" size={30} />
        </ActionButton>

        <ActionButton
          onClick={onFromGallery}
          disabled={isSubmitting}
          label={t("studio.fromGallery.title")}
          testid="studio-from-gallery"
        >
          <Icon name="image" size={30} />
        </ActionButton>

        {showAccountToggle && (
          <ActionButton
            onClick={handleToggleAccount}
            disabled={isSubmitting}
            label={t("studio.useAccount.title")}
            testid="studio-use-account"
            pressed={accountActive}
          >
            <Icon name="globe" size={30} />
          </ActionButton>
        )}

        <ActionButton
          onClick={onStyleStamp}
          disabled={isSubmitting}
          label={t("studio.styleStamp.title")}
          testid="studio-style-stamp"
        >
          <Icon name="sparkle" size={30} />
        </ActionButton>
      </div>
    </div>
  );
}

/** Hub action button — stacks the icon over a short caption so the
 * affordance reads in one glance. `pressed` turns the button into a
 * toggle (Account uses this — the icon stays the same, the active
 * state is conveyed by `aria-pressed` + a visual highlight). */
function ActionButton({
  onClick,
  disabled,
  label,
  testid,
  pressed,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  testid: string;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  const className = pressed
    ? `${styles.actionButton} ${styles.actionButtonPressed}`
    : styles.actionButton;
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      data-testid={testid}
    >
      <span className={styles.actionIcon}>{children}</span>
      <span className={styles.actionLabel}>{label}</span>
    </button>
  );
}
