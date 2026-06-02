import { Avatar } from "../Avatar";
import type { LocalPlayerProfile, LocalProfile } from "../../../lib/db";
import styles from "./DealerChip.module.css";

type DealerProfile = Pick<
  LocalProfile,
  | "id"
  | "ownerId"
  | "alias"
  | "linkedUserId"
  | "customAvatarUrl"
  | "useLinkedAvatar"
  | "avatarFrame"
  | "avatarRing"
  | "linkedUser"
>;

type Props = {
  profile: DealerProfile | LocalPlayerProfile;
  /** The viewer for avatar resolution — required `string`, see `Avatar`
   * viewer-aware logic. */
  viewerId: string;
  /** Label shown next to the avatar. Defaults to "{alias} deals" when
   * omitted. Pass an explicit string when the caller wants to localize
   * the verb. */
  label?: string;
};

/**
 * Phase 7 — dealer chip for the Skull King round-transition screen.
 * Pill-shaped: dealer's `<Avatar>` (lg) + the "X deals" label. The
 * earlier small "cards" glyph anchored to the avatar was removed in
 * the feedback round — it read as visual clutter on top of the photo.
 */
export function DealerChip({ profile, viewerId, label }: Props) {
  const text = label ?? `${profile.alias} deals`;
  return (
    <span className={styles.root}>
      <Avatar profile={profile} viewerId={viewerId} size="lg" />
      <span className={styles.label}>{text}</span>
    </span>
  );
}
