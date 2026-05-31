import { Avatar } from "../Avatar";
import { Icon } from "../Icon";
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
  /** The viewer for avatar resolution — see `Avatar` viewer-aware logic. */
  viewerId?: string | null;
  /** Label shown next to the avatar. Defaults to "{alias} deals" when omitted.
   * Pass an explicit string when the caller wants to localize the verb. */
  label?: string;
};

/**
 * Phase 7 — dealer chip for the Skull King round-transition screen.
 * A pill-shaped composition: dealer's `<Avatar>` (with a small cards
 * glyph in the bottom-right) + the "X deals" label. Lives in the
 * shared `sk/` primitives folder alongside `DigitGrid` and `SkGlyphs`.
 *
 * Only consumed by `RoundTransitionScreen`. Pulled out into its own
 * component so the dealer markup doesn't bulk up the transition
 * screen's body and so other SK surfaces can re-use it later (e.g.
 * MatchStartScreen could highlight the first dealer with the same chip).
 */
export function DealerChip({ profile, viewerId, label }: Props) {
  const alias = profile.alias;
  // Default label uses the alias verbatim — the parent should pass a
  // localized string when the visible text matters (i18n). We keep the
  // fallback to avoid forcing callers in dev paths to thread a label.
  const text = label ?? `${alias} deals`;
  return (
    <span className={styles.root}>
      <span className={styles.avatarWrap}>
        <Avatar profile={profile} viewerId={viewerId} size="md" />
        <span className={styles.cardsBadge} aria-hidden="true">
          <Icon name="cards" size={14} />
        </span>
      </span>
      <span className={styles.label}>{text}</span>
    </span>
  );
}
