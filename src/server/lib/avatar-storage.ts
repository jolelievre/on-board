import sharp from "sharp";
import { mkdir, readdir, unlink } from "fs/promises";
import path from "path";
import { createId } from "@paralleldrive/cuid2";

/**
 * Where avatar JPEGs are written. Resolved from `UPLOADS_DIR` so prod
 * deployments can point at a Docker volume; defaults to `./uploads`
 * relative to the process cwd in dev. The avatars subdir is created on
 * demand (and on server boot via `ensureAvatarsDir`).
 */
export const AVATARS_DIR = path.join(
  path.resolve(process.env.UPLOADS_DIR || "./uploads"),
  "avatars",
);

/** Public URL prefix used in `Profile.customAvatarUrl`. Served by the
 * `uploadsRoutes` Hono router (no auth — URL contains a CUID, treated as
 * an unguessable capability). */
export const AVATAR_URL_PREFIX = "/api/uploads/avatars";

/** Max accepted upload size before sharp resize, in bytes. Anything
 * larger is rejected with 413 — keeps a malicious client from pinning
 * the worker on a 100MB JPEG decode. */
export const AVATAR_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export async function ensureAvatarsDir(): Promise<void> {
  await mkdir(AVATARS_DIR, { recursive: true });
}

/**
 * Resize an uploaded image into a 400×400 cover-fit JPEG and a 100×100
 * thumbnail, write both to disk under `{profileId}.{version}.jpg`
 * (+ `.thumb.jpg`), and best-effort delete any previous versions for
 * the same profile so we don't accumulate stale files.
 *
 * `version` is a short random token (CUID prefix) so the public URL
 * changes on every upload — that defeats any CDN / SW caching that
 * keyed on the previous URL, while keeping the URL itself stable as
 * long as the file is the current one.
 *
 * Returns the new public URL the caller should persist on
 * `Profile.customAvatarUrl`.
 */
export async function writeAvatar(
  profileId: string,
  source: Buffer,
): Promise<string> {
  await ensureAvatarsDir();
  const version = createId().slice(1, 9);

  const mainFile = path.join(AVATARS_DIR, `${profileId}.${version}.jpg`);
  const thumbFile = path.join(AVATARS_DIR, `${profileId}.${version}.thumb.jpg`);

  // `.rotate()` honours EXIF orientation before resizing — phone shots
  // often come in rotated, and `.resize({fit: cover})` after `.rotate()`
  // keeps the centred crop visually upright.
  await Promise.all([
    sharp(source)
      .rotate()
      .resize(400, 400, { fit: "cover" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(mainFile),
    sharp(source)
      .rotate()
      .resize(100, 100, { fit: "cover" })
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(thumbFile),
  ]);

  await deleteAvatarsExcept(profileId, version).catch(() => {
    /* purging older versions is best-effort */
  });

  return `${AVATAR_URL_PREFIX}/${profileId}.${version}.jpg`;
}

/** Delete every file on disk that belongs to this profile id. Used by
 * the DELETE /avatar endpoint and by profile-deletion paths. */
export async function deleteAvatars(profileId: string): Promise<void> {
  try {
    const files = await readdir(AVATARS_DIR);
    await Promise.all(
      files
        .filter((f) => f.startsWith(`${profileId}.`))
        .map((f) => unlink(path.join(AVATARS_DIR, f)).catch(() => {})),
    );
  } catch {
    // Directory may not exist yet on a fresh checkout / fresh container.
  }
}

async function deleteAvatarsExcept(
  profileId: string,
  keepVersion: string,
): Promise<void> {
  const files = await readdir(AVATARS_DIR);
  await Promise.all(
    files
      .filter(
        (f) =>
          f.startsWith(`${profileId}.`) &&
          !f.startsWith(`${profileId}.${keepVersion}.`),
      )
      .map((f) => unlink(path.join(AVATARS_DIR, f)).catch(() => {})),
  );
}
