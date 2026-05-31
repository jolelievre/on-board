import { useTranslation } from "react-i18next";
import type {
  AvatarFrame,
  AvatarRing,
  LocalProfile,
} from "../../../lib/db";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import styles from "./StudioSaved.module.css";

type Props = {
  profile: LocalProfile;
  viewerId: string;
  frame: AvatarFrame;
  ring: AvatarRing;
  onEditAgain: () => void;
  onDone: () => void;
};

/**
 * Phase 7 — success state shown after the user saves their stamp.
 * Confirms the stamp at glance + lets them edit again (back to hub)
 * or close the studio.
 */
export function StudioSaved({
  profile,
  viewerId,
  frame,
  ring,
  onEditAgain,
  onDone,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className={styles.root} data-testid="studio-saved">
      <Avatar
        profile={profile}
        viewerId={viewerId}
        size="xl"
        frame={frame}
        ring={ring}
        className={styles.preview}
      />
      <p className={styles.heading}>
        <Icon name="check" size={20} />
        {t("studio.saved.title")}
      </p>
      <div className={styles.actions}>
        <Button
          type="button"
          variant="ghost"
          onClick={onEditAgain}
          data-testid="studio-saved-edit-again"
        >
          {t("studio.saved.editAgain")}
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={onDone}
          data-testid="studio-saved-done"
        >
          {t("studio.saved.done")}
        </Button>
      </div>
    </div>
  );
}
