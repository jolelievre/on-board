import { useTranslation } from "react-i18next";
import type {
  AvatarFrame,
  AvatarRing,
  LocalProfile,
} from "../../../lib/db";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import shared from "./Studio.module.css";
import styles from "./StudioStyle.module.css";

const FRAMES: AvatarFrame[] = ["circle", "rounded", "tag"];
const RINGS: Exclude<AvatarRing, null>[] = [
  "civil",
  "scientific",
  "commercial",
  "guilds",
  "wonders",
  "progress",
  "treasury",
  "military",
];

type Props = {
  profile: LocalProfile;
  viewerId: string;
  /** Overrides the profile's resolved photo for the live preview. Set
   * after a Camera→Reposition path so the preview shows the new crop
   * even before it's uploaded. */
  previewOverrideUrl: string | null;
  frame: AvatarFrame;
  ring: AvatarRing;
  onFrameChange: (next: AvatarFrame) => void;
  onRingChange: (next: AvatarRing) => void;
  isSubmitting: boolean;
  errorMessage: string | null;
  onBack: () => void;
  onSave: () => void;
};

/**
 * Phase 7 — Capture Studio style step. Live stamp preview + frame
 * swatch row + colour-ring swatch row. The user picks the frame +
 * ring; Save uploads any pending photo and patches the profile.
 */
export function StudioStyle({
  profile,
  viewerId,
  previewOverrideUrl,
  frame,
  ring,
  onFrameChange,
  onRingChange,
  isSubmitting,
  errorMessage,
  onBack,
  onSave,
}: Props) {
  const { t } = useTranslation();

  // When previewOverrideUrl is set (new capture pending upload), the
  // <Avatar> still reads from `profile`, so we synthesise a profile-
  // shaped object that points at the override URL. The override always
  // wins over `useLinkedAvatar`, since it's the user's current pick.
  const previewProfile =
    previewOverrideUrl !== null
      ? {
          ...profile,
          customAvatarUrl: previewOverrideUrl,
          useLinkedAvatar: false,
        }
      : profile;

  return (
    <div className={styles.root} data-testid="studio-style">
      <p className={shared.eyebrow}>{t("studio.style.heading")}</p>

      <div className={styles.previewWrap}>
        <Avatar
          profile={previewProfile}
          viewerId={viewerId}
          size="xl"
          frame={frame}
          ring={ring}
          className={styles.preview}
        />
      </div>

      <fieldset className={styles.section}>
        <legend className={styles.sectionLabel}>
          {t("studio.style.frameLabel")}
        </legend>
        <div className={styles.frameRow}>
          {FRAMES.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onFrameChange(f)}
              aria-pressed={frame === f}
              className={`${styles.frameSwatch} ${
                frame === f ? styles.frameSwatchActive : ""
              }`}
              data-testid={`studio-frame-${f}`}
            >
              <span
                className={`${styles.frameShape} ${styles[`frameShape_${f}`] ?? ""}`}
                aria-hidden="true"
              />
              <span className={styles.frameName}>
                {t(`studio.style.frames.${f}`)}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.section}>
        <legend className={styles.sectionLabel}>
          {t("studio.style.ringLabel")}
        </legend>
        <div className={styles.ringRow}>
          <button
            type="button"
            onClick={() => onRingChange(null)}
            aria-pressed={ring === null}
            className={`${styles.ringSwatch} ${styles.ringSwatchOff} ${
              ring === null ? styles.ringSwatchActive : ""
            }`}
            aria-label={t("studio.style.ringOff")}
            data-testid="studio-ring-off"
          />
          {RINGS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRingChange(r)}
              aria-pressed={ring === r}
              className={`${styles.ringSwatch} ${styles[`ring_${r}`] ?? ""} ${
                ring === r ? styles.ringSwatchActive : ""
              }`}
              aria-label={r}
              data-testid={`studio-ring-${r}`}
            />
          ))}
        </div>
      </fieldset>

      {errorMessage && <p className={shared.error}>{errorMessage}</p>}

      <div className={styles.actions}>
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={isSubmitting}
          iconBefore={<Icon name="arrow-left" size={16} />}
          data-testid="studio-style-back"
        >
          {t("studio.style.back")}
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={onSave}
          disabled={isSubmitting}
          data-testid="studio-style-save"
        >
          {isSubmitting
            ? t("studio.style.saving")
            : t("studio.style.save")}
        </Button>
      </div>
    </div>
  );
}
