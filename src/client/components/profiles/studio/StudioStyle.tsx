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
// `treasury` is omitted from the picker — its strong is nearly
// indistinguishable from `commercial` in both themes, so showing it
// makes the picker wrap onto a second row on narrow viewports for no
// visual gain. The avatar component still accepts `treasury` if some
// other surface ever wants to surface it programmatically.
const RINGS: Exclude<AvatarRing, null>[] = [
  "civil",
  "scientific",
  "commercial",
  "guilds",
  "wonders",
  "progress",
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

  // No previewProfile synthesis any more — instead we pass the
  // override straight through Avatar's `imageUrlOverride` prop, which
  // bypasses the viewer-aware resolver entirely. The old "synthesise
  // a profile-shaped object with customAvatarUrl=override" trick was
  // defeated by `useOwnedProfileIndex` looking the viewer up by id /
  // linkedUserId and pulling their CURRENT customAvatarUrl from
  // Dexie — so the override was silently overridden.

  return (
    <div className={styles.root} data-testid="studio-style">
      <p className={shared.eyebrow}>{t("studio.style.heading")}</p>

      <div className={styles.previewWrap}>
        <Avatar
          profile={profile}
          viewerId={viewerId}
          size="xl"
          frame={frame}
          ring={ring}
          // `imageUrlOverride` wins over the resolver — `undefined`
          // means "use the resolver's normal output" (the profile's
          // current photo); a string forces the just-baked blob.
          imageUrlOverride={previewOverrideUrl ?? undefined}
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
