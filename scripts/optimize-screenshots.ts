/**
 * Optimize the curated install-prompt screenshots that ship under
 * `public/screenshots/`.
 *
 * For each `*.png` in that directory:
 *   - Downscale to a max width of 720 px (preserving aspect ratio).
 *     Original captures are 1081 px wide Pixel-5 retina dumps; Chrome's
 *     install prompt and the in-page strip on /install both render
 *     them well under 300 px wide, so 1081 was wasted bytes flagged
 *     by Lighthouse's `uses-responsive-images` audit.
 *   - Re-encode the PNG at the new size (so the PNG fallback used by
 *     `<picture>` matches what WebP claims for `sizes`).
 *   - Emit a `.webp` sibling at quality 80. WebP is ~30% the size of
 *     PNG at equivalent visual quality, which is what fixes the
 *     `modern-image-formats` audit.
 *
 * Run on demand: `npx tsx scripts/optimize-screenshots.ts`.
 * Runs automatically before each `npm run build` via the `prebuild`
 * script.
 */

import sharp from "sharp";
import fs from "fs/promises";
import path from "path";

const DIR = path.resolve(
  import.meta.dirname,
  "..",
  "public",
  "screenshots",
);
// Two srcset candidates so mobile (where the strip caps at ~140 px
// wide) doesn't download the 720 px desktop variant. Lighthouse's
// `uses-responsive-images` audit flagged ~300 KiB of avoidable bytes
// on mobile from this gap.
const WIDTHS = [720, 360] as const;
const PRIMARY_WIDTH = WIDTHS[0]; // PNG fallback + manifest reference
const WEBP_QUALITY = 80;

async function main() {
  let entries: string[];
  try {
    entries = await fs.readdir(DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // No curated screenshots checked in yet — silent no-op so the
      // prebuild step doesn't break a fresh clone.
      console.log("optimize-screenshots: nothing to do");
      return;
    }
    throw err;
  }

  const pngs = entries.filter((f) => f.endsWith(".png"));
  if (pngs.length === 0) {
    console.log("optimize-screenshots: no PNGs to process");
    return;
  }

  for (const file of pngs) {
    const srcPath = path.join(DIR, file);
    const meta = await sharp(srcPath).metadata();
    const width = meta.width ?? PRIMARY_WIDTH;

    // If a previous run already downsized below the primary width,
    // skip rework — keeps `npm run build` idempotent.
    const needsResize = width > PRIMARY_WIDTH;

    // Emit one WebP per candidate width. The primary (720) is what
    // the manifest references; the smaller (360) only ships via the
    // <picture> srcSet on /install.
    const base = file.replace(/\.png$/, "");
    const emitted: string[] = [];
    for (const w of WIDTHS) {
      const out = path.join(
        DIR,
        w === PRIMARY_WIDTH ? `${base}.webp` : `${base}-${w}w.webp`,
      );
      await sharp(srcPath)
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toFile(out);
      emitted.push(path.basename(out));
    }

    if (needsResize) {
      // Replace the PNG in place with the primary-width version.
      // Buffer first — sharp can't read and write to the same path.
      const buf = await sharp(srcPath)
        .resize({ width: PRIMARY_WIDTH, withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
      await fs.writeFile(srcPath, buf);
    }
    console.log(
      `optimize-screenshots: ${file} -> ${emitted.join(", ")}${
        needsResize ? " (resized PNG)" : ""
      }`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
