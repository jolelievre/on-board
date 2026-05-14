# OnBoard - Development Plan

> **OnBoard**: a play on words between "on board" (ready to go) and "board game"

Cross-platform PWA for tracking board game scores. Offline-first with multi-device sync, Google OAuth auth. Installable via a simple link (no app store needed).

Games to support: **7 Wonders Duel** (POC), **Skull King** (UX via Claude Design), and more to come.

---

## Tech Stack & Rationale

### Frontend: React 19 + Vite (SPA)

| Component | Choice | Rejected Alternative | Rationale |
|-----------|--------|---------------------|-----------|
| **UI Framework** | React 19 | Vue.js, Svelte | Largest ecosystem, excellent PWA/offline compatibility. Well-known by the developer. |
| **Bundler** | Vite | Webpack, Turbopack | Instant HMR, minimal config, mature PWA plugin (vite-plugin-pwa). The natural choice for a SPA in 2026. |
| **Architecture** | SPA (Single Page App) | Next.js (SSR/SSG) | **Key decision.** The app is offline-first: the HTML/JS/CSS shell must be 100% cacheable by the Service Worker. A SPA is naturally compatible with this constraint — the server only serves the API. Next.js would bring unnecessary SSR/SSG and complicate offline caching. Also, the birthday-party project already uses Next.js, so this is an opportunity to explore a different architecture. |
| **Routing** | TanStack Router | React Router | Type-safe by default, designed for SPAs, natively integrates with TanStack Query. React Router v7 merges with Remix and leans toward SSR, which is not our use case. |
| **Data fetching** | TanStack Query | SWR, custom hooks | Built-in client cache, optimistic mutations, automatic retry, stale-while-revalidate. Essential for offline experience: read from local cache then sync in background. |
| **Styling** | TailwindCSS | CSS Modules, styled-components | Fast iteration, utility-first, no CSS-in-JS runtime. Already mastered via birthday-party. |
| **i18n** | react-i18next | react-intl, LinguiJS | Most popular React i18n library, JSON catalogs, namespace support, lazy loading. Simple integration with TanStack Router. |

### Backend: Hono + PostgreSQL + Prisma

| Component | Choice | Rejected Alternative | Rationale |
|-----------|--------|---------------------|-----------|
| **API Server** | Hono | Express, Fastify, Next.js API routes | Native TypeScript framework, built on Web Standards (Request/Response), ultra-lightweight (~14KB). Serves the API AND the SPA static files → single process, single port (3000), single Docker container. Express is aging; Fastify is heavier; Next.js is overkill to serve a pure API. |
| **Auth** | better-auth | NextAuth (Auth.js) | Framework-agnostic (works with Hono natively), built-in Google OAuth, Prisma adapter, session management. NextAuth is tightly coupled to Next.js — possible with other frameworks but not natural. better-auth is the emerging choice for non-Next.js stacks. **Risk**: relatively new library — may need fallback to manual Google OAuth if we hit friction. |
| **ORM** | Prisma | Drizzle, Kysely, TypeORM | Declarative schema, reliable migrations, excellent TypeScript support. Already mastered via birthday-party. Drizzle would be a valid alternative (lighter, SQL-first) but Prisma offers better DX for a project with complex relations (Match → Players → Scores). |
| **Database** | PostgreSQL 16 | SQLite, MySQL | Robust, reliable, native JSON support. Same choice as birthday-party, same Coolify infra. SQLite would be simpler but doesn't support the concurrent connections needed for multi-device sync. |

### PWA & Offline

| Component | Choice | Rejected Alternative | Rationale |
|-----------|--------|---------------------|-----------|
| **Offline storage** | Dexie.js | idb-keyval, raw IndexedDB | Mature, well-typed IndexedDB wrapper. Relational API that mirrors Prisma entities on the server side. idb-keyval is too simple (key-value only) for our relational needs (Match → Players → Scores). |
| **Service Worker** | vite-plugin-pwa (Workbox) | Serwist, custom SW | Native Vite integration, auto-generates manifest and SW. Workbox is the reference for caching strategies (precache shell, network-first for API). Serwist is the alternative for Next.js App Router, not relevant here. |
| **Sync strategy** | Custom (Last-Write-Wins) | CRDTs, Firebase | Only one person scores at a time in practice → LWW is sufficient. No need for CRDT complexity. Firebase would add vendor lock-in and unnecessary cost for a personal/friends-only app. |

### Testing & Quality

| Component | Choice | Rejected Alternative | Rationale |
|-----------|--------|---------------------|-----------|
| **E2E Tests** | Playwright | Cypress, WebdriverIO | Native multi-browser (Chromium + WebKit), mobile mode, offline simulation (`context.setOffline()`), fast. Already mastered via birthday-party with Mobile Chrome + Mobile Safari patterns. |
| **Lint** | ESLint (flat config) | Biome | Ecosystem standard, rich plugin ecosystem. Biome is promising but its plugin ecosystem is still young. |
| **Type-check** | TypeScript strict | - | Non-negotiable. |

### Infrastructure & Deploy

