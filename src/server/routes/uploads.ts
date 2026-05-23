import { Hono } from "hono";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { AVATARS_DIR } from "../lib/avatar-storage.js";

// Filename pattern enforced by avatar-storage.writeAvatar:
//   {profileId}.{version}[.thumb].jpg
// where profileId is a CUID (lowercase alnum, leading letter) and
// version is an 8-char CUID prefix. Reject anything else to keep the
// static-serve safe — no path traversal, no random file probing.
const SAFE_AVATAR_FILE = /^[a-z][a-z0-9]{19,31}\.[a-z0-9]{4,16}(\.thumb)?\.jpg$/;

/**
 * Public static-file serving for owner-uploaded avatars.
 *
 * Mounted at `/api/uploads/...` and currently only serves
 * `/api/uploads/avatars/*`. No auth: the URL embeds the profile CUID
 * (unguessable) and a per-upload random version, so leaking the URL is
 * the only way someone else sees the file — same capability model as
 * Google avatar URLs.
 */
export const uploadsRoutes = new Hono()
  .get("/avatars/:file", async (c) => {
    const file = c.req.param("file");
    if (!SAFE_AVATAR_FILE.test(file)) {
      return c.notFound();
    }
    const filePath = path.join(AVATARS_DIR, file);
    let size: number;
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) return c.notFound();
      size = stats.size;
    } catch {
      return c.notFound();
    }

    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(size),
        // Long-lived cache: the URL changes on every upload (per-version
        // suffix) so we can mark each variant as immutable.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });
