import { Hono } from "hono";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { profileVisibilityWhere } from "../lib/profiles.js";
import {
  AVATAR_MAX_UPLOAD_BYTES,
  deleteAvatars,
  writeAvatar,
} from "../lib/avatar-storage.js";
import {
  mergeUnclaimedProfiles,
  ProfileMergeError,
} from "../lib/profile-merge.js";
import type { AuthUser } from "../middleware/auth.js";

type AuthEnv = {
  Variables: {
    user: AuthUser;
  };
};

// Same CUID shape check as matches.ts. Accepts both CUID v1 and v2.
const CUID_RE = /^[a-z][a-z0-9]{19,31}$/;

/** Shape returned by every profile endpoint. The `linkedUser` block is a
 * thin projection that lets the client render the canonical avatar / name
 * for linked profiles without an extra `/api/users` lookup. */
const profileSelect = {
  id: true,
  ownerId: true,
  linkedUserId: true,
  alias: true,
  customAvatarUrl: true,
  useLinkedAvatar: true,
  usedAt: true,
  createdAt: true,
  updatedAt: true,
  linkedUser: {
    select: {
      id: true,
      name: true,
      alias: true,
      avatarUrl: true,
    },
  },
} as const satisfies Prisma.ProfileSelect;

export const profilesRoutes = new Hono<AuthEnv>()
  .get("/", async (c) => {
    const user = c.get("user");
    const since = c.req.query("since");

    let sinceDate: Date | undefined;
    if (since !== undefined) {
      const parsed = new Date(since);
      if (Number.isNaN(parsed.getTime())) {
        return c.json({ error: "Invalid `since` timestamp" }, 400);
      }
      sinceDate = parsed;
    }

    const profiles = await prisma.profile.findMany({
      where: {
        ...profileVisibilityWhere(user.id),
        ...(sinceDate ? { updatedAt: { gt: sinceDate } } : {}),
      },
      select: profileSelect,
      // `usedAt` first so the most-recently-used profiles bubble to the
      // top in the suggestion picker. Stable secondary sort by `alias`
      // keeps the order deterministic in tests.
      orderBy: [{ usedAt: "desc" }, { alias: "asc" }],
    });

    return c.json(profiles);
  })
  .post("/", async (c) => {
    const user = c.get("user");
    const body = await c.req.json();

    const { id, alias } = body as {
      id?: string;
      alias?: string;
    };

    if (id !== undefined && !CUID_RE.test(id)) {
      return c.json({ error: "Invalid profile id format" }, 400);
    }

    if (!alias || typeof alias !== "string" || alias.trim().length === 0) {
      return c.json({ error: "Alias is required" }, 400);
    }

    const trimmedAlias = alias.trim();

    // Idempotent create on client-supplied id, matching the matches route
    // pattern. Lets a queued POST replay safely after a partial network
    // failure.
    if (id) {
      const existing = await prisma.profile.findUnique({
        where: { id },
        select: profileSelect,
      });
      if (existing) {
        if (existing.ownerId !== user.id) {
          return c.json({ error: "Profile id is already in use" }, 403);
        }
        return c.json(existing, 200);
      }
    }

    try {
      const profile = await prisma.profile.create({
        data: {
          ...(id ? { id } : {}),
          ownerId: user.id,
          alias: trimmedAlias,
        },
        select: profileSelect,
      });
      return c.json(profile, 201);
    } catch (err) {
      // Idempotency race: two replays of the same queued POST can both
      // pass the findUnique check above before either commits, and the
      // second create then trips the unique constraint on `id`. Treat
      // that the same as a successful replay — re-fetch and return the
      // row that the racing request wrote.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        id
      ) {
        const winner = await prisma.profile.findUnique({
          where: { id },
          select: profileSelect,
        });
        if (winner && winner.ownerId === user.id) {
          return c.json(winner, 200);
        }
      }
      throw err;
    }
  })
  .patch("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const body = await c.req.json();

    const { alias, useLinkedAvatar } = body as {
      alias?: string;
      useLinkedAvatar?: boolean;
    };

    if (alias !== undefined) {
      if (typeof alias !== "string" || alias.trim().length === 0) {
        return c.json({ error: "Alias must be a non-empty string" }, 400);
      }
    }
    if (useLinkedAvatar !== undefined && typeof useLinkedAvatar !== "boolean") {
      return c.json({ error: "useLinkedAvatar must be a boolean" }, 400);
    }
    if (alias === undefined && useLinkedAvatar === undefined) {
      return c.json({ error: "No editable field provided" }, 400);
    }

    const existing = await prisma.profile.findUnique({
      where: { id },
      select: { ownerId: true },
    });
    if (!existing) {
      return c.json({ error: "Profile not found" }, 404);
    }
    // Editing display fields is always the owner's prerogative (the
    // linked user's own User.name / User.avatarUrl are untouchable from
    // here — those mutate via the auth user route).
    if (existing.ownerId !== user.id) {
      return c.json({ error: "Only the owner can edit this profile" }, 403);
    }

    const profile = await prisma.profile.update({
      where: { id },
      data: {
        ...(alias !== undefined ? { alias: alias.trim() } : {}),
        ...(useLinkedAvatar !== undefined ? { useLinkedAvatar } : {}),
      },
      select: profileSelect,
    });

    return c.json(profile);
  })
  .post("/:id/avatar", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");

    const existing = await prisma.profile.findUnique({
      where: { id },
      select: { ownerId: true },
    });
    if (!existing) {
      return c.json({ error: "Profile not found" }, 404);
    }
    // Only the owner can upload — even the linked user can't override
    // the canonical Google photo from this endpoint; they have to
    // change their own User.avatarUrl via the auth provider.
    if (existing.ownerId !== user.id) {
      return c.json({ error: "Only the owner can upload an avatar" }, 403);
    }

    // Hono parses multipart bodies via the standard FormData spec. The
    // browser uploader posts the file under the `avatar` field.
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: "Multipart body required" }, 400);
    }
    const file = form.get("avatar");
    if (!(file instanceof File)) {
      return c.json({ error: "Missing `avatar` file part" }, 400);
    }
    if (file.size === 0) {
      return c.json({ error: "Uploaded file is empty" }, 400);
    }
    if (file.size > AVATAR_MAX_UPLOAD_BYTES) {
      return c.json({ error: "File too large" }, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let publicUrl: string;
    try {
      publicUrl = await writeAvatar(id, buffer);
    } catch (err) {
      console.error("[avatar upload] sharp/write failed", err);
      return c.json({ error: "Could not process image" }, 400);
    }

    const profile = await prisma.profile.update({
      where: { id },
      data: {
        customAvatarUrl: publicUrl,
        // Custom upload implies "show this one, not the linked avatar"
        // — match the toggle so the new file appears immediately.
        useLinkedAvatar: false,
      },
      select: profileSelect,
    });

    return c.json(profile);
  })
  .delete("/:id/avatar", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");

    const existing = await prisma.profile.findUnique({
      where: { id },
      select: { ownerId: true },
    });
    if (!existing) {
      return c.json({ error: "Profile not found" }, 404);
    }
    if (existing.ownerId !== user.id) {
      return c.json({ error: "Only the owner can clear the avatar" }, 403);
    }

    // Best-effort filesystem cleanup; the DB row is the source of truth.
    await deleteAvatars(id).catch((err) => {
      console.error("[avatar delete] could not unlink files", err);
    });

    const profile = await prisma.profile.update({
      where: { id },
      data: {
        customAvatarUrl: null,
        // Re-enable linked-photo preference so a linked profile falls
        // back to the friend's Google avatar after a custom clear.
        useLinkedAvatar: true,
      },
      select: profileSelect,
    });

    return c.json(profile);
  })
  .post("/:targetId/merge", async (c) => {
    const user = c.get("user");
    const targetId = c.req.param("targetId");

    let body: { sourceProfileId?: string };
    try {
      body = (await c.req.json()) as { sourceProfileId?: string };
    } catch {
      return c.json({ error: "JSON body required" }, 400);
    }
    const sourceProfileId = body.sourceProfileId;
    if (!sourceProfileId || typeof sourceProfileId !== "string") {
      return c.json({ error: "sourceProfileId is required" }, 400);
    }
    if (!CUID_RE.test(sourceProfileId) || !CUID_RE.test(targetId)) {
      return c.json({ error: "Invalid profile id format" }, 400);
    }

    try {
      const survivor = await prisma.$transaction(async (tx) => {
        return mergeUnclaimedProfiles(tx, {
          callerId: user.id,
          targetProfileId: targetId,
          sourceProfileId,
        });
      });
      const profile = await prisma.profile.findUnique({
        where: { id: survivor },
        select: profileSelect,
      });
      return c.json({ status: "merged" as const, profile });
    } catch (err) {
      if (err instanceof ProfileMergeError) {
        return c.json({ error: err.message }, err.status);
      }
      throw err;
    }
  });
