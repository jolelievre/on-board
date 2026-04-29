import { useEffect, useState, type RefObject } from "react";

export type ElementSize = { width: number; height: number };

/**
 * Measures the DOM size of the referenced element via ResizeObserver.
 * Returns null on the first render (before measurement) so callers can
 * choose to render nothing — useful for SVG primitives like SketchRect
 * whose path math depends on actual pixel dimensions.
 */
export function useElementSize(
  ref: RefObject<HTMLElement | null>,
): ElementSize | null {
  const [size, setSize] = useState<ElementSize | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Initial sync read so we don't wait a full frame for first paint.
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setSize({ width: rect.width, height: rect.height });
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prev) => {
        if (prev && prev.width === width && prev.height === height) return prev;
        return { width, height };
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
