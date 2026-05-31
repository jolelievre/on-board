import type { AvatarFrame, AvatarRing, LocalProfile } from "../../lib/db";
import { displayProfileName } from "../../../shared/players";
import { useOwnedProfileIndex } from "../../hooks/data/useOwnedProfileIndex";
import styles from "./Avatar.module.css";

const BUCKETS = [
  styles.bucket0,
  styles.bucket1,
  styles.bucket2,
  styles.bucket3,
  styles.bucket4,
  styles.bucket5,
  styles.bucket6,
  styles.bucket7,
];

const SIZE_CLASS: Record<AvatarSize, string> = {
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
  xl: styles.xl,
};

// Phase 7: per-frame border-radius. Percentages scale with `--avatar-size`
// so the same class works for every size. Tag uses asymmetric corners for
// the scrapbook look from the design handoff.
const FRAME_CLASS: Record<AvatarFrame, string> = {
  circle: styles.frameCircle,
  rounded: styles.frameRounded,
  tag: styles.frameTag,
};

// Phase 7: ring colour swatches. Each key maps to a `--color-cat-*-strong`
// CSS variable so the ring re-themes between Parchment and Candlelit. Null
// = no ring (the default).
const RING_CLASS: Record<Exclude<AvatarRing, null>, string> = {
  civil: styles.ringCivil,
  scientific: styles.ringScientific,
  commercial: styles.ringCommercial,
  guilds: styles.ringGuilds,
  wonders: styles.ringWonders,
  progress: styles.ringProgress,
  treasury: styles.ringTreasury,
  military: styles.ringMilitary,
};

export type AvatarSize = "sm" | "md" | "lg" | "xl";

type CommonProps = {
  size?: AvatarSize;
  className?: string;
  /** Stamp frame override. When omitted, falls back to `profile.avatarFrame`
   * (for ProfileSource) or "circle" (for FallbackSource). */
  frame?: AvatarFrame;
  /** Stamp colour-ring override. When omitted, falls back to
   * `profile.avatarRing` (for ProfileSource) or null (for FallbackSource).
   * Pass null explicitly to suppress a ring even when the profile has one
   * (used by the studio's "off" swatch preview). */
  ring?: AvatarRing;
};

type ProfileSource = {
  profile: Pick<
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
  /** The viewer for resolution: a linked user looking at their own
   * profile sees their own canonical avatar; an owner sees either the
   * friend's photo or their custom upload depending on `useLinkedAvatar`. */
  viewerId?: string | null;
};

type FallbackSource = {
  /** Use when no Profile row exists — e.g. legacy cached Player.name
   * or a brand-new entry being typed in the new-match form. */
  alias: string;
  /** Optional stable hash key for the colour bucket. Defaults to the
   * alias when omitted, so the same name always gets the same colour. */
  hashKey?: string;
};

type Props = CommonProps & (ProfileSource | FallbackSource);

/**
 * Reusable avatar. Renders a profile photo (custom upload or linked Google
 * photo) or an initial-letter fallback in a deterministic colour bucket.
 *
 * Phase 7 adds **stamp** styling on top: a `frame` (circle | rounded | tag)
 * and a `ring` (one of 8 7WD category colours, or null). Defaults read
 * from `profile.avatarFrame` / `profile.avatarRing` so every consumer
 * picks up the owner-chosen stamp without threading the props manually.
 *
 * Resolution order for an owner viewing a profile:
 *   1. `customAvatarUrl` is set AND `useLinkedAvatar` is false → use it
 *   2. profile is linked AND `useLinkedAvatar` is true →
 *      `linkedUser.avatarUrl`
 *   3. profile has a `customAvatarUrl` anyway → use it (fallback for
 *      unclaimed profiles)
 *   4. initial-letter chip in a deterministic colour
 *
 * When the viewer is the linked user themselves, always use the linked
 * user's own canonical avatar — owners can never override what someone
 * sees of themselves.
 */
