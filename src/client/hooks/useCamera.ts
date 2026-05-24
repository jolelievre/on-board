import { useRef, useState, useEffect, useCallback } from "react";

type FacingMode = "user" | "environment";

/**
 * Camera capture hook ported from `birthday-party/src/hooks/useCamera`.
 * Owns the MediaStream lifecycle, exposes a `capture()` that returns a
 * 1024×1024 centre-cropped JPEG Blob (server-side `sharp` further
 * resizes to 400×400 + 100×100 thumb), and handles permission errors
 * with translatable keys.
 *
 * Callers must:
 *   - render `<video ref={videoRef} />` and an offscreen `<canvas ref={canvasRef} />`;
 *   - call `start()` from a user gesture (browsers gate getUserMedia
 *     behind a click on mobile);
 *   - call `stop()` when unmounting / closing the picker so the camera
 *     LED switches off promptly.
 *
 * The cleanup effect also stops the stream on unmount as a belt-and-
 * braces safeguard.
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<CameraErrorKey | null>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>("user");
  const [canFlip, setCanFlip] = useState(false);

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        const videoInputs = devices.filter((d) => d.kind === "videoinput");
        setCanFlip(videoInputs.length > 1);
      })
      .catch(() => {});
  }, []);

  const startWithMode = useCallback(async (mode: FacingMode) => {
    try {
      setError(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: 1024, height: 1024 },
        audio: false,
      });
      setStream(mediaStream);
      setFacingMode(mode);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
        setIsReady(true);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("permissionDenied");
      } else if (err instanceof DOMException && err.name === "NotFoundError") {
        setError("noCamera");
      } else {
        setError("unknown");
      }
    }
  }, []);

  const start = useCallback(async () => {
    await startWithMode(facingMode);
  }, [startWithMode, facingMode]);

  const stop = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
      setIsReady(false);
    }
  }, [stream]);

  const flip = useCallback(async () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
      setIsReady(false);
    }
    const newMode = facingMode === "user" ? "environment" : "user";
    await startWithMode(newMode);
  }, [stream, facingMode, startWithMode]);

  const capture = useCallback((): Blob | null => {
    if (!videoRef.current || !canvasRef.current) return null;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const size = Math.min(video.videoWidth, video.videoHeight);

    canvas.width = 1024;
    canvas.height = 1024;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Centre-crop to a square before drawing into the 1024×1024 canvas
    // — saves us from doing the math on the server.
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.drawImage(video, sx, sy, size, size, 0, 0, 1024, 1024);

    // Synchronous data-URL → Blob conversion. Avoids `canvas.toBlob`
    // which is async + Safari quirks. The data URL is base64 JPEG; we
    // decode it back to a Blob the FormData upload can accept directly.
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const byteString = atob(dataUrl.split(",")[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: "image/jpeg" });
  }, []);

  useEffect(() => {
    const currentStream = stream;
    return () => {
      currentStream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  return {
    videoRef,
    canvasRef,
    isReady,
    error,
    start,
    stop,
    capture,
    flip,
    canFlip,
    facingMode,
  };
}

export type CameraErrorKey = "permissionDenied" | "noCamera" | "unknown";
