import { Hono } from "hono";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { profileVisibilityWhere } from "../lib/profiles.js";
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

    const profile = await prisma.profile.create({
      data: {
        ...(id ? { id } : {}),
        ownerId: user.id,
        alias: trimmedAlias,
      },
      select: profileSelect,
    });

    return c.json(profile, 201);
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
  });
