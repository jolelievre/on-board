import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useCamera } from "../../../hooks/useCamera";
import { Icon } from "../../ui/Icon";
import { Pill } from "../../ui/Pill";
import shared from "./Studio.module.css";
import styles from "./StudioCamera.module.css";

type Props = {
  /** Determines initial facing mode: front-facing for a self-portrait,
   * rear-facing for someone you're aiming the phone at. */
  isSelf: boolean;
  onCapture: (blob: Blob) => void;
  /** Hand off to the gallery flow (used as a graceful fallback when the
   * camera errors out). */
  onPickFromGallery: () => void;
  onCancel: () => void;
};

/**
 * Phase 7 — Capture Studio camera screen. Full-bleed live feed with a
 * warm-ink scrim and a circular cut-out window so it's WYSIWYG with
 * the final circular crop. The shutter writes a square JPEG from the
 * full video frame (we do *not* centre-crop here — reposition handles
 * the framing), then hands off to the parent.
 */
export function StudioCamera({
  isSelf,
  onCapture,
  onPickFromGallery,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const camera = useCamera({
    initialFacingMode: isSelf ? "user" : "environment",
  });

  // Auto-start on mount. The component is only reached after a user
  // gesture (Hub action row click), so the browser permission gate is
  // already in a valid call context.
  useEffect(() => {
    void camera.start();
    return () => camera.stop();
    // camera.start / stop are stable through the hook's useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleShutter = () => {
    const video = camera.videoRef.current;
    const canvas = camera.canvasRef.current;
    if (!video || !canvas) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    // Capture the full video frame as a square: short side defines
    // the square, the long side is centre-cropped to keep the
    // composition the user sees in the live preview. Reposition will
    // crop further if the user wants a tighter framing.
    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;

    // Un-mirror front-camera captures so the saved photo isn't
    // horizontally flipped. The preview is mirrored for natural
    // self-framing; the file is not.
    if (camera.facingMode === "user") {
      ctx.save();
      ctx.translate(size, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
      ctx.restore();
    } else {
      ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    }

    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob);
      },
      "image/jpeg",
      0.92,
    );
  };

  const errorKey = camera.error;
  const errorMessage = errorKey
    ? t(`avatar.cameraError.${errorKey}` as const)
    : null;

  return (
    <div className={styles.root} data-testid="studio-camera">
      <div className={styles.topBar}>
        <button
          type="button"
          onClick={onCancel}
          className={styles.topButton}
          aria-label={t("common.cancel")}
          data-testid="studio-camera-cancel"
        >
          <Icon name="x" size={18} />
        </button>
        <Pill tone="muted">
          {camera.facingMode === "user"
            ? t("studio.camera.selfie")
            : t("studio.camera.rear")}
        </Pill>
      </div>

      <div className={styles.stage}>
        <video
          ref={camera.videoRef}
          autoPlay
          playsInline
          muted
          className={`${styles.video} ${
            camera.facingMode === "user" ? styles.videoMirrored : ""
          }`}
        />
        {/* Warm-ink scrim with a circular cut-out — uses CSS mask so the
         * single overlay handles both the darkening and the framing
         * window in one element. The dashed ring is drawn on top. */}
        <span className={styles.scrim} aria-hidden="true" />
        <span className={styles.framingRing} aria-hidden="true" />

        {!camera.isReady && !errorMessage && (
          <p className={styles.statusLabel}>{t("studio.camera.starting")}</p>
        )}
        {errorMessage && (
          <p className={styles.errorLabel}>
            {t("studio.camera.unavailable")}
          </p>
        )}
        {camera.isReady && !errorMessage && (
          <p className={styles.hintLabel}>{t("studio.camera.hint")}</p>
        )}
      </div>

      <canvas ref={camera.canvasRef} className={shared.fileInput} />

      <div className={styles.controlsRow}>
        <button
          type="button"
          onClick={onPickFromGallery}
          className={styles.roundButton}
          aria-label={t("studio.camera.gallery")}
          data-testid="studio-camera-gallery"
        >
          <Icon name="image" size={20} />
          <span className={styles.roundLabel}>
            {t("studio.camera.gallery")}
          </span>
        </button>

        {!errorMessage && (
          <button
            type="button"
            onClick={handleShutter}
            disabled={!camera.isReady}
            className={styles.shutter}
            aria-label={t("studio.camera.shutter")}
            data-testid="studio-camera-shutter"
          >
            <span className={styles.shutterCore} aria-hidden="true" />
          </button>
        )}

        {camera.canFlip && !errorMessage ? (
          <button
            type="button"
            onClick={() => void camera.flip()}
            className={styles.roundButton}
            aria-label={t("studio.camera.flip")}
            data-testid="studio-camera-flip"
          >
            <Icon name="refresh" size={20} />
            <span className={styles.roundLabel}>
              {t("studio.camera.flip")}
            </span>
          </button>
        ) : (
          // Keep the layout symmetric when flip isn't available.
          <span className={styles.controlSpacer} aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