| Component | Choice | Rejected Alternative | Rationale |
|-----------|--------|---------------------|-----------|
| **Deploy** | Docker + Coolify | Vercel, Netlify, fly.io | Existing self-hosted infrastructure. Same pattern as another project: preview/integration/production. No additional cost. |
| **CI/CD** | GitHub Actions | GitLab CI, CircleCI | Already in place on birthday-party, native GitHub integration. |

### Architecture Overview

```
┌─────────────────────────────────────────────┐
│  Browser (SPA)                              │
│  React + TanStack Router + TanStack Query   │
│  Dexie.js (IndexedDB) ←→ Sync Engine       │
│  Service Worker (Workbox)                   │
└──────────────┬──────────────────────────────┘
               │ HTTP API
               ▼
┌─────────────────────────────────────────────┐
│  Hono Server (port 3000)                    │
│  /api/* → API routes (auth, matches, sync)  │
│  /*     → SPA static files                  │
│  better-auth (Google OAuth, sessions)       │
│  Prisma ORM                                 │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  PostgreSQL 16                              │
└─────────────────────────────────────────────┘
```

Single process, single port, single Docker container.

---

## Phase 0: Project Bootstrap + Deployment ✅ DONE

**Goal**: Minimal working project, deployed on Coolify, pipeline validated end-to-end.

- [x] Vite + React 19 + TypeScript + TailwindCSS
- [x] Hono server with Vite middleware plugin (single process, single port)
- [x] Docker (compose + multi-stage Dockerfile)
- [x] PostgreSQL 16 (dev + test databases)
- [x] Prisma init (minimal schema)
- [x] ESLint flat config + Playwright config (Mobile Chrome + Mobile Safari)
- [x] CI/CD: `ci.yml` (lint + type-check + build + E2E on PR), `deploy-prod.yml` (release → Coolify API), `e2e-deployed.yml` (manual against deployed envs)
- [x] Coolify: integration (auto-deploy on main), preview (fixed URL on PR), production (deploy via API on release)
- [x] CLAUDE.md, PLAN.md, skills (frontend-design, create-pr)

---

## Phase 1: Auth + Data Model + i18n ✅ DONE

**Goal**: Google OAuth login, database schema, route structure, internationalization.

### Auth (better-auth)

- Google OAuth provider, Prisma adapter, Hono middleware
- Test mode: mock auth for E2E (test-only credentials provider, no real Google OAuth in CI)
- User profile: name, email, avatar (from Google), preferred language

### Data model (Prisma)

```
User
  - id, email, name, avatarUrl, locale
  - createdAt, updatedAt

Game (templates, seeded)
  - id, slug ("7-wonders-duel", "skull-king"), name, description
  - minPlayers, maxPlayers, iconUrl, config (Json)

Match
  - id, gameId, createdById (User), status (IN_PROGRESS / COMPLETED)
  - victoryType (nullable: "score", "military_supremacy", "scientific_supremacy")
  - winnerId (nullable, Player.id)
  - startedAt, completedAt

Player (per-match participant)
  - id, matchId, userId (nullable), name, position
  - @@unique([matchId, position])

Score
  - id, matchId, playerId, category (string), value (Int), metadata (Json)
  - @@unique([matchId, playerId, category])

LocalProfile (client-side only, stored in Dexie — not in Prisma)
  - id, name, avatarUrl, linkedUserId (nullable)
  - Reused across matches for player name autocomplete
```

### Player identity approach

- **Local profiles**: stored on the device (Dexie/IndexedDB), reusable across games. When creating a match, you type a name or pick from previous local profiles.
- **No account required for friends**: friends are just local profiles with a name.
- **Link later**: when a friend creates their own Google account, the match creator can search online profiles and link them to the local profile. Linked profiles get the friend's avatar and name updates. Shared matches become visible in both users' histories.

### i18n (react-i18next)

- JSON catalogs: `src/client/locales/en/common.json`, `src/client/locales/fr/common.json`
- Default language: English, available: English + French
- Language selector in user settings (stored in User.locale for logged-in users, localStorage for guests)
- All user-facing strings go through `t()` from day one — no hardcoded text
- Namespace-based organization: `common`, `games`, `scoring` (added as needed)

### Routes

**API**:
```
POST   /api/auth/*                  # better-auth handlers
GET    /api/games                   # List game templates
GET    /api/games/:slug             # Game details
POST   /api/matches                 # Create match
GET    /api/matches                 # Match history (filter by game)
GET    /api/matches/:id             # Match details + scores
PUT    /api/matches/:id             # Update (status, victoryType, winnerId)
POST   /api/matches/:id/scores      # Save scores
GET    /api/players/suggestions     # Autocomplete from past matches
```

**Client** (TanStack Router):
```
/                → Login (redirect to /games if authenticated)
/games           → Game list (home page)
/games/$slug     → Game detail + match history + new match button
/matches/$id     → Active match scoring
/settings        → User profile + language selector
```

### E2E

- `e2e/auth.spec.ts`: login, redirect, route protection
- `e2e/navigation.spec.ts`: navigate between pages
- `e2e/i18n.spec.ts`: language switch works

