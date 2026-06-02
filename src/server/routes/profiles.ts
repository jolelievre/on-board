import { Hono } from "hono";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  AVATAR_MAX_UPLOAD_BYTES,
  deleteAvatars,
  writeAvatar,
} from "../lib/avatar-storage.js";
import {
  mergeProfiles,
  ProfileMergeError,
} from "../lib/profile-merge.js";
import { bumpMatchesForProfile, ensureSelfProfile } from "../lib/profiles.js";
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

const AVATAR_FRAMES = ["circle", "rounded", "tag"] as const;
type AvatarFrame = (typeof AVATAR_FRAMES)[number];

// Must stay in sync with the `Category` union in
// `src/client/components/ui/category.ts`. The server only validates
// shape here — the visual mapping lives client-side.
const AVATAR_RINGS = [
  "civil",
  "scientific",
  "commercial",
  "guilds",
  "wonders",
  "progress",
  "treasury",
  "military",
] as const;
type AvatarRing = (typeof AVATAR_RINGS)[number];

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
  avatarFrame: true,
  avatarRing: true,
  usedAt: true,
  createdAt: true,
  updatedAt: true,
  linkedUser: {
    select: {
      id: true,
      name: true,
      alias: true,
      avatarUrl: true,
      // The email is surfaced to the owner so they can confirm the
      // QR they scanned belongs to the friend they expected. The
      // friend's User row is otherwise opaque to other accounts;
      // exposing email here is a deliberate, minimal disclosure
      // gated by the visibility filter (only viewers who own or
      // are the linked user see this projection at all).
      email: true,
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

    // Belt-and-braces: guarantee the caller's self-Profile exists in
    // the DB before we query. Idempotent upsert keyed on
    // (ownerId, linkedUserId). Covers any legacy account whose
    // `user.create.after` hook never fired (pre-hook signups, hook
    // failure, manual DB insert) — the missing-self failure mode is
    // then closed independently of whatever cursor the client sent.
    await ensureSelfProfile({
      id: user.id,
      name: user.name,
      alias: user.alias,
    });

    // Under the single-Profile model, only owned profiles are listed.
    // Friend-owned profiles linked to me are theirs to manage, not
    // mine — I see them implicitly when they appear in matches
    // (the Player row embeds the Profile projection), never in my own
    // listing. The owner check covers both my self-Profile and every
    // friend I've added.
    const profiles = await prisma.profile.findMany({
      where: {
        ownerId: user.id,
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

    const { alias, useLinkedAvatar, avatarFrame, avatarRing } = body as {
      alias?: string;
      useLinkedAvatar?: boolean;
      avatarFrame?: string;
      // Accepts `string | null` because clearing the ring is a valid edit;
      // `undefined` means "leave it alone" (standard PATCH semantics).
      avatarRing?: string | null;
    };

    if (alias !== undefined) {
      if (typeof alias !== "string" || alias.trim().length === 0) {
        return c.json({ error: "Alias must be a non-empty string" }, 400);
      }
    }
    if (useLinkedAvatar !== undefined && typeof useLinkedAvatar !== "boolean") {
      return c.json({ error: "useLinkedAvatar must be a boolean" }, 400);
    }
    if (
      avatarFrame !== undefined &&
      !AVATAR_FRAMES.includes(avatarFrame as AvatarFrame)
    ) {
      return c.json(
        { error: `avatarFrame must be one of: ${AVATAR_FRAMES.join(", ")}` },
        400,
      );
    }
    if (
      avatarRing !== undefined &&
      avatarRing !== null &&
      !AVATAR_RINGS.includes(avatarRing as AvatarRing)
    ) {
      return c.json(
        { error: `avatarRing must be null or one of: ${AVATAR_RINGS.join(", ")}` },
        400,
      );
    }
    if (
      alias === undefined &&
      useLinkedAvatar === undefined &&
      avatarFrame === undefined &&
      avatarRing === undefined
    ) {
      return c.json({ error: "No editable field provided" }, 400);
    }

    const existing = await prisma.profile.findUnique({
      where: { id },
      select: { ownerId: true, alias: true },
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

    const trimmedAlias = alias !== undefined ? alias.trim() : undefined;
    const aliasChanged =
      trimmedAlias !== undefined && trimmedAlias !== existing.alias;
    // Every field that's projected onto `Player.profile` needs a Match
    // bump on change — otherwise friends' devices won't pick the new
    // snapshot up via `?since=` pull-sync. `useLinkedAvatar`,
    // `avatarFrame`, `avatarRing` were added in Phase 7; `alias` was
    // already wired before.
    const projectedFieldsChanged =
      aliasChanged ||
      useLinkedAvatar !== undefined ||
      avatarFrame !== undefined ||
      avatarRing !== undefined;

    const profile = await prisma.profile.update({
      where: { id },
      data: {
        ...(trimmedAlias !== undefined ? { alias: trimmedAlias } : {}),
        ...(useLinkedAvatar !== undefined ? { useLinkedAvatar } : {}),
        ...(avatarFrame !== undefined ? { avatarFrame } : {}),
        ...(avatarRing !== undefined ? { avatarRing } : {}),
      },
      select: profileSelect,
    });

    if (projectedFieldsChanged) {
      await bumpMatchesForProfile(id);
    }

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

    // Refresh the embedded `Player.profile` projection on every Match
    // where this profile played, so friends viewing those matches
    // see the new photo on their next pull-sync.
    await bumpMatchesForProfile(id);

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

    // Refresh the embedded `Player.profile` projection so friends pick
    // up the cleared photo / re-enabled linked-avatar on their next
    // pull-sync (same rationale as the upload path).
    await bumpMatchesForProfile(id);

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
      const survivorId = await prisma.$transaction(async (tx) => {
        return mergeProfiles(tx, {
          callerId: user.id,
          targetProfileId: targetId,
          sourceProfileId,
        });
      });
      const profile = await prisma.profile.findUnique({
        where: { id: survivorId },
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
  .get("/:id/link-status", async (c) => {
    // Lightweight polling endpoint for the shower's `LinkCodeDisplay`.
    // The component ticks this every 2 s while its QR is on screen and
    // pivots to the "linked" celebration when `linkedUserId` flips
    // non-null. A scoped endpoint keeps the polling cost minimal (no
    // big profile projection / linkedUser join) and lives in the same
    // namespace as `/link-token` and `/link` so the surface area of
    // the link flow stays grouped.
    const user = c.get("user");
    const id = c.req.param("id");

    if (!CUID_RE.test(id)) {
      return c.json({ error: "Invalid profile id format" }, 400);
    }

    const profile = await prisma.profile.findUnique({
      where: { id },
      select: { ownerId: true, linkedUserId: true },
    });
    if (!profile) {
      return c.json({ error: "Profile not found" }, 404);
    }
    if (profile.ownerId !== user.id) {
      return c.json(
        { error: "Only the owner can check this profile's link status" },
        403,
      );
    }
    return c.json({ linkedUserId: profile.linkedUserId });
  })
  .post("/:id/link-token", async (c) => {
    // Profile-scoped token. The caller mints a token attesting that
    // *they* are themselves AND that they're anchoring this link
    // gesture onto their owned profile `:id`. The friend will later
    // scan this and use it to bilaterally link `:id` (the source) with
    // one of their own owned profiles (the target/scanner side).
    //
    // The session-derived userId is authoritative (never trust the
    // client). `:id` must be owned by the caller and unclaimed —
    // re-linking an already-linked profile is the merge_required path,
    // handled on the link endpoint itself.
    const user = c.get("user");
    const id = c.req.param("id");

    if (!CUID_RE.test(id)) {
      return c.json({ error: "Invalid profile id format" }, 400);
    }

    const profile = await prisma.profile.findUnique({
      where: { id },
      select: { ownerId: true, linkedUserId: true },
    });
    if (!profile) {
      return c.json({ error: "Profile not found" }, 404);
    }
    if (profile.ownerId !== user.id) {
      return c.json(
        { error: "Only the owner can mint a link code for this profile" },
        403,
      );
    }
    if (profile.linkedUserId !== null) {
      return c.json(
        { error: "This profile is already linked" },
        409,
      );
    }

    const { token, expiresAt } = createLinkToken({
      userId: user.id,
      sourceProfileId: id,
    });
    return c.json({ token, expiresAt });
  })
  .post("/:id/link", async (c) => {
    // Bilateral link. The caller is the *scanner* and `:id` is their
    // owned profile (the "target"). The token attests to the *shower*
    // (`payload.userId`) and the profile they're offering up
    // (`payload.sourceProfileId`). On success we set linkedUserId on
    // both rows in one transaction so both sides flip in lockstep.
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

    let showerUserId: string;
    let sourceProfileId: string;
    try {
      const payload = verifyLinkToken(body.token);
      showerUserId = payload.userId;
      sourceProfileId = payload.sourceProfileId;
    } catch (err) {
      if (err instanceof LinkTokenError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }

    if (showerUserId === user.id) {
      // Scanning your own QR makes no sense; the token includes a
      // source profile owned by the caller and we'd be linking it to
      // another of the caller's profiles, which violates the per-owner
      // unique constraint anyway.
      return c.json({ error: "Cannot link a profile to your own account" }, 400);
    }

    // Load both sides up front so we can guard against the various
    // collision cases before mutating.
    const [target, source] = await Promise.all([
      prisma.profile.findUnique({
        where: { id },
        select: { id: true, ownerId: true, linkedUserId: true, alias: true },
      }),
      prisma.profile.findUnique({
        where: { id: sourceProfileId },
        select: { id: true, ownerId: true, linkedUserId: true, alias: true },
      }),
    ]);

    if (!target) {
      return c.json({ error: "Profile not found" }, 404);
    }
    if (target.ownerId !== user.id) {
      return c.json({ error: "Only the owner can link this profile" }, 403);
    }
    if (!source) {
      // Token signature was valid but the source row is gone (deleted
      // between QR mint and scan). Treat as a stale token so the user
      // sees an actionable refresh prompt rather than a 404 inside a
      // link error.
      return c.json({ error: "Link token has expired" }, 400);
    }
    if (source.ownerId !== showerUserId) {
      // The token is signed but the source profile no longer belongs
      // to the user it was minted for (e.g. transferred via merge).
      // Reject defensively — never silently bind to a row owned by a
      // third party.
      return c.json({ error: "Invalid link token" }, 400);
    }

    // Both already pointing at each other → idempotent re-link.
    if (
      target.linkedUserId === showerUserId &&
      source.linkedUserId === user.id
    ) {
      const [profile, sourceProfile] = await Promise.all([
        prisma.profile.findUnique({ where: { id }, select: profileSelect }),
        prisma.profile.findUnique({
          where: { id: sourceProfileId },
          select: profileSelect,
        }),
      ]);
      return c.json({
        status: "linked" as const,
        profile,
        sourceProfile,
      });
    }

    // One side already linked to a *different* user → reject. We
    // don't auto-merge across friends.
    if (
      target.linkedUserId !== null &&
      target.linkedUserId !== showerUserId
    ) {
      return c.json(
        { error: "This profile is already linked to another account" },
        409,
      );
    }
    if (source.linkedUserId !== null && source.linkedUserId !== user.id) {
      return c.json(
        {
          error:
            "Your friend's profile is already linked to another account",
        },
        409,
      );
    }

    // Scanner-side merge_required: caller already has *another* of
    // their own profiles linked to the shower. UI prompts to merge.
    const scannerExisting = await prisma.profile.findFirst({
      where: {
        ownerId: user.id,
        linkedUserId: showerUserId,
        NOT: { id },
      },
      select: { id: true, alias: true },
    });
    if (scannerExisting) {
      return c.json({
        status: "merge_required" as const,
        side: "scanner" as const,
        existing: scannerExisting,
        target: { id: target.id, alias: target.alias },
      });
    }

    // Shower-side merge_required: the shower already has *another* of
    // their own profiles linked to the scanner. Surface as a
    // non-actionable error — only the shower can resolve it on their
    // own device. Proactive notification is a follow-up.
    const showerExisting = await prisma.profile.findFirst({
      where: {
        ownerId: showerUserId,
        linkedUserId: user.id,
        NOT: { id: sourceProfileId },
      },
      select: { id: true, alias: true },
    });
    if (showerExisting) {
      return c.json({
        status: "merge_required" as const,
        side: "shower" as const,
        existingAlias: showerExisting.alias,
        targetAlias: source.alias,
      });
    }

    // Happy path — bilateral set in a single transaction. If either
    // update fails (composite unique conflict, foreign key, ...), the
    // other rolls back so we never leave a half-linked state.
    const [profile, sourceProfile] = await prisma.$transaction([
      prisma.profile.update({
        where: { id },
        data: { linkedUserId: showerUserId },
        select: profileSelect,
      }),
      prisma.profile.update({
        where: { id: sourceProfileId },
        data: { linkedUserId: user.id },
        select: profileSelect,
      }),
    ]);
    return c.json({
      status: "linked" as const,
      profile,
      sourceProfile,
    });
  })
  .post("/:id/unlink", async (c) => {
    // Bilateral unlink. Severing one side without the other leaves a
    // confusing half-state under the bilateral link model, so we clear
    // the counterpart (if it exists) in the same transaction. Either
    // the owner or the currently linked user can initiate; both sides'
    // profiles flip in lockstep.
    const user = c.get("user");
    const id = c.req.param("id");

    const target = await prisma.profile.findUnique({
      where: { id },
      select: { id: true, ownerId: true, linkedUserId: true },
    });
    if (!target) {
      return c.json({ error: "Profile not found" }, 404);
    }
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
    // The self-Profile (ownerId === linkedUserId) is special: it
    // represents "you" in your own suggestions and history. Unlinking
    // would orphan it from your auth account; reject explicitly so
    // the UI never offers it.
    if (target.ownerId === target.linkedUserId) {
      return c.json(
        { error: "Cannot unlink your own self-profile" },
        409,
      );
    }

    // Find the counterpart profile (the other half of the bilateral
    // link). It may not exist for legacy unilateral links — that's
    // fine, we just clear `target` alone.
    const counterpart = await prisma.profile.findFirst({
      where: {
        ownerId: target.linkedUserId,
        linkedUserId: target.ownerId,
      },
      select: { id: true },
    });

    const updates = [
      prisma.profile.update({
        where: { id },
        data: { linkedUserId: null },
        select: profileSelect,
      }),
    ];
    if (counterpart) {
      updates.push(
        prisma.profile.update({
          where: { id: counterpart.id },
          data: { linkedUserId: null },
          select: profileSelect,
        }),
      );
    }
    const [profile] = await prisma.$transaction(updates);
    return c.json(profile);
  });
