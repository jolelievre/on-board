import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AvatarFrame, AvatarRing, LocalProfile } from "../../lib/db";
import { type CameraErrorKey } from "../../hooks/useCamera";
import { uploadAvatar, patchProfile } from "../../lib/mutations";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { StudioHub } from "./studio/StudioHub";
import { StudioCamera } from "./studio/StudioCamera";
import { StudioReposition } from "./studio/StudioReposition";
import { StudioStyle } from "./studio/StudioStyle";
import { StudioSaved } from "./studio/StudioSaved";
import studioStyles from "./studio/Studio.module.css";

type Screen = "hub" | "camera" | "reposition" | "style" | "saved";

/**
 * Avatar Capture Studio (Phase 7) — replaces the flat shipped uploader
 * with a small state machine: **Hub → Camera → Reposition → Style →
 * Saved**, plus a gallery shortcut that skips the camera. The studio
 * produces a **stamp**: a square JPEG (baked client-side from the
 * reposition transform) plus a frame + colour-ring choice, persisted
 * in one go on the save action.
 *
 * The public component name is unchanged so `EditableAvatar` and the
 * existing E2E selector (`[data-testid="avatar-uploader"]`) keep
 * matching. Sub-screens live in `./studio/` for clarity.
 *
 * Pass `onDone` to expose a done/close affordance — fires automatically
 * after the user confirms the success step.
 */