export function Avatar(props: Props) {
  const size: AvatarSize = props.size ?? "md";
  const sizeClass = SIZE_CLASS[size];

  // Frame: explicit prop wins; otherwise read from the profile when
  // available; else circle. Cover legacy/undefined values defensively.
  const frame: AvatarFrame =
    props.frame ??
    ("profile" in props ? (props.profile.avatarFrame ?? "circle") : "circle");
  // Ring: distinguish "no prop" from "explicit null" so a caller can
  // suppress the profile's ring on a preview.
  const ring: AvatarRing =
    props.ring !== undefined
      ? props.ring
      : "profile" in props
        ? (props.profile.avatarRing ?? null)
        : null;

  const frameClass = FRAME_CLASS[frame];
  const ringClass = ring ? `${styles.hasRing} ${RING_CLASS[ring]}` : "";

  const className = [
    styles.root,
    sizeClass,
    frameClass,
    ringClass,
    props.className,
  ]
    .filter(Boolean)
    .join(" ");

  // Hook is called unconditionally so the rules-of-hooks stay happy
  // across both render branches. Pass undefined when this Avatar isn't
  // a profile-source — the hook short-circuits to the empty index.
  const viewerForIndex = "profile" in props ? props.viewerId : undefined;
  const ownedIndex = useOwnedProfileIndex(viewerForIndex ?? undefined);

  if ("profile" in props) {
    const { profile, viewerId } = props;
    const resolved = resolveAvatarUrl(profile, viewerId);
    const name = displayProfileName(profile, ownedIndex);
    const initial = initialFromName(name);
    const bucket = BUCKETS[hashBucket(profile.id) % BUCKETS.length];

    if (resolved) {
      return (
        <span
          className={`${className} ${bucket}`}
          role="img"
          aria-label={name}
        >
          <img
            className={styles.img}
            src={resolved}
            alt=""
            // Referrer hides the user's auth host from external avatar
            // providers; Google's hosted photos accept this fine.
            referrerPolicy="no-referrer"
          />
        </span>
      );
    }

    return (
      <span
        className={`${className} ${bucket}`}
        role="img"
        aria-label={name}
      >
        {initial}
      </span>
    );
  }

  const { alias, hashKey } = props;
  const initial = initialFromName(alias);
  const bucket = BUCKETS[hashBucket(hashKey ?? alias) % BUCKETS.length];
  return (
    <span
      className={`${className} ${bucket}`}
      role="img"
      aria-label={alias}
    >
      {initial}
    </span>
  );
}

function resolveAvatarUrl(
  profile: ProfileSource["profile"],
  viewerId: string | null | undefined,
): string | null {
  // Friend-linked protection: if I'm viewing a profile linked to ME
  // but owned by *someone else* (e.g. a friend created a profile for
  // me and linked it to my account), they don't get to customise what
  // I see — always show my own canonical avatar to me.
  //
  // The self-profile case (`ownerId === linkedUserId === viewerId`)
  // is *not* protected: I'm both the owner and the linked user, so
  // toggling `useLinkedAvatar` off + uploading a custom photo must
  // override the canonical Google one. Without the `ownerId !==
  // viewerId` guard below, self-profile uploads would silently fall
  // back to the Google photo on the owner's own device.
  if (
    profile.linkedUserId &&
    viewerId &&
    profile.linkedUserId === viewerId &&
    profile.ownerId !== viewerId
  ) {
    return profile.linkedUser?.avatarUrl ?? null;
  }
  // Owner-side (incl. self-profile): explicit override wins when
  // `useLinkedAvatar` is false.
  if (!profile.useLinkedAvatar && profile.customAvatarUrl) {
    return profile.customAvatarUrl;
  }
  // Linked + opt-in to the linked user's photo.
  if (profile.linkedUserId && profile.useLinkedAvatar) {
    return profile.linkedUser?.avatarUrl ?? profile.customAvatarUrl ?? null;
  }
  // Unclaimed with a custom upload.
  return profile.customAvatarUrl ?? null;
}

function initialFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "·";
  // Grab the first codepoint so emoji / accented characters survive.
  return [...trimmed][0]!.toUpperCase();
}

/** Simple deterministic 32-bit-ish hash. Stable across reloads, good
 * enough to spread 8 buckets fairly across a few dozen profiles. */
function hashBucket(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
