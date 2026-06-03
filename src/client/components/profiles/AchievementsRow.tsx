import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "../ui/Icon";
import { CatGlyph, type CatGlyphId } from "../ui/CatGlyph";
import {
  useAchievements,
  type AchievementKey,
  type AchievementStamp,
} from "../../hooks/data/useAchievements";
import styles from "./AchievementsRow.module.css";

type Props = {
  /** Undefined while the self-Profile id is still resolving (e.g. fresh
   * sign-in waiting on pull-sync). The hook returns `undefined` for
   * that case which renders nothing — the page still mounts the
   * section so the heading slot reserves space. */
  profileId: string | undefined;
  viewerId: string;
  /** Empty-state copy varies by surface — viewer's own stats vs.
   * looking at a friend's profile. Pass the i18n key, or omit to render
   * nothing when no stamps are unlocked yet. */
  emptyMessage?: string;
};

type StampGlyph =
  | { kind: "icon"; name: IconName }
  | { kind: "cat"; id: CatGlyphId };

const GLYPH_BY_KEY: Record<AchievementKey, StampGlyph> = {
  // base v1
  firstWin: { kind: "icon", name: "trophy" },
  tenWins: { kind: "icon", name: "medal" },
  winStreak5: { kind: "icon", name: "flame" },
  biggestBlowout: { kind: "icon", name: "crown" },
  // activity
  veteran: { kind: "icon", name: "shield" },
  marathon: { kind: "icon", name: "history" },
  acrossTheBoard: { kind: "icon", name: "globe" },
  // victory style
  photoFinish: { kind: "icon", name: "sparkle" },
  comebackSK: { kind: "icon", name: "refresh" },
  wireToWireSK: { kind: "icon", name: "flag" },
  // skull king
  sealedLips: { kind: "icon", name: "zero" },
  piratesHaul: { kind: "icon", name: "skull-king" },
  perfectCall: { kind: "icon", name: "cards-check" },
  // 7 wonders duel — reuse the in-game victory glyphs so the stamp
  // reads as the same brand mark the scorer shows on completion.
  scientist: { kind: "cat", id: "scientific-sup" },
  general: { kind: "cat", id: "military-sup" },
  builder: { kind: "icon", name: "home" },
  // social
  roundabout: { kind: "icon", name: "users" },
  sidekick: { kind: "icon", name: "user" },
  theLink: { kind: "icon", name: "link" },
  // streak
  habit: { kind: "icon", name: "calendar-check" },
};

const ICON_TONE_CLASS: Partial<Record<AchievementKey, string>> = {
  winStreak5: styles.iconStreak,
  biggestBlowout: styles.iconBlowout,
  piratesHaul: styles.iconBlowout,
  comebackSK: styles.iconStreak,
  habit: styles.iconStreak,
};

/**
 * Renders the unlocked-achievement stamp grid for a given Profile. Used
 * on both the viewer's "Your stats" page and the friend-profile detail
 * page; the same hook + component handle both because achievements are
 * a function of (profileId, viewerId-visibility) — not a property of
 * the viewer.
 */
export function AchievementsRow({ profileId, viewerId, emptyMessage }: Props) {
  const stamps = useAchievements(profileId, viewerId);
  // Only one stamp is expanded at a time — keeps the grid tidy on
  // narrow viewports where multiple open descriptions would shove
  // other stamps off-screen.
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (stamps === undefined) {
    return null;
  }
  if (stamps.length === 0) {
    if (!emptyMessage) return null;
    return (
      <p className={styles.empty} data-testid="achievements-empty">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className={styles.row} data-testid="achievements-row">
      {stamps.map((stamp) => {
        const key = stampKey(stamp);
        return (
          <Stamp
            key={key}
            stamp={stamp}
            isOpen={openKey === key}
            onToggle={() => setOpenKey((cur) => (cur === key ? null : key))}
          />
        );
      })}
    </div>
  );
}

function stampKey(stamp: AchievementStamp): string {
  return stamp.gameId ? `${stamp.key}:${stamp.gameId}` : stamp.key;
}

function Stamp({
  stamp,
  isOpen,
  onToggle,
}: {
  stamp: AchievementStamp;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { t, i18n } = useTranslation();
  const glyph = GLYPH_BY_KEY[stamp.key];
  const iconClass = [styles.icon, ICON_TONE_CLASS[stamp.key]]
    .filter(Boolean)
    .join(" ");

  const label = t(`achievements.labels.${stamp.key}`);
  const dateLabel = formatUnlockedOn(stamp.unlockedAt, i18n.language);
  const valueText = formatValue(stamp, t);
  const description = t(`achievements.descriptions.${stamp.key}`);

  return (
    <button
      type="button"
      className={`${styles.stamp} ${isOpen ? styles.stampOpen : ""}`}
      data-testid="achievement-stamp"
      data-achievement-key={stamp.key}
      data-achievement-game={stamp.gameId ?? ""}
      aria-expanded={isOpen}
      onClick={onToggle}
    >
      <span className={iconClass} aria-hidden="true">
        {glyph.kind === "icon" ? (
          <Icon name={glyph.name} size={26} />
        ) : (
          <CatGlyph id={glyph.id} size={26} />
        )}
      </span>
      <span className={styles.label}>{label}</span>
      {stamp.detail && (
        <span className={styles.subLabel}>{stamp.detail}</span>
      )}
      {!stamp.detail && stamp.gameName && (
        <span className={styles.subLabel}>{stamp.gameName}</span>
      )}
      {valueText && <span className={styles.value}>{valueText}</span>}
      <span className={styles.unlockedOn}>
        {t("achievements.unlockedOn", { date: dateLabel })}
      </span>
      {isOpen && (
        <span
          className={styles.description}
          data-testid="achievement-description"
        >
          {description}
        </span>
      )}
    </button>
  );
}

function formatValue(
  stamp: AchievementStamp,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  if (stamp.value === undefined) return null;
  switch (stamp.key) {
    case "biggestBlowout":
    case "photoFinish":
      return t("achievements.marginValue", { count: stamp.value });
    case "piratesHaul":
      return t("achievements.pointsValue", { count: stamp.value });
    case "veteran":
    case "marathon":
    case "roundabout":
    case "sidekick":
      return t("achievements.countValue", { count: stamp.value });
    default:
      return null;
  }
}

function formatUnlockedOn(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return iso.slice(0, 10);
  }
}
