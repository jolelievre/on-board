import { useEffect, useState } from "react";
import type { AvatarFrame, AvatarRing, LocalProfile } from "../../lib/db";
import {
  displayProfileAvatar,
  displayProfileName,
  displayProfileStyle,
} from "../../../shared/players";
import { useOwnedProfileIndex } from "../../hooks/data/useOwnedProfileIndex";
import { WinnerBadge } from "./WinnerBadge";
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

// Winner-badge size per avatar size variant. Roughly 40–45% of the
// avatar diameter so the crown reads at a glance without dominating
// the face. Custom CSS overrides of `--avatar-size` don't auto-scale
// the badge — callers who do that get the variant's badge size.
const BADGE_SIZE: Record<AvatarSize, number> = {
  sm: 14,
  md: 18,
  lg: 28,
  xl: 36,
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
  /** When true, overlays the gold `WinnerBadge` on the top-right of
   * the avatar. Reusable everywhere a winner / live leader needs the
   * crown — match history rows, scorer headers, winner banners,
   * skull-king standings. Sized automatically from the `size`
   * variant. */
  winner?: boolean;
  /** Bypass the resolver entirely and render this URL as the avatar
   * photo. `null` forces the initial-letter fallback; `undefined`
   * (default) routes through `displayProfileAvatar`. Used by the
   * studio's Style preview to show a freshly-captured blob that
   * isn't in Dexie yet — the viewer-aware resolver would otherwise
   * pick up the viewer's existing self-profile URL. */
  imageUrlOverride?: string | null;
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
  /** The viewer for resolution. The Avatar consults the
   * `useOwnedProfileIndex` hook to identify rows that point at the
   * viewer (via id or `linkedUserId`) and resolves through the
   * viewer's own profile instead of the embedded snapshot — keeping
   * the viewer's custom upload visible even on friend-created matches. */
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
 * Reusable avatar. Two-element structure: an outer `.root` (layout +
 * positioning context, no clipping) and an inner `.photoFrame`
 * (clipping, frame radius, colour ring, bucket bg). The outer keeps
 * `overflow: visible` so the optional `WinnerBadge` overlay can stick
 * out past the avatar's circular edge without being clipped.
 *
 * Phase 7 + feedback rounds:
 *   - `frame` / `ring` props drive stamp styling.
 *   - `winner` prop overlays the gold crown badge in the top-right.
 *   - `displayProfileAvatar` + `useOwnedProfileIndex` route every
 *     URL resolution through the viewer's owned-profile index, so
 *     the viewer always sees their own custom upload even on
 *     friend-created matches.
 *   - `<img onError>` falls back to the initial-letter chip when a
 *     stale URL (e.g. file lost across preview deploys) 404s,
 *     instead of showing the browser's broken-image icon.
 */
export function Avatar(props: Props) {
  const size: AvatarSize = props.size ?? "md";
  const sizeClass = SIZE_CLASS[size];

  // Hook is called unconditionally so the rules-of-hooks stay happy
  // across both render branches. Pass null when this Avatar isn't a
  // profile-source — the hook short-circuits to the empty index.
  const viewerForIndex =
    "profile" in props ? (props.viewerId ?? null) : null;
  const ownedIndex = useOwnedProfileIndex(viewerForIndex);

  // Stamp style (frame + ring): explicit props win; otherwise route
  // through `displayProfileStyle`, which mirrors the name/avatar
  // resolvers — owned-profile match (by id or linkedUserId) overrides
  // the embedded snapshot, so the viewer's own stamp wins on
  // friend-created matches.
  const style: { avatarFrame: string; avatarRing: string | null } =
    "profile" in props
      ? displayProfileStyle(props.profile, ownedIndex)
      : { avatarFrame: "circle", avatarRing: null };
  const frame: AvatarFrame =
    props.frame ?? (style.avatarFrame as AvatarFrame) ?? "circle";
  const ring: AvatarRing =
    props.ring !== undefined ? props.ring : (style.avatarRing as AvatarRing);

  const frameClass = FRAME_CLASS[frame];
  const ringClass = ring ? `${styles.hasRing} ${RING_CLASS[ring]}` : "";

  // Resolved URL changes when props change OR when the viewer's owned
  // profiles refresh (e.g. they upload a new photo). `imageUrlOverride`
  // wins outright when set — that's how the studio's preview shows a
  // brand-new blob that the ownedIndex resolver doesn't know about
  // yet. The onError fallback below also feeds back into this state
  // by clearing the URL.
  const resolvedUrl =
    props.imageUrlOverride !== undefined
      ? props.imageUrlOverride
      : "profile" in props
        ? displayProfileAvatar(props.profile, ownedIndex)
        : null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // When the resolved URL changes, clear any stale "this URL failed"
  // memo so the new URL gets a fresh chance.
  useEffect(() => {
    if (resolvedUrl !== failedUrl) setFailedUrl(null);
    // We deliberately track only `resolvedUrl` — `failedUrl` updates
    // inside this effect would otherwise loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedUrl]);
  const showImage = resolvedUrl !== null && resolvedUrl !== failedUrl;

  // Outer root carries layout / size / custom CSS overrides
  // (`--avatar-size`, `--ring-color`, `meRing` etc.). All decoration
  // sits on the inner photoFrame so the WinnerBadge can overhang
  // without being clipped.
  const rootClass = [styles.root, sizeClass, props.className]
    .filter(Boolean)
    .join(" ");

  const renderBadge = props.winner ? (
    <WinnerBadge overlay size={BADGE_SIZE[size]} />
  ) : null;

  if ("profile" in props) {
    const { profile } = props;
    const name = displayProfileName(profile, ownedIndex);
    const initial = initialFromName(name);
    const bucket = BUCKETS[hashBucket(profile.id) % BUCKETS.length];
    const frameInnerClass = [styles.photoFrame, bucket, frameClass, ringClass]
      .filter(Boolean)
      .join(" ");

    return (
      <span className={rootClass} role="img" aria-label={name}>
        <span className={frameInnerClass}>
          {showImage && resolvedUrl ? (
            <img
              className={styles.img}
              src={resolvedUrl}
              alt=""
              // Referrer hides the user's auth host from external avatar
              // providers; Google's hosted photos accept this fine.
              referrerPolicy="no-referrer"
              onError={() => setFailedUrl(resolvedUrl)}
            />
          ) : (
            initial
          )}
        </span>
        {renderBadge}
      </span>
    );
  }

  const { alias, hashKey } = props;
  const initial = initialFromName(alias);
  const bucket = BUCKETS[hashBucket(hashKey ?? alias) % BUCKETS.length];
  const frameInnerClass = [styles.photoFrame, bucket, frameClass, ringClass]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={rootClass} role="img" aria-label={alias}>
      <span className={frameInnerClass}>{initial}</span>
      {renderBadge}
    </span>
  );
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