**Validation**: Google OAuth login works in dev, routes are protected, schema is applied, language switch works.

---

## Phase 2: 7 Wonders Duel — POC ✅ DONE

**Goal**: Functional scoring with a clean look inspired by the physical score grid.

### Score categories (2 players)

1. `military` — Military conflicts (0-9 pts, or instant victory)
2. `treasury` — Coins (1 VP per 3 coins)
3. `wonders` — Wonder points
4. `civil` — Blue card points
5. `scientific` — Green card points (+ set bonuses)
6. `commercial` — Yellow card points
7. `guilds` — Purple card points

### Features

- Game template seeded in DB with slug `7-wonders-duel`
- New match: enter 2 player names (autocomplete from local profiles)
- Score form: grid inspired by the physical score sheet (2 columns × 7 category rows, color-coded)
- Auto-calculated totals per player
- Special victories: military supremacy, scientific supremacy (closes the match immediately with victoryType + winnerId)
- Save scores → persist in DB
- Match history: list of completed matches with totals, winner, victory type
- Reasonable default styling using TailwindCSS (will be refined in Phase 3)

### E2E

- `e2e/seven-wonders.spec.ts`: create match, enter scores, verify totals, special victory, complete match, verify history

**Validation**: full flow from creating a match to seeing it in history.

---

## Phase 3: Claude Design — Branding + UX + Implementation

**Goal**: Visual identity, UX patterns, and implementation across all existing and planned screens.

### Step 1: Prepare design brief

Write a detailed brief for Claude Design including:
- Project purpose and target audience (friends around a table, mobile-first)
- Screenshots of the Phase 2 POC
- The 7 Wonders Duel physical score grid image (from plan-assets)
- Skull King rules and round-by-round flow description
- Requirements: PWA indicators (offline, sync, install), language switcher
- Screens to design: login, game list (home), game detail/history, 7WD scoring, Skull King scoring (round flow, bid/trick/bonus, scoreboard), settings, match summary

### Step 2: Claude Design session

- Logo "OnBoard", color palette, typography
- Mobile-first design system (buttons, cards, inputs, navigation)
- All screens listed above

### Step 3: Implementation

- Custom Tailwind theme (colors, fonts, spacing from design)
- Reusable UI components in `src/client/components/ui/`
- PWA manifest (`public/manifest.json`) + app icons
- Mobile layout: header + bottom navigation bar
- Restyle all existing pages (login, game list, 7WD scoring, settings) per design
- `index.html`: meta tags, theme-color, icons

**Validation**: app matches the design, installable on mobile (manifest present).

---

## Phase 4: Skull King

**Goal**: Full scoring with both variants (Classic + Rascal), using the design from Phase 3.

### Scoring rules — Classic

- 2-8 players, 10 rounds (round N = N cards dealt)
- Per round: bid (before) + tricks won (after) + bonus captures
- Bid = 0, correct: **+10 × N**
- Bid = 0, incorrect: **-10 × N**
- Bid > 0, correct: **+20 × bid**
- Bid > 0, incorrect: **-10 × |bid - tricks|**
- Bonuses: pirates captured by Skull King (+30), mermaids by pirates (+20), Skull King by mermaid (+40), black 14 (+20), colored 14 (+10)

### Scoring rules — Rascal variant

- Potential per round = 10 × N
- Direct hit (exact bid): 100% of potential
- Ricochet (off by 1): 50% of potential
- Miss (off by 2+): 0 points
- Optional Cannonball: potential = 15 × N if correct, 0 if wrong

### Data model

- Score `category = "round_1"` through `"round_10"`
- `metadata` Json: `{ bid, tricks, bonus, bonusDetails[] }`
- `value` = calculated score for the round

### UX flow (from Claude Design)

- Round-by-round progression with round indicator
- Per-player bid entry at start of round
- Per-player trick count + bonus selection at end of round
- Running score table visible throughout
- Variant switcher (Classic / Rascal)

### Shared scoring logic

- `src/shared/scoring/skull-king.ts`: calculation for both variants (shared between client and server)

### E2E

- `e2e/skull-king.spec.ts`: full 10-round game, both variants, bonus captures, score verification

**Validation**: complete Skull King game, correct scores in both variants.

---

## Phase 5: Offline-first + PWA

**Goal**: Works offline, syncs when back online, installable as an app.

### What this phase adds

- **App shell caching**: Service Worker caches the SPA (HTML/JS/CSS) so the app loads without internet
- **Offline data**: Dexie.js stores matches, players, scores locally in IndexedDB so you can use the app without internet
- **Background sync**: queued writes are pushed to the server when connectivity returns
- **Install prompt**: PWA is installable from the browser (Add to Home Screen)

Both are implemented together — caching the shell without offline data would show an empty app, which isn't useful.

### Stack

- **Dexie.js**: local IndexedDB mirror of server entities (Match, Player, Score, LocalProfile)
- **vite-plugin-pwa (Workbox)**: precache SPA shell, network-first strategy for API
- **Background Sync API**: queue writes made offline

