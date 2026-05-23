import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocalProfile3 } from "../../lib/db";
import { useCamera, type CameraErrorKey } from "../../hooks/useCamera";
import { uploadAvatar, clearCustomAvatar } from "../../lib/mutations";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import styles from "./AvatarUploader.module.css";

type Mode = "idle" | "camera" | "preview";

/**
 * Owner-side avatar uploader. Two paths, both end in
 * `uploadAvatar({ file })` → server sharp pipeline → Dexie mirror:
 *
 *   1. **Camera capture** — `useCamera` starts a 1024×1024 stream,
 *      `capture()` returns a centre-cropped JPEG Blob.
 *   2. **Gallery upload** — `<input type="file" accept="image/*">`.
 *
 * Shows a clear-button when the profile already has a custom upload
 * (calls DELETE /avatar). The "use linked friend's photo" toggle isn't
 * here — it lives on the ProfileEditor since it's a Profile-row flag,
 * not part of the upload flow.
 */
export function AvatarUploader({
  profile,
  viewerId,
}: {
  profile: LocalProfile3;
  viewerId: string;
}) {
  const { t } = useTranslation();
  const camera = useCamera();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Stop the camera when the component unmounts or the user picks the
  // gallery path mid-stream — keeps the LED off.
  useEffect(() => {
    return () => camera.stop();
    // camera.stop is stable through the hook's useCallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartCamera = async () => {
    setUploadError(null);
    setMode("camera");
    await camera.start();
  };

  const handleCapture = () => {
    const blob = camera.capture();
    if (!blob) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewBlob(blob);
    setPreviewUrl(URL.createObjectURL(blob));
    camera.stop();
    setMode("preview");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewBlob(file);
    setPreviewUrl(URL.createObjectURL(file));
    camera.stop();
    setMode("preview");
  };

  const handleRetake = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewBlob(null);
    setPreviewUrl(null);
    setMode("idle");
  };

  const handleConfirm = async () => {
    if (!previewBlob) return;
    setUploadError(null);
    setSubmitting(true);
    try {
      await uploadAvatar({ profileId: profile.id, file: previewBlob });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewBlob(null);
      setPreviewUrl(null);
      setMode("idle");
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : t("avatar.uploadFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClear = async () => {
    setUploadError(null);
    setSubmitting(true);
    try {
      await clearCustomAvatar({ profileId: profile.id });
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : t("avatar.clearFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const cameraErrorMessage = camera.error
    ? t(`avatar.cameraError.${camera.error}` as const)
    : null;

  return (
    <div className={styles.root} data-testid="avatar-uploader">
      <canvas ref={camera.canvasRef} className={styles.canvas} />

      <div className={styles.preview}>
        {mode === "camera" ? (
          <video
            ref={camera.videoRef}
            autoPlay
            playsInline
            muted
            className={styles.video}
          />
        ) : mode === "preview" && previewUrl ? (
          <img src={previewUrl} alt="" className={styles.previewImage} />
        ) : (
          <Avatar profile={profile} viewerId={viewerId} size="lg" />
        )}
      </div>

      {cameraErrorMessage && (
        <p className={styles.error}>{cameraErrorMessage}</p>
      )}
      {uploadError && <p className={styles.error}>{uploadError}</p>}

      {mode === "camera" && (
        <div className={styles.captureBar}>
          {camera.canFlip && (
            <button
              type="button"
              onClick={() => void camera.flip()}
              className={styles.iconButton}
              aria-label={t("avatar.flipCamera")}
              data-testid="avatar-camera-flip"
            >
              <Icon name="refresh" size={18} />
            </button>
          )}
          <button
            type="button"
            onClick={handleCapture}
            disabled={!camera.isReady}
            className={styles.captureButton}
            aria-label={t("avatar.capture")}
            data-testid="avatar-camera-capture"
          >
            <Icon name="camera" size={22} />
          </button>
          <button
            type="button"
            onClick={() => {
              camera.stop();
              setMode("idle");
            }}
            className={styles.iconButton}
            aria-label={t("common.cancel")}
            data-testid="avatar-camera-cancel"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
      )}

      {mode === "preview" && (
        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            onClick={handleRetake}
            disabled={submitting}
            data-testid="avatar-retake"
          >
            {t("avatar.retake")}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirm}
            disabled={submitting}
            data-testid="avatar-confirm"
          >
            {submitting ? t("common.saving") : t("avatar.confirm")}
          </Button>
        </div>
      )}

      {mode === "idle" && (
        <div className={styles.actions}>
          <Button
            type="button"
            variant="primary"
            onClick={() => void handleStartCamera()}
            disabled={submitting}
            iconBefore={<Icon name="camera" size={16} />}
            data-testid="avatar-open-camera"
          >
            {t("avatar.takePhoto")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={submitting}
            iconBefore={<Icon name="image" size={16} />}
            data-testid="avatar-pick-file"
          >
            {t("avatar.chooseFile")}
          </Button>
          {profile.customAvatarUrl && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => void handleClear()}
              disabled={submitting}
              data-testid="avatar-clear"
            >
              {t("avatar.clear")}
            </Button>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className={styles.fileInput}
        data-testid="avatar-file-input"
      />
    </div>
  );
}

// Re-export the error key type so consumers needing translations can
// resolve them via the same string union.
export type { CameraErrorKey };
