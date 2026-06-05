/**
 * Compile-time guard against local↔server model drift (PR 8-H).
 *
 * For every Prisma model that has a Dexie mirror, this file asserts —
 * via TypeScript-only type checks — that:
 *
 *   1. Every scalar column on the server model has a corresponding
 *      field on the local Dexie row type, or is explicitly listed
 *      on the per-table presence allow-list with a documented reason.
 *
 *   2. Every shared field's client type is wide enough to hold any
 *      value the server might send. Server `string` mapped to client
 *      `string | null` is acceptable (widening); the reverse —
 *      server `string | null` mapped to client `string` — is drift
 *      and will fail compilation. Intentional narrowings (e.g. a
 *      string status column the client treats as a literal union)
 *      live in the per-table narrowing allow-list with a reason.
 *
 * The file emits no runtime code; it only exports type aliases. A
 * failure surfaces as a `tsc` error pointing at one of the `_Assert*`
 * lines below, with the offending field name in the conflicting
 * type's union literal.
 *
 * This file is part of `npm run type-check` via tsconfig.json's
 * `include` array. Editors with TypeScript language service support
 * also flag drift inline.
 *
 * Background: PR 8-F surfaced that `Match.createdById` had existed
 * server-side for some time without a matching field on `LocalMatch`,
 * which left a window where `createMatch`'s eager local write was
 * incomplete. This guard catches that class of bug at compile time
 * before it can ship.
 */

import type { Match, Player, Profile, Score } from "@prisma/client";
import type {
  LocalMatch,
  LocalPlayer,
  LocalProfile,
  LocalScore,
} from "../src/client/lib/db";

// ─── Type plumbing ───

/** Compile fails if T is anything other than the exact `never` type.
 * Used as the assertion endpoint: `AssertNever<{drifted-key-union}>`
 * yields a readable error pointing at the failing key. */
type AssertNever<T extends never> = T;

/** Map a server-side TypeScript field type to its expected client
 * representation. Dexie serialises every DateTime to an ISO string at
 * the pull-sync boundary, so `Date` reads at the client as `string`.
 * Other primitives pass through. Json columns are intentionally not
 * transformed here — every Json field today has a deliberate narrowed
 * client shape (see the per-table narrowing allow-lists below), so a
 * blanket `Json → Record<string, unknown>` mapping would mask future
 * Json columns that arrive without an explicit narrowing decision. */
type ToClient<T> = T extends Date ? string : T;

/** Keys present on the server type but missing on the client type
 * (and not in the per-table presence allow-list). Each such key is a
 * presence gap — the Dexie row never mirrors it. */
type MissingOnClient<Server, Client, Allow extends string = never> = Exclude<
  keyof Server,
  keyof Client | Allow
>;

/** Keys shared by both types whose (transformed) server value cannot
 * be assigned to the client field — i.e. the client type is narrower
 * than the server can produce, and the narrowing hasn't been declared
 * intentional via the per-table narrowing allow-list. The `[...]`
 * tuple wrapper disables distributive conditional types so unions are
 * compared as a whole. */
type ShapeMismatch<Server, Client, NarrowAllow extends string = never> = {
  [K in keyof Server & keyof Client]: K extends NarrowAllow
    ? never
    : [ToClient<Server[K]>] extends [Client[K]]
      ? never
      : K;
}[keyof Server & keyof Client];

// ─── Per-table presence allow-lists ───
//
// Server columns that are intentionally not mirrored to Dexie. Document
// each entry's reason inline. An empty `never` is the desired steady
// state — every Prisma scalar column maps to a Dexie field. Today
// (post-PR-8-F) the schemas are in sync and no presence entries are
// needed.

type MatchPresenceAllowList = never;
type PlayerPresenceAllowList = never;
type ProfilePresenceAllowList = never;
type ScorePresenceAllowList = never;

// ─── Per-table narrowing allow-lists ───
//
// Fields where the client type is deliberately narrower than the server
// schema, because the app knows the value space is constrained. New
// narrowings must be added here with a reason — otherwise the shape
// assertions below will fail.

type MatchNarrowedFields =
  // Server stores `status` as a free-form string; both the seed and
  // every write path only ever produce "IN_PROGRESS" or "COMPLETED".
  // The client narrows to a literal union so the UI can exhaustively
  // switch on it.
  | "status"
  // `metadata` is `Json` server-side. The client narrows to
  // `Record<string, unknown>` because every game's metadata shape is a
  // top-level object (`{ skullKing: { dealerStart: ... } }`, etc.).
  // Per-game scorers refine the shape further at the read site.
  | "metadata";

type PlayerNarrowedFields = never;

type ProfileNarrowedFields =
  // `avatarFrame` is a free-form string column. The PATCH endpoint and
  // every UI emitter only produce "circle" | "rounded" | "tag"; the
  // client narrows to that literal union so the renderer can
  // exhaustively map each value to a stamp shape.
  | "avatarFrame"
  // `avatarRing` is `String?`. The PATCH endpoint validates against
  // the 8 7WD category keys (or null for no ring); the client mirrors
  // that exhaustive union so the colour-picker UI is exhaustive too.
  | "avatarRing";

type ScoreNarrowedFields =
  // Same Json narrowing as `Match.metadata` — every per-category
  // payload is a top-level object (e.g. `{ bid, tricks, bonusDetails }`
  // for Skull King round scores).
  "metadata";

// ─── Presence assertions ───
//
// Each `_*Missing` alias resolves to `never` when every Prisma column
// has a Dexie counterpart. If a new column is added server-side
// without updating `LocalX`, the assertion below will fail with the
// offending key name in the error message.

type _MatchMissing = AssertNever<
  MissingOnClient<Match, LocalMatch, MatchPresenceAllowList>
>;
type _PlayerMissing = AssertNever<
  MissingOnClient<Player, LocalPlayer, PlayerPresenceAllowList>
>;
type _ProfileMissing = AssertNever<
  MissingOnClient<Profile, LocalProfile, ProfilePresenceAllowList>
>;
type _ScoreMissing = AssertNever<
  MissingOnClient<Score, LocalScore, ScorePresenceAllowList>
>;

// ─── Shape assertions ───
//
// Each `_*Mismatched` alias resolves to `never` when, for every shared
// field, the client type can hold any value the server might emit (or
// the narrowing is explicitly listed above). A failure here means an
// undeclared narrowing — the client type is strictly narrower than the
// server's, and would crash at runtime when the wider value lands.

type _MatchMismatched = AssertNever<
  ShapeMismatch<Match, LocalMatch, MatchNarrowedFields>
>;
type _PlayerMismatched = AssertNever<
  ShapeMismatch<Player, LocalPlayer, PlayerNarrowedFields>
>;
type _ProfileMismatched = AssertNever<
  ShapeMismatch<Profile, LocalProfile, ProfileNarrowedFields>
>;
type _ScoreMismatched = AssertNever<
  ShapeMismatch<Score, LocalScore, ScoreNarrowedFields>
>;

export type ModelDriftAssertions = [
  _MatchMissing,
  _PlayerMissing,
  _ProfileMissing,
  _ScoreMissing,
  _MatchMismatched,
  _PlayerMismatched,
  _ProfileMismatched,
  _ScoreMismatched,
];
