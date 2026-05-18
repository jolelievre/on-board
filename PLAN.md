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

## Phase 5c: Local-first refactor (server + Dexie) — **shipped**

**Status (2026-05-17)**: all three PRs merged. PR A (`feat/server-client-ids`, #16) shipped client-CUID idempotency. PR B (`feat/local-first-architecture`, #18) shipped the Dexie source-of-truth + `useLiveQuery` reads + push/pull sync. PR C (`chore/drop-tanstack-cache`, this PR) removed the persist deps, dropped `@tanstack/react-query` entirely (no app code consumed it after `usePlayerSuggestions` was migrated to `useLiveQuery`), inlined `usePullOnAuth` into `_authenticated.tsx`, and stripped the one-shot `onboard_query_cache` localStorage hydration that targeted users of the abandoned PR #11 branch (no production user ever wrote that key).

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

## Phase 6: Profiles, Players tab, Avatars, Link-to-account

**Goal**: Replace name-based player references with a real domain entity (`Profile`), add a top-level "Players" section in the bottom nav to manage friends, ship avatar upload + display everywhere people are shown, deliver the QR-based account-linking flow, and land the small extras that ride on Profile (played-with suggestions, favorite groups, profile detail with basic stats, unlink, profile merge).

**Position in the roadmap**: lands **after** Phase 5c (Local-first refactor). Phase 5c removed the sync-engine id substitution problem, so the per-record creation flow here is straightforward (two queued POSTs with client-generated CUIDs).

**Why bundle 5d-style refactor with the linkable parts of the old Phase 6**:
- Today's name-only matching is unstable (case/typo collisions, same-name friends).
- The link-friend-account feature needs a stable cross-match reference; shipping it without a Profile entity isn't possible.
- Shipping Profiles without the link feature wastes the refactor's most interesting payoff.
- Skull King Rascal (Phase 8) and future games add complexity to the per-game data layer; better to lock the person model first.

This phase is the first user-visible "social" layer of the app: a friend list, retroactive history-sharing on link, and avatars as a fun + functional identification cue.

### Entity map

| Entity | Role after this phase | Notes |
|---|---|---|
| **`User`** | **Unchanged.** Auth account owned by better-auth (`email` unique non-null, OAuth tokens via `Account`). | Internal — never directly referenced from `Player` after this phase. |
| **`Account`, `Session`, `Verification`** | Unchanged better-auth plumbing. | Hidden from users. |
| **`Profile`** *(new)* | The **person** as the app sees them. Every Player participation, every avatar, every player suggestion goes through Profile. | Single domain entity for "Jonathan", whether or not he has signed in to OnBoard. |
| **`Player`** | Match participation row only: `id, matchId, profileId, position, updatedAt`. `userId` and `name` snapshot are **removed**. | Display name resolves through `Profile`. |
| **`LocalProfile`** (Dexie) | **Removed.** Replaced by a `profiles` Dexie table mirroring the server. | Drop on Dexie v3 upgrade. |
| **`ProfileGroup`, `ProfileGroupMember`** *(new)* | Saved player groupings (e.g. "Wednesday Skull King crew"). | One-tap fills new-match form. |

### `Profile` schema (Prisma)

```
Profile
  id              String   @id @default(cuid())
  ownerId         String                              // always set; the User who created this Profile
  linkedUserId    String?  @unique                    // set when bound to an auth account
  alias           String                              // primary display name in the app
  customAvatarUrl String?                             // owner-uploaded avatar
  useLinkedAvatar Boolean  @default(true)             // when linked: prefer linkedUser.avatarUrl over customAvatarUrl
  usedAt          DateTime @default(now())            // denormalized; bumped on each match create
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  owner       User      @relation("ProfileOwner",  fields: [ownerId],      references: [id], onDelete: Cascade)
  linkedUser  User?     @relation("ProfileLinked", fields: [linkedUserId], references: [id], onDelete: SetNull)
  players     Player[]
  groups      ProfileGroupMember[]

  @@index([ownerId])
  @@index([linkedUserId])
```

`linkedUserId` is `@unique` to enforce one Profile per (owner, linked user) pair at the row level — collisions during a link attempt are resolved by merging (see below), not by rejection.

### State machine

- **Unclaimed**: `ownerId` set, `linkedUserId = null`. Visible to owner only. Owner edits alias/avatar freely.
- **Linked**: `ownerId` set, `linkedUserId` set. Visible to **both** owner and linked user. `ownerId` is preserved (no transfer-on-link). Owner still edits the *display* fields (`alias`, `customAvatarUrl`, `useLinkedAvatar`); the linked friend's own `User.avatarUrl` / `User.name` remain untouchable by the owner.
- **Self**: every authenticated User auto-gets a Profile with `ownerId = self.id, linkedUserId = self.id`. That's how "you" appear in suggestion lists.
- **Unlink** (either side): clears `linkedUserId`; Profile reverts to unclaimed under the original owner.

### Avatar resolution

For a viewer V looking at Profile P:
1. If V is the **linked user** (`linkedUserId = V`): show `linkedUser.avatarUrl` (canonical, owned by the friend).
2. Else if V is the **owner** (`ownerId = V`):
   - If `linkedUserId` is set and `useLinkedAvatar` is true: show `linkedUser.avatarUrl`.
   - Else if `customAvatarUrl` is set: show owner's upload.
   - Else: initial-letter fallback (existing `AVATAR_CLASSES` palette).
3. Else (third-party viewer, future): show `linkedUser.avatarUrl` if linked, else initial fallback.

Toggling `useLinkedAvatar` doesn't delete `customAvatarUrl`. Explicit "delete custom avatar" is a separate action.

### `Player` row evolution

```
Player
  id         String   @id @default(cuid())
  matchId    String
  profileId  String?                         // NEW: nullable initially; backfilled and populated for all rows
  userId     String?                         // legacy, kept dormant; populated alongside profileId
  name       String                          // legacy, kept dormant; populated alongside profileId
  position   Int
  updatedAt  DateTime @updatedAt
  // @@unique([matchId, position]) preserved
```

`Player.userId` and `Player.name` are **kept** as dormant legacy columns throughout this phase — the server writes them alongside `Player.profileId` on every create, and clients fall back to `Player.name` for display when `profileId` is unexpectedly null. This makes every PR in the phase independently shippable without a backward-incompatibility window. The optional cleanup PR 6-E drops them after a soak period.

The 6-A migration creates a Profile per `(createdById, lower(trim(name)))` tuple; creates a linked Profile when `Player.userId` was set; creates one self-Profile per User; backfills `Player.profileId` for every existing row.

### QR link/unlink workflow

**Direction**: friend shows QR, owner scans. The friend authoritatively proves "I am this Google account"; the owner authoritatively decides which of their local profiles maps to this person.

**Flow** (owner = A, friend = B):

1. A opens Players tab → taps Profile P (currently unclaimed) → "Link to a Google account".
2. A's app opens the camera (reusing the `useCamera` hook). Scanner mode.
3. B, on their phone (logged into OnBoard), opens Settings → "Show my link code" (or Players tab → tap their own self-Profile → "Generate link code").
4. B's app POSTs `/api/profiles/link-token` → server returns a short-lived signed token (HMAC-SHA256 of `{userId, exp}` with `BETTER_AUTH_SECRET`, ~60s TTL). Token rendered as QR (`qrcode` lib).
5. A's app scans → POSTs `/api/profiles/:profileId/link` with `{ token }`. Server:
   - Verifies HMAC + expiry.
   - Looks up `existing = Profile WHERE ownerId = A AND linkedUserId = token.userId` (excluding the target Profile P itself).
   - **No `existing`** → sets `Profile.linkedUserId = token.userId`, bumps `updatedAt`, returns `{ status: "linked", profile }`.
   - **`existing` found** → returns `{ status: "merge_required", existing: { id, alias }, target: { id, alias } }` (HTTP 200, not 409 — this is a normal branch of the flow, not an error). No mutation performed.
6. **Merge branch**: A's app shows a confirmation dialog: *"You already have a profile linked to this friend named «existing.alias». Merge «target.alias» into «existing.alias»? All matches where «target.alias» played will move to «existing.alias»."* On confirm, app calls `POST /api/profiles/:existingId/merge { sourceProfileId: P.id, token }`. Server:
   - Re-verifies token.
   - In one Postgres transaction: rewrite `Player.profileId` from `P.id` to `existingId`; copy `P.customAvatarUrl` to `existing` only if `existing.customAvatarUrl` is null (don't overwrite owner choices); rewrite `ProfileGroupMember.profileId`; delete `P`.
   - Returns the merged Profile.
7. A's app shows confirmation; `pullSync()` runs.
8. B's next `pullSync` brings down every Match where the linked Profile is a Player. Server visibility filter: `Match WHERE createdById = me OR id IN (SELECT matchId FROM Player WHERE profileId IN (SELECT id FROM Profile WHERE ownerId = me OR linkedUserId = me))`.

**Unlink** (either side):
- A unlinks from the Players tab: `linkedUserId → null`. B loses read access on next pull.
- B unlinks from their settings ("Linked profiles" list): same effect.

**Library choices**: [`qr-scanner`](https://github.com/nimiq/qr-scanner) (~13KB, MediaDevices wrapper) for scanning; [`qrcode`](https://www.npmjs.com/package/qrcode) for rendering. No third-party SDK, no cloud round-trip.

### Profile merge — also exposed standalone

The merge primitive is also available from the Players tab as a manual action ("Merge this profile into another…"), useful when the owner realizes two unclaimed profiles are the same person, or wants to clean up after an import. Endpoint: `POST /api/profiles/:targetId/merge { sourceProfileId }` (no token required when both profiles are owned by the caller and unclaimed; required when either is linked). Same atomic rewrite as the link-time merge. UI always confirms before submitting.

### Avatars

- **Frontend**: copy `useCamera` (`src/hooks/useCamera.ts`) and `CameraCapture` (`src/components/profile/CameraCapture.tsx`) verbatim from `/Users/jonathanlelievre/www/birthday-party`. Drop the retro styling; restyle with Tailwind to match OnBoard's design tokens. Both files are framework-agnostic (no Next.js coupling). Output is a `Blob`.
- **Backend**: new Hono endpoint `POST /api/profiles/:id/avatar` accepts the Blob as form-data, uses `sharp` (new dep) to produce a 400×400 JPEG (90% quality) + 100×100 thumbnail (80% quality), writes both to `/uploads/avatars/{profileId}.{v}.jpg`, persists URL in `Profile.customAvatarUrl`. Authorization: caller must be `Profile.ownerId`.
- **Storage**: local filesystem (same pattern as birthday-party). Coolify volume mount under `/uploads`. Document in CLAUDE.md.
- **`<Avatar>` component** (new, `src/client/components/ui/Avatar.tsx`): size variants (sm/md/lg), reactive to the viewer (the resolution logic above). Used everywhere a person is rendered.

### Players tab

- New bottom-nav item between Games and Settings: icon `users` (extend the custom Icon component), label key `nav.players` (`Players` / `Joueurs`).
- Route: `src/client/routes/_authenticated/players/index.tsx` — list of Profiles where `ownerId = me OR linkedUserId = me`. Self-Profile pinned at top.
- Route: `src/client/routes/_authenticated/players/$profileId.tsx` — detail page.
- Route: `src/client/routes/_authenticated/players/groups.tsx` — favorite groups manager.

**Profile detail page contents**:
- Avatar with edit button (camera or upload, reusing `CameraCapture`).
- Alias edit (debounced save).
- Link/unlink section:
  - Unclaimed: "Link to a Google account" → opens scanner.
  - Linked: shows linked friend's name + email + Google avatar; "Use linked friend's photo" toggle (`useLinkedAvatar`); "Unlink" with confirm.
- "Merge into another profile…" action — opens a picker among the owner's other profiles, confirms, calls the merge endpoint.
- "Played together" stats: total matches, your wins / their wins / draws, win rate per game. Reads from Dexie via `useLiveQuery`.
- Recent matches list (last 10), tappable to match detail.

**Favorite groups**:
- `ProfileGroup { id, ownerId, name, createdAt, updatedAt }` + `ProfileGroupMember { groupId, profileId, position }`.
- Manage in `/players/groups`: list groups, create/edit (name + profile pickers).
- Used in `games/$slug_.new.tsx`: chip row above the player inputs — tapping a group fills the slots in order.

**"Played with" suggestions**:
- New-match form: above the empty-state autocomplete, show the **most recent 3 distinct groupings** of profiles from past matches of the same game. One-tap fills slots.
- Source: `useLiveQuery` over Dexie `matches` + `players` grouped by `players.profileId[]` signature.

### Server API surface (new + changed)

**New**:
- `GET    /api/profiles` — list profiles visible to me (`ownerId = me OR linkedUserId = me`). Supports `?since=` for pull-sync.
- `POST   /api/profiles` — create an unclaimed Profile owned by me. Accepts client-generated CUID.
- `PATCH  /api/profiles/:id` — owner edits alias / `useLinkedAvatar`.
- `POST   /api/profiles/:id/avatar` — owner uploads avatar (multipart).
- `DELETE /api/profiles/:id/avatar` — owner clears custom upload.
- `POST   /api/profiles/link-token` — caller requests a signed token for *their own* User. Returns `{ token, expiresAt }`.
- `POST   /api/profiles/:id/link` — owner submits `{ token }` to bind their Profile. Returns `{ status: "linked", profile }` or `{ status: "merge_required", existing, target }`.
- `POST   /api/profiles/:targetId/merge` — `{ sourceProfileId, token? }`. Atomically rewrites all `Player.profileId` + `ProfileGroupMember.profileId` references from source to target, then deletes source. Token required iff either profile is linked.
- `POST   /api/profiles/:id/unlink` — owner OR linked user clears `linkedUserId`.
- `GET    /api/profile-groups`, `POST`, `PATCH /:id`, `DELETE /:id` — favorite groups CRUD.

**Changed**:
- `POST /api/matches` — `players[]` payload becomes `{ id, profileId, position }`. The server no longer accepts inline player names. Frontend creates a Profile (or reuses one) before submitting the match.
- `GET /api/matches[*]` — Player rows return `{ id, profileId, position }`; client joins to Dexie `profiles` for display.
- `/api/players/suggestions` — **removed**. Replaced by `useProfileSuggestions()` reading from Dexie `profiles` ranked by `usedAt`.

### Dexie schema (v3)

```
games:         "id, slug"
matches:       "id, gameId, status, startedAt, updatedAt, [createdById+startedAt]"
players:       "id, matchId, profileId, [matchId+position]"
scores:        "id, matchId, [matchId+playerId+category], updatedAt"
profiles:      "id, ownerId, linkedUserId, usedAt, updatedAt"   // NEW
profileGroups: "id, ownerId, updatedAt"                          // NEW
profileGroupMembers: "[groupId+profileId], groupId, profileId"   // NEW
syncQueue:     "++id, createdAt, status"
syncMeta:      "key"
```

`localProfiles` dropped in the v2→v3 upgrader. Migration recovers data from server pull on first load (zero-loss because the server-side migration creates Profiles for every historical Player).

### Phasing — 3 vertical slices (+ optional cleanup)

Each PR is sized to land in one Claude session, ships an end-to-end testable change to the app, and is safe to deploy independently to integration/production. **Backward-compatibility strategy**: `Player.userId` and `Player.name` are kept as dormant legacy columns across the whole phase — they get populated by the server alongside `Player.profileId`, and are never dropped. This removes the migration-audit ceremony entirely.

#### PR 6-A — Profile MVP + Players tab (`feat/profiles-mvp`, ~2 days)

**Goal**: ship the Profile entity and the Players tab as a read + rename experience. App stays fully usable; match-creation UX untouched.

**Schema**:
- Add `Profile`, `ProfileGroup`, `ProfileGroupMember` tables.
- Add `Player.profileId String?` (nullable for now; backfilled for all existing rows; new rows get it set server-side; never marked `NOT NULL` in this PR).
- Keep `Player.userId` and `Player.name`. They remain authoritative for match-creation input throughout this PR.

**Migration**:
1. Create one Profile per `(createdById, lower(trim(name)))` tuple from existing `Player` rows where `userId` is null. `alias = original Player.name`.
2. Create one linked Profile per existing `Player.userId` (one per `userId`), `linkedUserId = userId`, `ownerId = createdById` of the earliest match.
3. Create one self-Profile per `User` not yet covered (`ownerId = linkedUserId = userId`, `alias = user.alias || user.name`).
4. Populate `Player.profileId` for every existing row.
5. Add a Prisma post-create hook (or `Profile` upsert in better-auth's user-created callback) so every newly authenticated User gets a self-Profile.

**Server**:
- `GET /api/profiles` — visibility filter `ownerId = me OR linkedUserId = me`. Supports `?since=` for pull-sync.
- `POST /api/profiles` — create unclaimed Profile owned by me (client CUID accepted).
- `PATCH /api/profiles/:id` — owner edits `alias`, `useLinkedAvatar`.
- `/api/matches` POST **unchanged shape** (still accepts inline `players[].name`), but the handler now resolves each name → existing-or-new Profile owned by the creator, and writes both `Player.name` (legacy) and `Player.profileId` (new) on each row.
- `/api/matches` GET response includes `Player.profileId` alongside the existing fields (client falls back to `Player.name` when `profileId` is unexpectedly null).
- Visibility helper in `src/server/lib/profile-scope.ts`.

**Client**:
- Dexie v3: add `profiles`, `profileGroups`, `profileGroupMembers` tables. v2→v3 upgrader drops `localProfiles`, repopulates `profiles` from `pullSync`.
- `src/client/lib/pull-sync.ts`: extend with `/api/profiles` pull.
- `src/client/lib/mutations.ts`: add `createProfile`, `patchProfile`.
- New hooks: `useProfile(id)`, `useProfileList()`, `useProfileStats(id)`.
- New `src/client/components/ui/Avatar.tsx` — viewer-aware resolution; this PR only displays Google photo / initial-letter fallback (no upload yet).
- New routes: `players/index.tsx` (profile list), `players/$profileId.tsx` (detail: avatar, alias edit, basic per-game stats, recent matches).
- `BottomNav.tsx`: add Players tab (icon `users`, label `nav.players`).
- Match history + scorer screens: replace `displayPlayerName()` with `displayProfileName(profile, viewerId)` reading from Dexie `profiles` via join. Fall back to `Player.name` when `profileId` is null.
- i18n: `players.*` namespace + `nav.players` in both `en/common.json` and `fr/common.json`.

**Acceptance** (manual, in the app):
- Open Players tab → see yourself pinned at top and every friend from past matches listed.
- Rename "Jonathan" → "Jo" in Players tab → every past match where he was scored now displays "Jo".
- Create a new match the old way (typing names) → match completes normally; on `psql`, `Player.profileId` is populated.
- Two-tab same-user: rename in tab A → tab B's match history updates within seconds (pullSync).
- Offline-created match works (no profileId on the offline row; falls back to `Player.name`; on sync, server populates profileId, client receives via pullSync).

#### PR 6-B — Profile-aware match creation + avatars + stats (`feat/profiles-match-flow`, ~2.5 days)

**Goal**: switch the new-match form to a profile picker, add the avatar upload pipeline, ship played-with chips and the enriched profile detail page. Favorite groups are out — they live in 6-D after the link feature.

**Requires**: PR 6-A merged and deployed to integration.

**Schema**: no change.

**Server**:
- `POST /api/profiles/:id/avatar` — multipart upload, `sharp` pipeline → 400×400 JPEG + 100×100 thumbnail under `/uploads/avatars/{profileId}.{v}.jpg`. Authorization: caller is `Profile.ownerId`.
- `DELETE /api/profiles/:id/avatar` — owner clears custom upload.
- `POST /api/profiles/:targetId/merge` — **unclaimed-only variant** for now: rejects if either profile has `linkedUserId` set. Atomic transaction rewrites `Player.profileId` (and `Player.name` to match the kept profile's alias) + `ProfileGroupMember.profileId` (no-op until 6-D populates the table, but written defensively so groups don't need to revisit merge logic), then deletes source. Caller must own both. Token-required variant ships in 6-C.
- `/api/matches` POST: accepts `players[].profileId` (preferred) or `players[].name` (legacy fallback, behavior unchanged from 6-A).
- `sharp` becomes a server dep.
- Dockerfile / `scripts/entrypoint.sh` ensure `/uploads/avatars` exists. Document Coolify volume mount in `CLAUDE.md`.

**Client**:
- `qr-scanner` is **not** in this PR (deferred to 6-C). Camera plumbing for avatars is via `useCamera` only.
- Port `useCamera` (`src/client/hooks/useCamera.ts`) and `CameraCapture` → `src/client/components/profiles/AvatarUploader.tsx`. Logic verbatim from birthday-party, retro styling dropped, Tailwind-restyle.
- `src/client/lib/mutations.ts`: add `uploadAvatar`, `clearCustomAvatar`, `mergeProfile` (unclaimed-only client-side). Merge mutation updates Dexie `players.profileId` for every affected row before deleting the source row.
- `src/client/lib/pull-sync.ts`: detect server-side merges (Profile id locally that's missing from a fresh pull → confirm + delete locally).
- New hooks: `useProfileSuggestions()`, `usePlayedWith(gameId)`.
- New components: `src/client/components/profiles/{ProfileEditor, MergeDialog}.tsx`.
- Profile detail page enriched: "Played together" stats panel (head-to-head record, per-game win rates), "Merge into another profile…" action.
- `games/$slug_.new.tsx`: switch from name inputs to profile-picker autocomplete (typing creates a new Profile inline via `mutations.createProfile`, then references its id in the match payload). "Played with" chips above the player slots — 3 most recent groupings from past matches of this game, one-tap fill.
- i18n keys for `merge.*` and avatar-related strings.

**Acceptance** (manual, in the app):
- Upload a photo for "Alice" via camera path → resized JPEG written under `/uploads/avatars/`. Avatar appears in scorer, history list, Players tab.
- Upload a photo via gallery upload path → same behavior.
- Create a new match: type "Bob" → no existing profile → inline create → match completed; profile now in Players tab.
- Pick an existing profile from the autocomplete → match references that profile id directly.
- "Played with" chip: tap the last-Wednesday crew → all 4 slots fill in their previous order.
- Profile detail page shows correct head-to-head: wins, losses, win rate per game.
- Standalone merge: create a second unclaimed profile "Ali" by mistake → use "Merge into another profile…" → all match references collapse onto "Alice".

#### PR 6-C — Link-to-account via QR + merge-on-collision (`feat/profiles-link-qr`, ~1.5 days)

**Goal**: deliver the full link-to-account flow with merge fallback.

**Requires**: PR 6-B merged.

**Schema**: no change (`linkedUserId` already exists since 6-A).

**Server**:
- HMAC token helpers in `src/server/lib/link-tokens.ts` (reuse `BETTER_AUTH_SECRET` as signing key, 60s expiry).
- `POST /api/profiles/link-token` — caller requests a signed token for *their own* User. Returns `{ token, expiresAt }`.
- `POST /api/profiles/:id/link` — owner submits `{ token }`. Returns `{ status: "linked", profile }` or `{ status: "merge_required", existing: { id, alias }, target: { id, alias } }` (HTTP 200 in both branches).
- `POST /api/profiles/:targetId/merge` — extended to accept `{ sourceProfileId, token }`. Token required (and verified) when either profile has `linkedUserId` set; reuses unclaimed-only path from 6-B when both are unclaimed.
- `POST /api/profiles/:id/unlink` — owner OR linked user clears `linkedUserId`.

**Client**:
- Add `qr-scanner` (~13KB) and `qrcode` deps.
- `src/client/lib/mutations.ts`: add `requestLinkToken`, `linkProfile`, `unlinkProfile`. Extend `mergeProfile` to forward a token for linked-side merges.
- New components: `src/client/components/profiles/{LinkScanner, LinkCodeDisplay}.tsx`. `LinkScanner` integrates `qr-scanner` reusing the `useCamera` stream from 6-B. On `status: "merge_required"`, opens the `MergeDialog` from 6-B.
- `settings.tsx`: add "Show my link code" entry.
- Profile detail page: "Link to a Google account" button (unclaimed) / linked-friend card + "Unlink" button (linked) / "Use linked friend's photo" toggle.
- E2E: `e2e/link-qr.spec.ts` with a test-only injected-token bypass for the scan step (Playwright can't easily render+rescan a real QR, so the test exercises the API flow directly while the UI mounts the scanner). Cover both the happy path and the merge-required branch.

**Acceptance** (manual, two real devices):
- Friend logs in on their phone → opens "Show my link code" → QR rendered with 60s countdown.
- Owner on their phone → Players tab → tap profile "Alice" → "Link to a Google account" → camera opens → scans friend's QR → confirmation.
- Friend's next `pullSync` brings down every Match where "Alice" is a Player.
- Owner toggles "Use linked friend's photo" → avatar swaps to Google photo; previously uploaded custom retained.
- Owner attempts to link "Alice2" to the same friend → merge-required prompt → confirm → "Alice2" matches collapse onto "Alice".
- Either side unlinks → friend loses read access on next pull.
- Token expiry: friend's QR stale after 60s → owner scan fails with clear error.

#### PR 6-D — Favorite player groups (`feat/profiles-groups`, ~1 day)

**Goal**: ship saved player groupings ("Wednesday Skull King crew") so a recurring crew is one tap away on the new-match form. Independent of everything before — `ProfileGroup` and `ProfileGroupMember` tables already exist (added in 6-A) but stay empty until this PR.

**Requires**: PR 6-C merged (purely ordering — no hard dependency on link/QR; this lands last because it's the least interesting slice).

**Schema**: no change (`ProfileGroup`, `ProfileGroupMember` already shipped in 6-A's migration).

**Server**:
- `GET /api/profile-groups` — list groups owned by me (with members ordered by `position`). Supports `?since=` for pull-sync.
- `POST /api/profile-groups` — create a group (client CUID accepted). Body includes ordered `profileIds[]`.
- `PATCH /api/profile-groups/:id` — rename group, replace members.
- `DELETE /api/profile-groups/:id` — delete group + cascade members.
- Integration tests for every route.

**Client**:
- `src/client/lib/mutations.ts`: add `createProfileGroup`, `patchProfileGroup`, `deleteProfileGroup`.
- `src/client/lib/pull-sync.ts`: extend with `/api/profile-groups` pull.
- New hooks: `useProfileGroups()`, `useProfileGroup(id)`.
- New components: `src/client/components/profiles/{GroupEditor, GroupPicker}.tsx`.
- New route: `players/groups.tsx` (favorite groups manager — list, create, edit, delete).
- Entry point into the groups route from the Players tab header.
- `games/$slug_.new.tsx`: add group chips row above the player slots (alongside the existing "played with" chips from 6-B). Tapping a group fills slots in saved order.
- i18n keys under `groups.*` namespace.

**Acceptance** (manual, in the app):
- Players tab → "Groups" → create "Wednesday crew" with 4 profiles in chosen order.
- Open new-match form → tap "Wednesday crew" chip → 4 slots populate in order.
- Edit the group (rename, reorder, swap a member) → new chip behavior reflects the edit.
- Delete the group → chip disappears from new-match form.
- Offline: create group → reload → group persists; reconnect → server has it with the client CUID.

#### PR 6-E (optional, hold) — Schema cleanup (`chore/drop-player-legacy-columns`, ~half day)

After 6-A → 6-D have soaked in production and analytics confirm no client is writing the legacy fields:
- Mark `Player.profileId` `NOT NULL`.
- Drop `Player.userId`, `Player.name`.
- Remove `/api/players/suggestions` (already unused after 6-A).
- Tighten client types now that `Player.name` is gone.

**Hold this PR unless cleanup matters more than the small risk of a soak-window regression** — dead columns are cheap; the work above is mostly aesthetic.

### Critical files

| File | Action |
|---|---|
| `prisma/schema.prisma` | Add Profile/ProfileGroup; modify Player |
| `src/server/routes/profiles.ts` | New |
| `src/server/routes/profile-groups.ts` | New |
| `src/server/routes/matches.ts` | Adapt to profileId payload |
| `src/server/routes/players.ts` | Delete suggestions endpoint; file likely removed |
| `src/server/lib/link-tokens.ts` | New (HMAC helpers) |
| `src/server/lib/profile-scope.ts` | New (visibility helper) |
| `src/server/lib/profile-merge.ts` | New (transactional merge) |
| `src/server/lib/avatar-storage.ts` | New (sharp pipeline) |
| `src/client/lib/db.ts` | v3 schema |
| `src/client/lib/mutations.ts` | Add profile/group/merge mutations |
| `src/client/lib/pull-sync.ts` | Pull profiles + groups; detect merges |
| `src/client/lib/displayPlayerName.ts` | Rename to `displayProfileName.ts`, viewer-aware |
| `src/client/hooks/data/useProfile*.ts` | New |
| `src/client/hooks/usePlayerSuggestions.ts` | Replaced by `useProfileSuggestions` |
| `src/client/components/ui/Avatar.tsx` | New |
| `src/client/components/profiles/*` | New (Editor, Uploader, Scanner, CodeDisplay, GroupEditor, GroupPicker, MergeDialog) |
| `src/client/components/layout/BottomNav.tsx` | Add Players tab |
| `src/client/routes/_authenticated/players/*` | New routes |
| `src/client/routes/_authenticated/settings.tsx` | Add "Show my link code" entry; alias edit writes to self-Profile |
| `src/client/routes/_authenticated/games/$slug_.new.tsx` | Group chips, played-with chips, profile autocomplete |
| `src/client/components/scoring/**` | Replace name reads with Profile resolver |
| `src/client/locales/{en,fr}/common.json` | New `players.*`, `groups.*`, `link.*`, `merge.*` keys + `nav.players` |
| `Dockerfile` / `scripts/entrypoint.sh` | Ensure `/uploads/avatars` exists |
| `CLAUDE.md` | Document Coolify `/uploads` volume mount |

### Reused, not rewritten

- `useCamera`, `CameraCapture` — from `/Users/jonathanlelievre/www/birthday-party/src/hooks/useCamera.ts` and `.../src/components/profile/CameraCapture.tsx` (logic copied verbatim, retro styling dropped, Tailwind restyled).
- Avatar resize pipeline pattern from `birthday-party`'s `/api/upload/route.ts` (translated to Hono).
- `Group`, `Header`, `Button`, `Input`, `Icon` UI atoms — existing.
- `AVATAR_CLASSES` palette from `$slug_.new.tsx` — moved to `Avatar.tsx` as the initial-letter fallback.
- `useLiveQuery` reactive read pattern from Phase 5c.
- Sync engine push/pull plumbing — unchanged from Phase 5c.

### Validation

- `npm run db:migrate && npm run db:seed && npm run db:test:reset` — schema migration clean both ways.
- `npm test` — full E2E suite green on Mobile Chrome + Mobile Safari.
- Local manual:
  1. Fresh login → self-Profile auto-created → visible in Players tab → editing alias propagates to every past match.
  2. Create unclaimed Profile "Alice" → use her in a new match → her avatar (initial fallback) shows in scorer + history.
  3. Upload custom avatar for "Alice" → both camera + upload paths work → resized JPEG written under `/uploads/avatars/`.
  4. Friend logs in on second device → opens link-code screen → owner scans → link succeeds → friend's pull brings down all past Alice matches.
  5. Create a second unclaimed profile "Ali" by mistake → use the standalone merge action to consolidate into "Alice" → all match references point to "Alice", "Ali" gone.
  6. Owner attempts to link "Alice" to friend B → friend B is already linked to a separate profile "Aleece" the owner created earlier → merge-required prompt → confirm → "Alice" and "Aleece" consolidate; matches under both names now under one profile.
  7. Owner toggles "Use linked friend's photo" → avatar swaps to Google photo; custom upload retained.
  8. Either side unlinks → friend loses read access on next pull.
  9. Favorite group "Wednesday crew" created → tapping the chip on new-match form fills 4 players in saved order.
  10. Offline: create Profile + match referencing it → DevTools IndexedDB shows both rows + 2 queue entries → reconnect → both flush in order → server has both with the client CUIDs.

### Out of scope (deferred to later phases)

- Per-profile private notes (cheap; pushed out to keep this phase focused).
- Per-match privacy toggles ("hide this match from a linked friend").
- Achievements / badges.
- Public sharing of match results outside the app.
- Friend-to-friend match invitations / push notifications.
- Profile search across all users (intentional — link only via QR, not by search).

---

## Phase 7: Polish + Distribution

**Goal**: Smooth experience, ready to share with friends.

- Real-time sync indicator in UI (synced / pending / error)
- Match history filters (by game, profile, date)
- Basic statistics (win rates, average scores per game) — aggregate dashboards beyond the per-profile stats already shipped in Phase 6
- Lighthouse PWA audit (must pass all PWA criteria)
- Installation help page (accessible without auth, explains how to install on Android/iOS)
- v1.0.0 release → production deploy

**Validation**: Lighthouse PWA score 100, friends can install and use the app.

---

## Phase 8: Skull King — Rascal Variant

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
