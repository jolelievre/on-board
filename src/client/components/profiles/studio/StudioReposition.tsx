import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import shared from "./Studio.module.css";
import styles from "./StudioReposition.module.css";

type Props = {
  imageUrl: string;
  onRetake: () => void;
  onConfirm: (blob: Blob) => void;
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;
/** Output dimension of the baked square JPEG. The server's `sharp`
 * pipeline resizes to 400×400 + 100×100; we feed it a clean 1024 so
 * the downscale stays sharp. */
const OUTPUT_SIZE = 1024;

type Transform = { x: number; y: number; scale: number };

/**
 * Phase 7 — reposition step. The user drags + pinches + uses a slider
 * to frame the photo inside a circular crop window; on confirm we bake
 * the `{x, y, scale}` transform into a square JPEG via an offscreen
 * canvas, then hand the result up to the parent.
 *
 * The image is positioned with `transform: translate(Xpx, Ypx)
 * scale(S)` on top of `object-fit: cover`, so the initial state fills
 * the circle and the user only adjusts from there. The bake math
 * inverts the same transform.
 */
export function StudioReposition({ imageUrl, onRetake, onConfirm }: Props) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [transform, setTransform] = useState<Transform>({
    x: 0,
    y: 0,
    scale: 1,
  });
  const [naturalSize, setNaturalSize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Active pointers (id → display coords). Two simultaneous pointers =
  // pinch zoom; one = pan.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  // Snapshot of distance + scale taken at the start of a pinch so the
  // gesture's scale change is relative, not absolute.
  const pinchBaselineRef = useRef<{
    distance: number;
    scale: number;
  } | null>(null);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  };

  // Pointer Events — covers touch + mouse + pen uniformly. `touch-action:
  // none` on the frame keeps the browser from hijacking the gesture for
  // page scrolling.
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = Array.from(pointersRef.current.values());
      pinchBaselineRef.current = {
        distance: distance(a!, b!),
        scale: transform.scale,
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };

    if (pointers.size === 1) {
      // Drag-pan: apply the delta to the current x/y.
      setTransform((t) => ({
        ...t,
        x: t.x + (next.x - prev.x),
        y: t.y + (next.y - prev.y),
      }));
    } else if (pointers.size === 2 && pinchBaselineRef.current) {
      // Update the pointer position first so the other pointer's lookup
      // (above) is consistent if pointermove arrives interleaved.
      pointers.set(e.pointerId, next);
      const [a, b] = Array.from(pointers.values());
      const dist = distance(a!, b!);
      const { distance: startDist, scale: startScale } =
        pinchBaselineRef.current;
      const nextScale = clamp(
        startScale * (dist / startDist),
        MIN_SCALE,
        MAX_SCALE,
      );
      setTransform((t) => ({ ...t, scale: nextScale }));
      return;
    }
    pointers.set(e.pointerId, next);
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchBaselineRef.current = null;
  };

  // Mouse-wheel zoom for desktop testing. Direction matches macOS
  // pinch convention (deltaY > 0 means content moves away → zoom out).
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setTransform((t) => ({
        ...t,
        scale: clamp(t.scale - e.deltaY * 0.003, MIN_SCALE, MAX_SCALE),
      }));
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, []);

  const handleConfirm = async () => {
    const img = imgRef.current;
    const frame = frameRef.current;
    if (!img || !frame || !naturalSize) return;
    setSubmitting(true);
    try {
      const blob = await bakeCrop(img, frame, naturalSize, transform);
      if (blob) onConfirm(blob);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.root} data-testid="studio-reposition">
      <p className={shared.eyebrow}>{t("studio.reposition.heading")}</p>

      <div
        ref={frameRef}
        className={styles.frame}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <img
          ref={imgRef}
          src={imageUrl}
          alt=""
          className={styles.image}
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
          onLoad={handleImageLoad}
          draggable={false}
        />
        {/* Centre cross guides — faint, decorative; help the user line
         * up the subject's face on the crop centre. */}
        <span className={styles.crossH} aria-hidden="true" />
        <span className={styles.crossV} aria-hidden="true" />
      </div>

      <input
        type="range"
        min={MIN_SCALE}
        max={MAX_SCALE}
        step={0.01}
        value={transform.scale}
        onChange={(e) =>
          setTransform((t) => ({ ...t, scale: Number(e.target.value) }))
        }
        className={styles.zoomSlider}
        aria-label="Zoom"
        data-testid="studio-reposition-zoom"
      />

      <div className={styles.actions}>
        <Button
          type="button"
          variant="ghost"
          onClick={onRetake}
          disabled={submitting}
          iconBefore={<Icon name="refresh" size={16} />}
          data-testid="studio-reposition-retake"
        >
          {t("studio.reposition.retake")}
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => void handleConfirm()}
          disabled={submitting || !naturalSize}
          data-testid="studio-reposition-confirm"
        >
          {t("studio.reposition.confirm")}
        </Button>
      </div>
    </div>
  );
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

/**
 * Inverts the live `{x, y, scale}` transform to compute the source rect
 * in the original image's natural pixel space, then draws the rect into
 * an `OUTPUT_SIZE × OUTPUT_SIZE` offscreen canvas and returns a JPEG.
 *
 * Math: the `<img>` fills the frame with `object-fit: cover`, so 1
 * natural pixel maps to `frameWidth / min(W,H)` display pixels at
 * `scale = 1`; the user's scale multiplies this. Translation moves the
 * image's centre in display pixels, which inverts to natural pixels by
 * dividing by the same per-pixel ratio.
 */
async function bakeCrop(
  img: HTMLImageElement,
  frame: HTMLElement,
  natural: { w: number; h: number },
  t: Transform,
): Promise<Blob | null> {
  const frameBox = frame.getBoundingClientRect();
  const frameSize = frameBox.width;
  const shortSide = Math.min(natural.w, natural.h);
  // displayed pixels per natural pixel, including the user's scale.
  const naturalToDisplay = (frameSize / shortSide) * t.scale;
  // The crop is the frame square, sized in natural pixels.
  const cropNatural = frameSize / naturalToDisplay;
  // Frame centre in natural-pixel coords. The transform's translation
  // shifts the image opposite to the frame: a positive `x` moves the
  // image right, so we see *more of the left*, i.e. the centre maps to
  // a smaller `sx`.
  const cx = natural.w / 2 - t.x / naturalToDisplay;
  const cy = natural.h / 2 - t.y / naturalToDisplay;
  const sx = cx - cropNatural / 2;
  const sy = cy - cropNatural / 2;

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // Defensive: clamp to the image extents so a transform that pushed the
  // crop slightly off the image (subpixel rounding) doesn't produce a
  // black sliver at the edges. The user's drag-pan is bounded by the
  // visible frame anyway.
  const clampedSx = clamp(sx, 0, Math.max(0, natural.w - cropNatural));
  const clampedSy = clamp(sy, 0, Math.max(0, natural.h - cropNatural));
  ctx.drawImage(
    img,
    clampedSx,
    clampedSy,
    cropNatural,
    cropNatural,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE,
  );

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
  });
}
