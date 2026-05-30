import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocalProfile } from "../../lib/db";
import { Avatar, type AvatarSize } from "../ui/Avatar";
import { Group } from "../ui/Group";
import { Icon } from "../ui/Icon";
import { AvatarUploader } from "./AvatarUploader";
import styles from "./EditableAvatar.module.css";

/**
 * Avatar + pencil edit button that swaps in-place to the
 * `AvatarUploader` when the viewer taps the pencil. Used in the
 * profile detail page (friend's profile) and Settings (the viewer's
 * own self-Profile) — both call sites get the same UX without
 * duplicating the toggle state or the preview/upload composition.
 *
 * The component owns the editing state. The pencil button keeps the
 * `data-testid="profile-edit-avatar"` shipped from the detail page so
 * existing E2E selectors continue to match.
 */
export function EditableAvatar({
  profile,
  viewerId,
  size = "xl",
  canEdit,
}: {
  profile: LocalProfile;
  viewerId: string;
  size?: AvatarSize;
  /** Defaults to "viewer owns the profile". Pass `false` explicitly to
   * force read-only (e.g. a non-owner accidentally landing on the
   * detail page before the route guard redirects). */
  canEdit?: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const editable = canEdit ?? profile.ownerId === viewerId;

  if (editing && editable) {
    return (
      <Group title={t("avatar.title")}>
        <AvatarUploader
          profile={profile}
          viewerId={viewerId}
          onDone={() => setEditing(false)}
        />
      </Group>
    );
  }

  return (
    <div className={styles.preview}>
      <Avatar profile={profile} viewerId={viewerId} size={size} />
      {editable && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={styles.editButton}
          aria-label={t("avatar.edit")}
          data-testid="profile-edit-avatar"
        >
          <Icon name="pencil" size={12} />
        </button>
      )}
    </div>
  );
}