export function AvatarUploader({
  profile,
  viewerId,
  onDone,
}: {
  profile: LocalProfile;
  /** Powers the in-line `<Avatar>` preview (so the resolver picks the
   * right photo for the viewer) and decides whether to render the
   * self-profile vs friend-profile copy on the linked-avatar toggle. */
  viewerId: string;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const [screen, setScreen] = useState<Screen>("hub");

  // Raw image picked from camera or gallery — the source for reposition.
  // We hold the object URL so the Reposition view can load it into an
  // `<img>` and the offscreen canvas can read its natural pixels.
  const [rawImageUrl, setRawImageUrl] = useState<string | null>(null);

  // Baked square JPEG after the user confirms the reposition crop.
  // Held until Save uploads it — lets the user wander back to the hub
  // without losing the crop.
  const [bakedBlob, setBakedBlob] = useState<Blob | null>(null);
  const [bakedUrl, setBakedUrl] = useState<string | null>(null);

  // Pending style state. Initialised from the profile so re-entering the
  // studio after a previous save reflects the saved choice. The user's
  // edits live here until Save commits.
  const [pendingFrame, setPendingFrame] = useState<AvatarFrame>(
    profile.avatarFrame,
  );
  const [pendingRing, setPendingRing] = useState<AvatarRing>(profile.avatarRing);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Revoke object URLs on unmount / replacement so the renderer doesn't
  // leak Blob handles when the studio closes mid-flow.
  useEffect(() => {
    return () => {
      if (rawImageUrl) URL.revokeObjectURL(rawImageUrl);
      if (bakedUrl) URL.revokeObjectURL(bakedUrl);
    };
    // We intentionally re-run on URL changes to clean up the prior URL —
    // the cleanup of the previous effect handles the old value.
  }, [rawImageUrl, bakedUrl]);

  const replaceRawImage = useCallback(
    (next: string | null) => {
      setRawImageUrl((prev) => {
        if (prev && prev !== next) URL.revokeObjectURL(prev);
        return next;
      });
    },
    [],
  );

  const replaceBaked = useCallback(
    (blob: Blob | null, url: string | null) => {
      setBakedUrl((prev) => {
        if (prev && prev !== url) URL.revokeObjectURL(prev);
        return url;
      });
      setBakedBlob(blob);
    },
    [],
  );

  // Hub → camera
  const handleOpenCamera = () => {
    setSaveError(null);
    setScreen("camera");
  };

  // Hub → gallery (native file picker)
  const handleOpenGallery = () => {
    setSaveError(null);
    fileInputRef.current?.click();
  };

  const handleGalleryFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const url = URL.createObjectURL(file);
    replaceRawImage(url);
    setScreen("reposition");
  };

  // Camera → reposition (called by StudioCamera with the captured frame)
  const handleCameraCapture = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    replaceRawImage(url);
    setScreen("reposition");
  };

  // Reposition → style (called with the baked square)
  const handleRepositionConfirm = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    replaceBaked(blob, url);
    setScreen("style");
  };

  // Hub → style (no new photo, just edit frame/ring)
  const handleOpenStyle = () => {
    setSaveError(null);
    setScreen("style");
  };

  // Style → save
  const handleSave = async () => {
    setSaveError(null);
    setSubmitting(true);
    try {
      // Upload first (writes customAvatarUrl + flips useLinkedAvatar
      // server-side), then patch frame/ring. Two round-trips so the
      // server returns the canonical row each time and Dexie stays
      // consistent.
      if (bakedBlob) {
        await uploadAvatar({ profileId: profile.id, file: bakedBlob });
      }
      if (
        pendingFrame !== profile.avatarFrame ||
        pendingRing !== profile.avatarRing
      ) {
        await patchProfile({
          profileId: profile.id,
          avatarFrame: pendingFrame,
          avatarRing: pendingRing,
        });
      }
      replaceBaked(null, null);
      setScreen("saved");
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : t("studio.style.saveError"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Universal back / cancel to the hub.
  const backToHub = () => {
    setScreen("hub");
  };

  return (
    <div className={studioStyles.root} data-testid="avatar-uploader">
      {screen === "hub" && (
        <StudioHub
          profile={profile}
          viewerId={viewerId}
          isSubmitting={submitting}
          onNewPhoto={handleOpenCamera}
          onFromGallery={handleOpenGallery}
          onStyleStamp={handleOpenStyle}
          // Pending style state is mirrored into the hub's stamp
          // preview so a user who saved a new ring earlier still sees
          // it on re-enter even before the next pull-sync round-trip.
          previewFrame={pendingFrame}
          previewRing={pendingRing}
        />
      )}

      {screen === "camera" && (
        <StudioCamera
          isSelf={isSelfProfile(profile, viewerId)}
          onCapture={handleCameraCapture}
          onPickFromGallery={handleOpenGallery}
          onCancel={backToHub}
        />
      )}

      {screen === "reposition" && rawImageUrl && (
        <StudioReposition
          imageUrl={rawImageUrl}
          onRetake={() => {
            replaceRawImage(null);
            setScreen("hub");
          }}
          onConfirm={handleRepositionConfirm}
        />
      )}

      {screen === "style" && (
        <StudioStyle
          profile={profile}
          viewerId={viewerId}
          // Preview reflects the pending edits. When the user reached
          // Style after a new capture, `bakedUrl` overrides the
          // profile's current photo in the preview.
          previewOverrideUrl={bakedUrl}
          frame={pendingFrame}
          ring={pendingRing}
          onFrameChange={setPendingFrame}
          onRingChange={setPendingRing}
          isSubmitting={submitting}
          errorMessage={saveError}
          onBack={backToHub}
          onSave={() => void handleSave()}
        />
      )}

      {screen === "saved" && (
        <StudioSaved
          profile={profile}
          viewerId={viewerId}
          frame={pendingFrame}
          ring={pendingRing}
          onEditAgain={() => setScreen("hub")}
          onDone={onDone ?? backToHub}
        />
      )}

      {saveError && screen === "hub" && (
        <p className={studioStyles.error}>{saveError}</p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleGalleryFile}
        className={studioStyles.fileInput}
        data-testid="avatar-file-input"
      />

      {/* The Hub always exposes a Done/Cancel affordance so the studio
          is never a dead-end. When the parent passed `onDone`, this
          delegates to the parent (collapses the editor); otherwise we
          have nowhere to escape to since the studio IS the page — the
          button just disappears in that case. */}
      {screen === "hub" && onDone && (
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={onDone}
          iconBefore={<Icon name="check" size={14} />}
          className={studioStyles.doneButton}
          data-testid="avatar-done"
        >
          {t("common.done")}
        </Button>
      )}
    </div>
  );
}

/** Self-profile semantics: ownerId === linkedUserId === viewerId.
 * Drives the camera's initial facing-mode — selfie for your own
 * photo, rear-facing when you're aiming the phone at a friend. */
function isSelfProfile(profile: LocalProfile, viewerId: string): boolean {
  return (
    profile.linkedUserId !== null &&
    profile.linkedUserId === viewerId &&
    profile.ownerId === viewerId
  );
}

// Re-export so existing consumers (translation lookups) can resolve
// camera-error keys through the same string union.
export type { CameraErrorKey };