### Sync strategy (Last-Write-Wins)

- Every record has `updatedAt` timestamp
- Client tracks `lastSyncedAt` per entity type
- On sync: push local changes → pull server changes since `lastSyncedAt`
- Conflict: server timestamp wins (one scorer at a time in practice)

### Key files

- `src/client/lib/db.ts` — Dexie schema (mirrors Prisma models client-side)
- `src/client/lib/sync.ts` — sync engine (push/pull/conflict resolution)
- `src/client/hooks/useOnlineStatus.ts` — online/offline detection
- `src/client/hooks/useSyncStatus.ts` — pending changes indicator
- `src/server/routes/sync.ts` — server-side sync endpoint
- `vite.config.ts` — vite-plugin-pwa configuration

### E2E

- Test offline mode: `context.setOffline(true)` in Playwright
- Verify data persists in IndexedDB when offline
- Verify sync on reconnect
- Verify PWA install prompt

**Validation**: score a game offline, reconnect, data syncs. App installable on Android/iOS.

---

## Phase 5b: Complete offline-first

**Status (2026-05-14)**: First attempt closed without merge (PR #11 abandoned). The original three-layer architecture (server + TanStack Query cache + partial Dexie tables) proved to keep producing cascading bugs. Orthogonal improvements that survive the new design were cherry-picked to `main` via the `stabilize/cherry-picks` PR (#12). The actual offline match flow is being rebuilt as **Phase 5c** below.

### Shipped via stabilize/cherry-picks (the parts that survived)

- **Offline auth fallback** — `useAuthSession` keys the cached-session fallback on better-auth's fetch `error`, not `navigator.onLine`. Captive portals, VPN drops, DevTools "Offline" throttling, and OS-level WiFi off all converge to the same behavior. (`src/client/hooks/useAuthSession.ts`, `e2e/offline.spec.ts` Auth section)
- **Login redirect always uses cached session** — `routes/index.tsx` drops the `isOfflineFallback` guard; the protected layout owns the offline UX.
- **Player suggestions three-tier resolution** — `usePlayerSuggestions` synthesizes the self entry from the auth session, merges with the server response (server's `isSelf` row wins on alias collisions), falls back to Dexie `localProfiles`. `persistPlayersToLocalProfiles` stamps `isSelf` based on `userId`, never on name equality. (`src/client/hooks/usePlayerSuggestions.ts`)
- **SW prompt mode + UpdateBanner** — `vite-plugin-pwa` switched from `autoUpdate` to `prompt`; `UpdateBanner` (mounted in `__root.tsx`) surfaces "New version available — Reload". Eliminates the stale-precache window observed during PR #8 testing. (`vite.config.ts`, `src/client/components/layout/UpdateBanner.tsx`, `src/client/main.tsx`)
- **Server returns full match shape from POST** — `/api/matches` create response now includes the full record so clients can mirror it without a follow-up GET. (`src/server/routes/matches.ts`)
- **Server includes `game.id` in matches list response** — aligns the list shape with the detail shape; required by Phase 5c's pull-sync. (`src/server/routes/matches.ts`)
- **`RESET_DB` deploy toggle** — set `RESET_DB=true` in Coolify env to wipe + reseed preview/integration on next deploy. Hard-blocked on production. `--skip-generate` flag prevents the post-reset Prisma client regeneration from failing on a root-owned filesystem. (`scripts/entrypoint.sh`, `CLAUDE.md` Deployment section)

### Scrapped from PR #11 (replaced by Phase 5c)

- **`matchDrafts` flow** (`createDraftMatch`, synthetic Match with `draft_<uuid>` ID, queued POST with `draftId`+`draftPlayerId`, post-flush id rewriting in `syncEngine`, `SYNC_DRAFTS_RESOLVED_EVENT`) — replaced by client-generated CUIDs that don't need reconciliation.
- **Match-detail cache hydration via prefetch** (`usePrefetchGames` seeding `["matches", id]` from list responses) — replaced by Dexie + `useLiveQuery` reads in Phase 5c.

### Bugs that prompted the rebuild (PR #11 device testing)

- Duplicate matches on reconnect (often 3 copies of the same match)
- "Sauvegarde…" save-status indicator stuck visibly while offline
- Optimistic scores disappearing on navigate-away-back
- Blank match-detail page after `invalidateQueries`, requiring a manual scroll/refresh
- Apparent cross-match data contamination after sync replay

Each traces back to the three-layer architecture: TanStack Query's localStorage-persisted cache was the de facto source of truth while only *part* of the offline data lived in Dexie. Mutations had to write to both layers; `setQueryData` and `syncEngine.enqueue` could disagree; and the `draft_xxx → realId` substitution in `sync.ts` added another coordination point. Phase 5c collapses to two layers (server + full Dexie mirror) where Dexie is the single client-side source of truth.

### Follow-ups still on the radar

- **SW interception under Chrome DevTools "Offline" throttling** — during PR #11 validation, a tab whose `navigator.serviceWorker.controller` was set still fell through to Chrome's native offline page when the Network panel was switched to Offline, with no `(ServiceWorker)` annotations on any request. OS-level WiFi-off worked fine in the same session, and the Playwright suite (CDP `setOffline`) passes. Hypotheses: (a) Chrome state corruption from hard-reloads in the same session — try a clean profile or different device first; (b) real config gap — most likely candidate is adding `clientsClaim: true` to the workbox config; (c) existing offline E2E suite doesn't exercise a cold-load offline document fetch — worth adding a Playwright test that does `setOffline(true)` then `page.reload()` against a production build to pin `navigateFallback`.
- **Font precache miss observed during PR #8** — if it reappears after the SW update flow is in production, add the woff2 URLs to `runtimeCaching` with `CacheFirst` as a backstop.

---

## Phase 5c: Local-first refactor (server + Dexie)

**Goal**: Replace the failed three-layer architecture (server + TanStack Query cache + partial Dexie tables) with a two-layer **local-first** design: server is the cross-device source of truth, Dexie is the local source of truth, UI reads exclusively from Dexie via `useLiveQuery`, every user action writes to Dexie first and queues a server sync.

**Absorbs the former Phase 5d (GameClient abstraction).** The generic match-client originally proposed in 5d is fulfilled by `src/client/lib/mutations.ts` below. Of the original 5d scope, only the per-game payload builders remain as a small extraction (folded into PR B at `src/client/lib/match-client/{seven-wonders,skull-king}.ts`). What disappears entirely: draft detection (no draft IDs exist), online vs offline routing (mutations.ts always writes to Dexie; the sync engine handles online vs offline transparently), optimistic cache writes (the Dexie row IS the source of truth), `saveStatus` lifecycle (replaced by the global `SyncStatus` driven by `db.syncQueue` count), and per-mutation cache invalidation (`useLiveQuery` rerenders automatically; `pullSync` after `flush` replaces `invalidateQueries`).

**Why**: the three-layer approach has produced cascading bugs (see Phase 5b "Bugs that prompted the rebuild"). The root cause is leaky abstractions between layers — TanStack Query's cache becoming the de facto source of truth while only part of the data lived in Dexie meant every mutation had to coordinate both layers. The local-first pattern (used by Replicache, RxDB, WatermelonDB, Linear, etc.) collapses this to a single client-side source of truth.

### Architecture summary

**Two layers:**
- **Server** — canonical store, source of truth across devices.
- **Dexie** — full local mirror of `games`, `matches`, `players`, `scores`. UI reads exclusively from Dexie.

**ID strategy:** client generates CUIDs upfront for every new record. The server accepts client-supplied IDs and treats `POST` as upsert (idempotent by ID, scoped to the authenticated user). The "draft_" prefix and the entire draft↔real reconciliation mechanism go away.

**Writes (local-first):** every user action atomically writes the row to Dexie and adds a sync queue entry inside the same Dexie transaction. UI re-renders immediately because reads are reactive. `syncEngine.flush()` fires fire-and-forget after every write; no-ops when offline.

**Reads (reactive):** read hooks use Dexie's `useLiveQuery` (from `dexie-react-hooks`). Any write — local OR pulled from server — triggers an automatic re-render. No `setQueryData`, no `invalidateQueries`.

**Sync (push + pull):**
- *Push* — reuse the existing `db.syncQueue` + FIFO replay loop in `src/client/lib/sync.ts`. Strip out `substitute`, `maybeRecordDraftMapping`, `reconcileDrafts`, and the `SYNC_DRAFTS_RESOLVED_EVENT` dispatch. On flush success: call `pullSync()` instead of `queryClient.invalidateQueries()`.
- *Pull* — new `src/client/lib/pull-sync.ts`. Calls `GET /api/matches?since={syncMeta.lastPullAt}` + `GET /api/games`. Merges into Dexie row-by-row with Last-Write-Wins on `updatedAt`. Triggers: (a) once after auth ready on app mount, (b) after every successful `flush()`, (c) on `online` event, (d) on a soft 60s interval while a match is open.
- *Conflict resolution* — LWW at row granularity using `updatedAt`. The product constraint "one device editing a given match at a time" makes same-row conflicts rare.
- *Deletes* — no client-initiated deletes exist today; tombstone design deferred.

**SyncStatus indicator (global, bound to the sync client):** `syncEngine.useStatus()` returns `"idle" | "saving" | "offline" | "saved"`. Internally implemented over `useLiveQuery(db.syncQueue.where("status").equals("pending").count())` + `useOnlineStatus()` + a 1.2s "saved" debounce. The `SyncStatus` component just calls `syncEngine.useStatus()` and renders. Mounted globally from `__root.tsx` next to `OfflineBanner` / `UpdateBanner`. Independent of any scorer screen. Both scorers stop owning `saveStatus` state and the `onSaveStatusChange` prop plumbing is removed.

### Dexie schema (v2)

Replace `src/client/lib/db.ts`. Schema version 1 → 2; the upgrader drops `matchDrafts` and any `syncQueue` rows whose URL contains `draft_` (orphaned from old clients on the abandoned PR #11 branch).

```
games:        "id, slug"
matches:      "id, gameId, status, startedAt, updatedAt, [createdById+startedAt]"
players:      "id, matchId, [matchId+position]"
scores:       "id, matchId, [matchId+playerId+category], updatedAt"
localProfiles:"name, usedAt, linkedUserId"        // unchanged
syncQueue:    "++id, createdAt, status"           // status: "pending"|"failed"
syncMeta:     "key"                                // singleton rows
```

Each row mirrors the corresponding server payload (`Match`, `Player`, `Score` from `src/client/types/match.ts`) plus a local `updatedAt: ISO string`. `match.game` is **derived** at read time by joining `db.games`, not denormalized.

### Phasing — 3 PRs

#### PR A — Server idempotency on client-generated IDs (`feat/server-client-ids`, ~half day)

**Goal**: accept client-generated CUIDs on `POST /api/matches`; add `updatedAt` columns; add `?since=` filter for pull-sync.

**Changes**:
- `prisma/schema.prisma` — add `updatedAt DateTime @updatedAt` to `Match`, `Player`, `Score`. Migration: `npx prisma migrate dev --name add_updated_at`.
- `src/server/routes/matches.ts`:
  - `POST /` accepts optional `id` and per-player `id`. Validate format (CUID-shaped). Do `findUnique({ where: { id } })` first → return 403 if the row exists and belongs to another user. Otherwise `prisma.match.upsert(...)` (or `create` if no `id` provided). Returns 200 on upsert hit, 201 on create.
  - `GET /` accepts `?since=` ISO timestamp query param; filters by `updatedAt > since`. Without it, returns all of the user's matches as before.
- `e2e/api/matches.spec.ts`:
  - POST with explicit `id` twice → 200 second time, single row in DB.
  - POST with `id` belonging to another user → 403.
  - GET with `?since=` after a known update → only the updated rows.

**Acceptance**: backwards-compatible (current production clients keep working without `id`). `npm test` clean.

**Verification**: `curl -X POST /api/matches` twice with the same `{ id, gameId, players }` → no duplicate row in `psql`.

#### PR B — Full local-first refactor (`feat/local-first-architecture`, ~2-3 days)

**Goal**: switch the client to Dexie as the source of truth. Drop draft-id reconciliation. Make all scorer flows hit `mutations.ts` instead of `setQueryData` + `syncEngine.enqueue`.

**Requires**: PR A in production.

**Changes**:
- **`src/client/lib/db.ts`** — schema v2 with upgrader. Drops `matchDrafts`; adds `games`, `matches`, `players`, `scores`, `syncMeta` tables. One-time production data migration in the upgrader: read `localStorage["onboard_query_cache"]` if present, hydrate `db.matches/players/scores` from any `["matches", id]` and `["games", slug]` entries, then delete the localStorage key. Worst case (no migration data): `pullSync` repopulates from server on first online action.
- **`src/client/lib/sync.ts`** — strip `substitute`, `maybeRecordDraftMapping`, `reconcileDrafts`, `SYNC_DRAFTS_RESOLVED_EVENT`. Add `useStatus()` reactive hook. On `flush()` success, call `pullSync()` instead of `queryClient.invalidateQueries()`. Keep the retry/backoff loop and 401/403 permanent-fail handling.
- **`src/client/lib/mutations.ts`** (NEW) — `createMatch`, `upsertScores`, `patchMatch`, `completeMatch`. Each opens a Dexie transaction over the affected tables + `syncQueue`, writes the row(s), enqueues, fires `syncEngine.flush()` (no-op offline). Returns the matchId (always a real CUID).
- **`src/client/lib/pull-sync.ts`** (NEW) — `pullSync()` + `syncMeta` cursor helpers. Calls `GET /api/matches?since={lastPullAt}` + `GET /api/games`. Merges into Dexie row-by-row LWW on `updatedAt`. Updates `syncMeta.lastPullAt`.
- **`src/client/lib/match-client/`** (NEW directory — former Phase 5d remnant; per-game payload builders) — `seven-wonders.ts` (`buildScorePayload(values)`), `skull-king.ts` (`buildScorePayload(round, entries)`, `buildPersistDraftPatch(...)`). Pure functions.
- **`src/client/hooks/data/`** (NEW directory) — `useMatch.ts`, `useMatchList.ts`, `useGame.ts`, `useGames.ts`. Each backed by `useLiveQuery`. Return `{ data, status: "loading" | "ok" | "missing" }`.
- **`src/client/components/sync/SyncStatus.tsx`** (NEW) — calls `syncEngine.useStatus()` and renders. Mounted from `__root.tsx` near `OfflineBanner` / `UpdateBanner`.
- **`src/client/main.tsx`** — drop `persistQueryClient` subscribe + hydrate. TanStack Query stays only for `authClient.useSession`.
- **`src/client/hooks/usePrefetchGames.ts`** → renamed `usePullOnAuth` and reduced to: on session ready, call `pullSync()` once. No more `setQueryData` seeding.
- **`src/client/routes/_authenticated/matches/$id.tsx`** — drop `useQuery`, drop draft-redirect effect, drop `SYNC_DRAFTS_RESOLVED_EVENT` listener; use `useMatch(id)`.
- **`src/client/routes/_authenticated/games/$slug.tsx`** — replace both `useQuery`s with `useGame(slug)` + `useMatchList(gameId)`.
- **`src/client/routes/_authenticated/games/$slug_.new.tsx`** — drop `useMutation` + draft fallback path; call `mutations.createMatch(input)`; navigate to the returned matchId (always a real CUID, never `draft_…`).
- **`src/client/components/scoring/SevenWondersDuelScorer.tsx`** — replace 4 `setQueryData` sites + `applyScoresOptimistically` closure with `mutations.upsertScores` / `mutations.completeMatch` / `mutations.patchMatch` calls; delete the `isDraft` branch entirely. Drop `onSaveStatusChange` prop.
- **`src/client/components/scoring/skull-king/SkullKingScorer.tsx`** — same shape: 5 `setQueryData` sites collapse to `mutations.*` calls; `applyMatchPatchOptimistically` deleted; `onSaveStatusChange` prop removed.
- **`e2e/offline.spec.ts`** — adapt assertions (no `draft_` in URLs). Add: full offline create + score + reload-while-offline + reconnect → match present in history, scores intact, no server duplicates, URL never contained `draft_`. Add: two-tab same-user live updates via `useLiveQuery`.

**Acceptance**:
- All existing E2E specs pass (adapted).
- New specs pass.
- Manual on a real device (OS-level WiFi off, NOT DevTools throttling — see Phase 5b follow-up about DevTools throttling reliability):
  1. Online: create a match, score a round → DevTools → IndexedDB shows the score row.
  2. WiFi off; score 3 more rounds, complete the match → UI updates instantly each time.
  3. Force-kill app, reopen → match present, scores intact, queue still pending in `db.syncQueue`.
  4. WiFi on → `SyncStatus` cycles "offline" → "saving" → "saved" → "idle" within ~2s.
  5. `psql`: one match row, correct scores, no duplicates.
  6. Open same account on a second device → match appears within first `pullSync` after login.
- All five known bad scenarios from PR #11 testing (duplicate matches, stuck "Sauvegarde", scores disappearing on nav-away, blank detail page, cross-match contamination) — none should reproduce.

#### PR C — Cleanup (`chore/drop-tanstack-cache`, ~half day)

**Goal**: dead-code removal after PR B has soaked in production.

**Changes**:
- Remove `@tanstack/react-query-persist-client` + `@tanstack/query-sync-storage-persister` from `package.json`. `npm install`.
- Delete `usePullOnAuth` if its single call site can be inlined into `__root.tsx`.
- `rg "setQueryData|invalidateQueries" src/client` — must return nothing in app code (test files OK).
- Tighten types now that no string contains a `draft_` prefix.
- Final `PLAN.md` update: mark Phase 5c as shipped; ensure Phase 5d (Users as first-class) still reads correctly against the post-refactor architecture.

**Acceptance**: `npm run build` reports a smaller bundle. E2E suite still passes.

### Risks and unknowns

- **Same-row concurrent edits across devices** (rare per product constraint): LWW silently loses the loser's edit. Mitigation: at flush time, if the server's `updatedAt` for a row is newer than the local edit's, surface a banner. Probably v2; document as known gap.
- **Cold-load bandwidth** (new device, fresh login): full match history pull. ~600 KB gzipped per 200 matches; fine for v1. Revisit at 1000+ matches with pagination.
- **ID squatting**: addressed in PR A via explicit `findUnique` + ownership check before `upsert`.
- **Production data migration**: handled in the Dexie upgrader, runs once. Worst case `pullSync` rehydrates from server.
- **Service worker interaction**: orthogonal — the SW continues to serve the SPA shell and precached assets; nothing about local-first changes SW responsibilities.

---

## Phase 5d: Users as first-class entities

**Goal**: Replace name-based unregistered-player references with proper `User` entities, owned by their creator until linked to an auth account.

**Position in the roadmap**: lands **after** Phase 5c (Local-first refactor) completes. The refactor simplifies 5d by removing the need for sync-engine id substitution; everything else in 5d remains in scope.

**Why before more games or features**:
- Today's name-only matching is unstable (case/typo collisions, same-name friends)
- The link-friend-account feature in Phase 6 needs a stable cross-match reference
- Phase 7 (Skull King Rascal) and future games add complexity to the per-game data layer; better to lock the user model first

### Design intent (preserved from the 2026-05-07 conversation)

- The `Player` table becomes an association of Match to Users; `userId` is no longer optional, all players are actual Users.
- For local-only Users: created by the app owner, saved in the **local AND server DB** (so they can be refetched on other devices). They remain unidentified Users as long as no Account is connected to them.
- As long as no actual Account is linked to them, they are only known by the User who created them.
- They can now be used to find matches where one User was involved (more stable than name matching).
- We will be able to list our own users and reuse them for future matches, avoiding name duplication that doesn't guarantee we're talking about the same person.
- They will be the reference point for the future feature to match "My users" to "Existing user" (Phase 6 link-to-account).

### Open design questions to resolve at implementation time

1. **Schema shape**: extend the existing `User` table with `ownerId String?` + nullable `email` + a `claimed Boolean`, OR introduce a separate `Profile` / `UnclaimedUser` table that linked Users reference. Better-auth wants `email` unique + non-null on `User` — both options have implications for the auth flow and migrations.
2. **Server visibility boundary**: an unclaimed user is visible only to its `ownerId`. When linked to a real auth account, ownership is dropped and they become globally addressable subject to the privacy model. The `/api/players/suggestions` endpoint becomes `/api/users` filtered by `ownerId = me OR user appears in any match I created`.
3. **Offline creation of unclaimed users** — *simplified by Phase 5c*: with client-generated CUIDs across the board, creating an unclaimed user offline becomes two enqueued writes (POST `/api/users` then POST `/api/matches`), both referencing the same client CUID. No sync-engine id substitution map is needed. If the `/api/matches` POST fires before the `/api/users` POST has succeeded server-side, the server returns 404; the entry stays in the queue and resolves on the next flush.
4. **Migration**: every existing Player without `userId` → create a User per `(creator, distinct case-insensitive name)` tuple, attribute `Player.userId`, retain the original name on Player as a migration audit trail (or move it to `User.alias`). Reversibility via the audit trail.
5. **Auth integration / claiming**: how does an unclaimed User become claimed? Options: (a) on Google sign-in, if email matches an unclaimed User any creator owns, prompt the new auth user to claim it; (b) the creator explicitly invites via email link; (c) deferred to Phase 6.
6. **First-launch UX**: a brand-new authenticated user has no owned-users pool. The "self" entry in suggestions is them; the next entries come from creating new owned users inline as they type names in the new-match form.
7. **Offline reads of the user list** — *simplified by Phase 5c*: users become another Dexie-mirrored table with `useLiveQuery`-backed reads, just like matches/players/scores. No separate persisted-cache concern.

### Files likely affected

- `prisma/schema.prisma` — schema change + migration
- `src/server/routes/users.ts` (new) — list/create/patch + suggestions filter
- `src/server/routes/matches.ts` — Player creation now references existing User; reject names without matching User
- `src/server/routes/players.ts` — collapsed into users or removed
- `src/client/lib/mutations.ts` — add `createUser`, `patchUser` (slots into the Phase 5c mutations module)
- `src/client/hooks/data/useUser.ts` (new) — `useLiveQuery` over `db.users`
- `src/client/hooks/usePlayerSuggestions.ts` → `useUserSuggestions` or `useOwnedUsers`, reads from `db.users`
- `src/client/routes/_authenticated/games/$slug_.new.tsx` — autocomplete from owned users; "create new user" inline
- `src/client/routes/_authenticated/users/` (new section?) — manage owned users
- `src/client/lib/db.ts` — add `users` Dexie table; revisit `localProfiles`

### Validation

- Existing match flows (create, score, complete) keep working with the new model
- A friend with the same name as the logged-in user no longer collides on suggestions
- Migration is reversible for at least one rollback window
- Offline-created user → match references that user → flush replays both POSTs in order, server creates both with the client-supplied CUIDs

---

## Phase 6: Polish + Distribution

**Goal**: Smooth experience, ready to share with friends.

- Real-time sync indicator in UI (synced / pending / error)
- Player autocomplete from local profiles + linked online profiles
- Match history filters (by game, player, date)
- Basic statistics (win rates, average scores per game)
- Lighthouse PWA audit (must pass all PWA criteria)
- Installation help page (accessible without auth, explains how to install on Android/iOS)
- Link-to-account feature: link local profiles to friends' Google accounts
- v1.0.0 release → production deploy

**Validation**: Lighthouse PWA score 100, friends can install and use the app.

---

## Phase 7: Skull King — Rascal Variant

**Goal**: Complete the Phase 4 scope by adding the Rascal variant alongside Classic.

### Scoring rules — Rascal

- Potential per round = 10 × N
- Direct hit (exact bid): 100% of potential
- Ricochet (off by 1): 50% of potential
- Miss (off by 2+): 0 points
- Optional Cannonball: potential = 15 × N if bid is correct, 0 if wrong
- Bonuses (pirates captured by Skull King, etc.) still apply on top

### What to build

- `src/shared/scoring/skull-king.ts`: add Rascal calculation alongside Classic
- `MatchStartScreen`: variant switcher (Classic / Rascal), stored in `Match.metadata`
- `RoundResultScreen`: conditional Cannonball toggle when Rascal is active
- `SkullKingScorer`: read variant from metadata, pass it down to scoring logic
- Draft persistence already stores metadata — variant just rides along

### E2E

- `e2e/skull-king.spec.ts`: Rascal full game (direct hit, ricochet, miss, Cannonball on/off, score verification)

**Validation**: complete Skull King game in both variants with correct scores.
