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
import {
  createLinkToken,
  LinkTokenError,
  verifyLinkToken,
} from "../lib/link-tokens.js";
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

    let body: { sourceProfileId?: string; token?: string };
    try {
      body = (await c.req.json()) as {
        sourceProfileId?: string;
        token?: string;
      };
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

    // A token unlocks linked-side merges (PR 6-C). We verify it here so
    // the merge helper only sees a trusted User id, never a raw token.
    let allowLinkedUserId: string | undefined;
    if (typeof body.token === "string" && body.token.length > 0) {
      try {
        const payload = verifyLinkToken(body.token);
        allowLinkedUserId = payload.userId;
      } catch (err) {
        if (err instanceof LinkTokenError) {
          return c.json({ error: err.message }, 400);
        }
        throw err;
      }
    }

    try {
      const survivor = await prisma.$transaction(async (tx) => {
        return mergeUnclaimedProfiles(tx, {
          callerId: user.id,
          targetProfileId: targetId,
          sourceProfileId,
          allowLinkedUserId,
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
  })
  .post("/link-token", async (c) => {
    // The caller mints a token attesting that *they* are themselves —
    // the token's userId comes from the authenticated session, never
    // from the request body. The friend will later scan this and use
    // it to bind the caller's User id to one of their local profiles.
    const user = c.get("user");
    const { token, expiresAt } = createLinkToken(user.id);
    return c.json({ token, expiresAt });
  })
  .post("/:id/link", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");

    let body: { token?: string };
    try {
      body = (await c.req.json()) as { token?: string };
    } catch {
      return c.json({ error: "JSON body required" }, 400);
    }
    if (typeof body.token !== "string" || body.token.length === 0) {
      return c.json({ error: "token is required" }, 400);
    }

    let friendUserId: string;
    try {
      friendUserId = verifyLinkToken(body.token).userId;
    } catch (err) {
      if (err instanceof LinkTokenError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }

    if (friendUserId === user.id) {
      // Scanning your own QR makes no sense and would link your
      // self-Profile to itself; reject with a stable message the UI
      // can map to a "don't scan your own code" hint.
      return c.json({ error: "Cannot link a profile to your own account" }, 400);
    }

    const target = await prisma.profile.findUnique({
      where: { id },
      select: {
        id: true,
        ownerId: true,
        linkedUserId: true,
        alias: true,
      },
    });
    if (!target) {
      return c.json({ error: "Profile not found" }, 404);
    }
    if (target.ownerId !== user.id) {
      return c.json({ error: "Only the owner can link this profile" }, 403);
    }
    if (target.linkedUserId !== null) {
      // Already linked — either to this friend (idempotent no-op) or
      // to someone else. Treat the same-friend case as a successful
      // re-link so a queued retry doesn't error; otherwise reject.
      if (target.linkedUserId === friendUserId) {
        const profile = await prisma.profile.findUnique({
          where: { id },
          select: profileSelect,
        });
        return c.json({ status: "linked" as const, profile });
      }
      return c.json(
        { error: "This profile is already linked to another account" },
        409,
      );
    }

    // Owner already has another profile linked to this same friend?
    // Surface the merge-required branch rather than mutating, so the
    // UI can prompt for confirmation before two histories collapse
    // into one.
    const existing = await prisma.profile.findFirst({
      where: {
        ownerId: user.id,
        linkedUserId: friendUserId,
        NOT: { id },
      },
      select: { id: true, alias: true },
    });
    if (existing) {
      return c.json({
        status: "merge_required" as const,
        existing,
        target: { id: target.id, alias: target.alias },
      });
    }

    const profile = await prisma.profile.update({
      where: { id },
      data: { linkedUserId: friendUserId },
      select: profileSelect,
    });
    return c.json({ status: "linked" as const, profile });
  })
  .post("/:id/unlink", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");

    const target = await prisma.profile.findUnique({
      where: { id },
      select: { id: true, ownerId: true, linkedUserId: true },
    });
    if (!target) {
      return c.json({ error: "Profile not found" }, 404);
    }
    // Either the owner OR the currently linked user can sever the
    // link. The owner is the one who set it; the linked friend gets
    // the same control over their own auth identity.
    if (target.ownerId !== user.id && target.linkedUserId !== user.id) {
      return c.json(
        { error: "Only the owner or the linked user can unlink this profile" },
        403,
      );
    }
    if (target.linkedUserId === null) {
      // Idempotent — return the current row so a queued retry succeeds.
      const profile = await prisma.profile.findUnique({
        where: { id },
        select: profileSelect,
      });
      return c.json(profile);
    }
    // Linking and unlinking are owner/friend symmetric, but the
    // self-Profile is special: it represents "you" in your own
    // suggestions and history, and an unlink would orphan it from
    // your auth account. Reject explicitly so the UI never offers it.
    if (target.ownerId === target.linkedUserId) {
      return c.json(
        { error: "Cannot unlink your own self-profile" },
        409,
      );
    }

    const profile = await prisma.profile.update({
      where: { id },
      data: { linkedUserId: null },
      select: profileSelect,
    });
    return c.json(profile);
  });
