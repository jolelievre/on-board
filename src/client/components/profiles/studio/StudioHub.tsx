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
};

/**
 * Phase 7 (revised) — Capture Studio Hub. Compact layout: large stamp
 * preview at the top with a pencil overlay that opens the Style screen,
 * plus a 2-column grid of icon buttons for source actions.
 *
 * Buttons rendered (in order):
 *   1. **Camera** — always available
 *   2. **Gallery** — always available
 *   3. **Online account photo** — when the profile is linked (uses the
 *      generic `globe` icon so the affordance generalizes to other
 *      providers in the future). Switches `useLinkedAvatar = true`.
 *   4. **Monogram letter** — when a custom photo exists (renders the
 *      alias's first letter inside the button so the result is obvious
 *      at a glance). Clears the photo + sets `useLinkedAvatar = false`
 *      so the Avatar falls back to the initial-letter chip.
 *
 * The earlier stacked action rows + "Use friend's photo" toggle row are
 * gone — the online-account button is the new affordance for the same
 * state change, and the layout footprint shrinks accordingly.
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

  const hasCustomPhoto = Boolean(profile.customAvatarUrl);
  const hasLinkedAccount =
    profile.linkedUserId !== null && profile.linkedUser !== null;
  // The monogram fallback is the initial-letter chip — show only when
  // a custom photo exists (the user has something to clear).
  const showMonogramButton = hasCustomPhoto;
  // The "use account photo" affordance only makes sense when the
  // profile is linked (and not already preferring the linked photo).
  const showAccountButton = hasLinkedAccount && !profile.useLinkedAvatar;

  // Monogram preview char — mirrors the initial-letter fallback drawn
  // by `<Avatar>` so the button literally shows what choosing it will
  // produce. Defensive fallback for an empty alias keeps render safe.
  const initial = (profile.alias.trim()[0] ?? "?").toUpperCase();

  const handleUseLinkedAvatar = () => {
    void patchProfile({ profileId: profile.id, useLinkedAvatar: true });
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={shared.eyebrow}>{t("studio.eyebrow")}</span>
      </header>

      <div className={styles.previewBlock}>
        <span className={styles.previewWrap}>
          <Avatar
            profile={profile}
            viewerId={viewerId}
            size="lg"
            frame={previewFrame}
            ring={previewRing}
            className={styles.preview}
          />
          {/* Sparkle overlay — opens the Style screen. Sparkle (not
              pencil) per the design handoff; pencil is reserved for
              the EditableAvatar "enter edit mode" affordance one
              level up. The Style screen lets the user adjust the
              frame/ring of the initial-letter fallback too. */}
          <button
            type="button"
            className={styles.styleEdit}
            onClick={onStyleStamp}
            disabled={isSubmitting}
            aria-label={t("studio.styleStamp.title")}
            data-testid="studio-style-stamp"
          >
            <Icon name="sparkle" size={16} />
          </button>
        </span>
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

        {showAccountButton && (
          <ActionButton
            onClick={handleUseLinkedAvatar}
            disabled={isSubmitting}
            label={t("studio.useAccount.title")}
            testid="studio-use-account"
          >
            <Icon name="globe" size={30} />
          </ActionButton>
        )}

        {showMonogramButton && (
          <ActionButton
            onClick={onClearPhoto}
            disabled={isSubmitting}
            label={t("studio.useMonogram.title")}
            testid="studio-clear-photo"
          >
            <span className={styles.monogramGlyph} aria-hidden="true">
              {initial}
            </span>
          </ActionButton>
        )}
      </div>
    </div>
  );
}

/** Hub action button — stacks the icon over a short caption so the
 * affordance reads in one glance. The accessible label and tooltip
 * mirror the visible caption. */
function ActionButton({
  onClick,
  disabled,
  label,
  testid,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  testid: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.actionButton}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-testid={testid}
    >
      <span className={styles.actionIcon}>{children}</span>
      <span className={styles.actionLabel}>{label}</span>
    </button>
  );
}
