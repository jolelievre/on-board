/**
 * Generates PWA icons from the OnBoard logo SVG.
 * Outputs `public/pwa-icon-192.png` and `public/pwa-icon-512.png`.
 *
 * Run via: `npx tsx scripts/generate-pwa-icons.ts`
 *
 * The SVG below mirrors the LogoR5 hex-board variant — pawn over hex tile.
 * Colors come from the parchment palette so the splash matches the light
 * theme (the standard install screen uses the manifest's background_color).
 */

import sharp from "sharp";
import path from "path";
import fs from "fs/promises";

const OUT = path.resolve(import.meta.dirname, "..", "public");

const BG = "#F4ECDC"; // parchment bg
const INK = "#1F1A12";
const PRIMARY = "#9F2D1A"; // pawn / wax-seal red
const ACCENT = "#1B5E5A"; // forest teal board
const RADIUS = 96; // rounded corner on the icon, scaled per output

function svg(size: number): string {
  // The viewBox matches LogoR5's hex glyph extents (0 -16 44 52).
  // We add a parchment background and a generous padding so the glyph
  // occupies ~70% of the icon — common PWA icon convention.
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${(RADIUS * size) / 512}" fill="${BG}"/>
  <g transform="translate(${size * 0.18} ${size * 0.18}) scale(${(size * 0.64) / 44})">
    <g transform="translate(0 16)">
      <ellipse cx="22" cy="32" rx="13" ry="1.3" fill="${INK}" opacity="0.18"/>
      <path d="M11 28 L16 24 L28 24 L33 28 L28 32 L16 32 Z" fill="${ACCENT}"/>
      <g stroke="${BG}" stroke-width="0.6" opacity="0.45" stroke-linecap="round">
        <line x1="16" y1="24" x2="22" y2="28"/>
        <line x1="28" y1="24" x2="22" y2="28"/>
        <line x1="33" y1="28" x2="22" y2="28"/>
        <line x1="28" y1="32" x2="22" y2="28"/>
        <line x1="16" y1="32" x2="22" y2="28"/>
        <line x1="11" y1="28" x2="22" y2="28"/>
      </g>
      <g>
        <circle cx="22" cy="15.5" r="3.4" fill="${PRIMARY}"/>
        <rect x="19" y="18.5" width="6" height="1.3" rx="0.5" fill="${PRIMARY}"/>
        <path d="M18.6 20 Q22 17.5 25.4 20 L26 28 L18 28 Z" fill="${PRIMARY}"/>
        <rect x="17" y="28" width="10" height="2.2" rx="0.4" fill="${PRIMARY}"/>
      </g>
    </g>
  </g>
</svg>`.trim();
}

async function generate(size: number, name: string) {
  const buf = await sharp(Buffer.from(svg(size))).png().toBuffer();
  await fs.writeFile(path.join(OUT, name), buf);
  console.log(`  ${name} (${size}×${size})`);
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  console.log("Generating PWA icons →", OUT);
  await generate(192, "pwa-icon-192.png");
  await generate(512, "pwa-icon-512.png");
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
