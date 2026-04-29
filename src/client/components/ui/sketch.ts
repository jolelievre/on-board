/**
 * Deterministic seeded jitter — same seed always returns the same offset.
 * Used by SketchRect/SketchUnderline so hand-drawn borders don't twitch
 * across re-renders. Range is centered on 0 (output ∈ [-range, +range]).
 */
function jitterSeed(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export function jp(seed: number, range = 1): number {
  return (jitterSeed(seed) - 0.5) * 2 * range;
}
