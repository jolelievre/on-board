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

#### PR 6-C — Link-to-account via QR + single-Profile model refactor (`feat/profiles-link-qr`, ~3 days)

**Goal**: deliver the full link-to-account flow with merge fallback, **AND** collapse the mirror-profile model to a single Profile. Both ship in the same PR.

**Scope note (expanded mid-PR)**: the original 6-C scope was just the QR + merge flow on top of the existing mirror-profile model. During implementation we hit a class of sharing/sync bugs (matches visible to one user but not the other depending on who created them, partial sync after linking, duplicate Profiles drifting apart) that traced back to the mirror model itself — every `link` creates a second Profile on the linked user's side, and the two rows go out of sync as soon as anyone edits or merges. We decided to fix the model rather than band-aid each symptom. The refactor sections below (Schema / Legacy path removal / Display rule / Visibility query) describe that work; everything else is the original 6-C link-flow scope. No prod data exists yet (single-user dogfooding), so the migration is a clean db reset.

**Requires**: PR 6-B merged.

**Schema** (`prisma/schema.prisma` + migration):
- Drop `Player.userId` (denormalization — Profile.linkedUserId is the source of truth; the only path from Match to "user X participated" is Match → Player → Profile → linkedUserId). Single Dexie + server query collapses, see audit in conversation: removes `collectPersonPlayers` union, removes `refreshLocalAliases` Player walk, removes `5dabc1d` self-attribution workaround.
- Drop `Player.name` (already legacy from 6-A — name lives on Profile.alias now).
- Add `NOT NULL` on `Player.profileId`. **A Player without a Profile is not a valid state** — closes the "in-between two models" gap where a match created via the legacy name-only path produced Player rows that were addressable by name but not by Profile.
- Keep `Profile.linkedUserId` (already exists from 6-A).
- Keep `@@unique([ownerId, linkedUserId])` on Profile — already enforces "one Profile per (owner, linked friend)".
- No `migrate reset` needed in code — manual reset of dev/integration DBs is fine; preview DBs are short-lived per-PR; no prod.

**Mental model (post-refactor)**:
- A `Profile` is "a person someone has played with". Owned by the creator (`ownerId`). If that person is also a user of the app, link it via `linkedUserId`. Linking does not create a second Profile — the row is shared.
- "My matches" = matches where I'm the owner OR any participating Profile has `ownerId = me` OR `linkedUserId = me`. (The first term is redundant with the second since the creator is always a player on their own match, but kept for query simplicity / index use.)
- "My self-Profile" = the Profile auto-created on signup with `ownerId = me` (and conventionally `linkedUserId = null`; the existing 6-A code sets `linkedUserId = me` for the self-row, which the visibility filter must continue to handle). Edited from Settings, not the Players tab.
- Players tab shows friends only: `WHERE ownerId = me AND linkedUserId IS NOT me` — never my self-Profile, never a profile that represents me from a friend's perspective.

**Display rule (viewer-aware, no schema cost)**: a Profile's `alias` + `customAvatarUrl` belong to the owner — only the owner ever sees them. When the *linked* user (`profile.linkedUserId === viewer.userId`) encounters that Profile in their own match history, the renderer ignores the Profile's display fields entirely and uses the viewer's own `User.name` / `User.avatarUrl` instead. This is how identity is supposed to work: each user controls their own appearance via Settings; the friend's Profile is just a join key in their view. No per-viewer customization is lost compared to the mirror model, because the linked user never wanted the owner's nickname for them in the first place; they wanted their own identity. Corollary: the linked user does NOT navigate to "their" Profile detail page from the owner's side — they have no view of that page at all (no edit affordances needed because the page is owner-only).

**Server-side legacy path removal** (the "two models" residue):
- `POST /api/matches`: stop accepting `players[].name` and `players[].userId`. Validation rejects payloads that don't carry a `profileId` for every seat (HTTP 400). The client is expected to resolve every seat to a Profile *before* submit, via the picker / autocomplete / "create new" flow. This was already best-practice from 6-B but the legacy fallback kept the gap open.
- Delete `resolvePlayerProfileId` from `src/server/lib/match-profiles.ts` (the name-based resolver that creates a Profile inline at match-create time, plus any alias-normalization helpers it owns). Keep `resolvePlayerByProfileId` in the same file — that's the only path now. Single caller is `matches.ts:146`, which collapses to a direct `resolvePlayerByProfileId` call.
- Delete `/api/players/suggestions` (already deprecated post-6-A; was scheduled for 6-E, pull it forward).
- Audit `src/client/lib/mutations.ts:createMatch` and any new-match form code that still constructs a `{ name, userId }` payload — replace with `{ profileId }`.

**Server (link-flow + refactor combined)**:
- HMAC token helpers in `src/server/lib/link-tokens.ts` (reuse `BETTER_AUTH_SECRET` as signing key, 60s expiry).
- `POST /api/profiles/link-token` — caller requests a signed token for *their own* User. Returns `{ token, expiresAt }`.
- `POST /api/profiles/:id/link` — owner submits `{ token }`. Validates the token, then **just sets `linkedUserId`** on the existing Profile (no mirror creation). Returns `{ status: "linked", profile }`. Returns `{ status: "merge_required", existing, target }` only when the owner already has *another* of their own profiles linked to the same friend (the `@@unique([ownerId, linkedUserId])` collision case). Reject linking a profile to its own owner (HTTP 400).
- `POST /api/profiles/:targetId/merge` — owner-side only. Token requirement removed (no more linked-side merge concept). Atomically rewrites `Player.profileId` + `ProfileGroupMember.profileId` from source → target, then deletes source. **Important**: if either profile has `linkedUserId` set, the surviving profile must carry it forward. If the source has `linkedUserId` and the target doesn't, copy it onto target before deleting source. If both have one (shouldn't happen under the unique constraint, but defend), refuse with HTTP 409.
- `POST /api/profiles/:id/unlink` — owner OR linked user clears `linkedUserId`. After unlink, the formerly-linked user immediately loses read access to past matches via the visibility filter — confirm in tests.
- **Match list query** (`GET /api/matches`): rewrite to `WHERE Match.ownerId = me OR EXISTS(Player JOIN Profile WHERE Match.id = Player.matchId AND (Profile.ownerId = me OR Profile.linkedUserId = me))`. Centralize this filter in `src/server/lib/profile-scope.ts` (currently exists; extend) so every place that lists matches uses the same predicate.
- **Profile list query** (`GET /api/profiles`): owned by me, filtered to exclude self-Profile (callers can pass `?include=self` if a screen needs the self-Profile). Linked-to-me profiles are *not* my profiles — they belong to my friend who owns them; I see them implicitly via match participation, never in my own Players list.
- Audit `src/server/routes/profiles.ts` and `src/server/routes/matches.ts` for any code path that creates a mirror Profile on link or writes `Player.userId` — delete.

**Client (link-flow + refactor combined)**:
- Deps: add `qr-scanner` (~13KB) and `qrcode`.
- `src/client/lib/mutations.ts`: add `requestLinkToken`, `linkProfile`, `unlinkProfile`. Extend `mergeProfile` to handle the simplified owner-side merge (drop token forwarding). Remove `Player.userId` / `Player.name` from the `createMatch` payload type.
- New components: `src/client/components/profiles/{LinkScanner, LinkCodeDisplay}.tsx`. `LinkScanner` integrates `qr-scanner` reusing the `useCamera` stream from 6-B. On `status: "merge_required"`, opens the `MergeDialog` from 6-B.
- `settings.tsx`: add "Show my link code" entry.
- Profile detail page: "Link to a Google account" button (unclaimed) / linked-friend card + "Unlink" button (linked) / "Use linked friend's photo" toggle. **Page is owner-only** — if accessed by a non-owner (URL nav), redirect to Players tab.
- `displayProfileName.ts` (+ avatar resolver): viewer-aware override — when `profile.linkedUserId === viewer.userId`, return `viewer.name` / `viewer.avatarUrl` instead of `profile.alias` / `profile.customAvatarUrl`.
- Players tab: filter out self-Profile and `linkedUserId === me` from the listing.
- New-match form: when picking "myself", always resolve to my self-Profile. Friends resolve to owned Profiles. Drop any code that builds a `{ name, userId }` payload — every seat resolves to a `profileId` before submit.
- `src/client/hooks/data/useProfiles.ts:collectPersonPlayers`: collapse to a single `db.players.where("profileId").equals(profile.id)` query. The `userId`-union widening is no longer necessary (the very bug it works around can't happen after the refactor). Audit `useHeadToHead` for the same widening (lines 470-496) and simplify.
- `src/client/lib/pull-sync.ts:refreshLocalAliases`: drop the `db.players.where("userId")` walk and the `player.user.alias` patch. Only the Profile-row patch remains. The pull-sync downstream verifies the new visibility filter delivers friend-owned matches to linked users end-to-end.
- Dexie schema bump (v4): drop `userId` and `name` from the Player row type, mark `profileId` required.
- `usePlayedWith` and any other "my matches with X" derived view: rewrite against the new query / new types.

**Tests** (per CLAUDE.md: UI-driven, no API shortcuts):
- E2E `link-qr.spec.ts` (already planned): owner-scans-friend happy path; merge-required branch when owner has two of their own profiles for the same friend. Uses a test-only injected-token bypass for the scan step (Playwright can't easily render+rescan a real QR).
- E2E `link-shares-matches.spec.ts`: A creates a match with friend B's Profile → A links Profile to B → B logs in on another browser context → B sees the match in their Games list and the Game's match list.
- E2E `match-created-by-friend-visible.spec.ts`: A and B have linked each other's profiles → B creates a match picking A's profile (B's own owned Profile with `linkedUserId = A`) → A sees the match. Closes the symmetry-bug class.
- E2E `unlink-removes-access.spec.ts`: link, verify shared visibility, unlink, verify visibility drops on the next pull.
- E2E `players-tab-excludes-self.spec.ts`: my Players tab never lists my self-Profile and never lists a Profile whose `linkedUserId` is me.
- Integration tests on the new server queries (`matches.ts` visibility filter, `profiles.ts` link/unlink/merge).
- Drop the obsolete mirror-creation tests in `e2e/api/profiles.spec.ts` and friends.

**Acceptance** (manual, two real devices):
- Friend logs in on their phone → opens "Show my link code" → QR rendered with 60s countdown.
- Owner on their phone → Players tab → tap profile "Alice" → "Link to a Google account" → camera opens → scans friend's QR → confirmation.
- Friend's next `pullSync` brings down every Match where "Alice" is a Player. Friend's UI shows themselves (their `User.name` + avatar) in those match histories, not "Alice".
- Whoever creates a subsequent match, both participants see it after sync. No "depending on who created it" gaps.
- A renames Profile "Alice" → "Aleece" → B's match history still shows B's `User.name`, not "Aleece" (display override holds).
- Owner attempts to link "Alice2" (a second profile they also own for the same friend) → merge-required prompt → confirm → "Alice2" matches collapse onto "Alice" (merge preserves `linkedUserId` on the survivor).
- Owner toggles "Use linked friend's photo" → avatar swaps to Google photo for the owner's view; B continues to see B's own avatar.
- Either side unlinks → other side loses read access on next pull.
- Token expiry: friend's QR stale after 60s → owner scan fails with clear error.

**Out of scope (explicitly)**:
- Per-viewer aliases or per-viewer avatars beyond the display rule above. No schema field for "what owner calls friend privately" — the owner's `alias` IS their private nickname (only they see it).
- Multi-link (one Profile linked to many Users). Not a feature.
- "Bidirectional auto-link": if A links Profile-of-B to user B, the symmetric Profile (B's profile of A) is *not* auto-linked. B does that themselves. Mirroring auto-link is precisely the kind of inference we're moving away from (see [[feedback_ui_provides_data_not_server_inference]]).
- Linked-user view of "their" Profile detail page: simply doesn't exist — page is owner-only.

**Critical files**:

| File | Action |
|---|---|
| `prisma/schema.prisma` | Drop `Player.userId`, `Player.name`; `Player.profileId NOT NULL` |
| `prisma/migrations/*` | New migration |
| `src/server/routes/profiles.ts` | Mirror-on-link removal; merge preserves `linkedUserId` on survivor; unlink endpoint |
| `src/server/routes/matches.ts` | Stop accepting `name`/`userId` in player payload; stop writing `Player.userId`; use scope filter from `profile-scope.ts` |
| `src/server/lib/match-profiles.ts` | Delete `resolvePlayerProfileId` + name-resolution helpers; keep `resolvePlayerByProfileId` only |
| `src/server/lib/profile-scope.ts` | Central match-visibility predicate (`ownerId OR linkedUserId joined via Player`) |
| `src/server/lib/profile-merge.ts` | Owner-side only; carry `linkedUserId` from source to target if present; drop token requirement |
| `src/server/lib/link-tokens.ts` | Still used by `/profiles/link`; untouched |
| `src/server/routes/players.ts` | Delete (`/api/players/suggestions` retired) |
| `src/client/lib/db.ts` | Dexie v4: drop `userId`/`name` on Player row; `profileId` required |
| `src/client/lib/displayProfileName.ts` | Viewer-aware override (+ avatar resolver) |
| `src/client/lib/mutations.ts` | Add `requestLinkToken`/`linkProfile`/`unlinkProfile`; drop `userId`/`name` from `createMatch` payload |
| `src/client/lib/pull-sync.ts` | Drop `db.players.where("userId")` walk in `refreshLocalAliases`; verify new visibility filter end-to-end |
| `src/client/hooks/data/useProfiles.ts` | Collapse `collectPersonPlayers` to single `profileId` query; simplify `useHeadToHead` |
| `src/client/components/profiles/LinkScanner.tsx` | New |
| `src/client/components/profiles/LinkCodeDisplay.tsx` | New |
| `src/client/routes/_authenticated/players/index.tsx` | Filter self + linked-to-me from listing |
| `src/client/routes/_authenticated/players/$profileId.tsx` | Owner-only page; redirect non-owners |
| `src/client/routes/_authenticated/games/$slug_.new.tsx` | Drop `userId`/`name` enrichment; resolve self via self-Profile |
| `src/client/routes/_authenticated/settings.tsx` | "Show my link code" entry |
| `e2e/link-qr.spec.ts` | Happy path + merge-required |
| `e2e/link-shares-matches.spec.ts` | New |
| `e2e/match-created-by-friend-visible.spec.ts` | New |
| `e2e/unlink-removes-access.spec.ts` | New |
| `e2e/players-tab-excludes-self.spec.ts` | New |
| `e2e/api/profiles.spec.ts` | Drop mirror-flow assertions; add new visibility tests |

#### PR 6-D — Favorite player groups *(ABANDONED, not shipping)*

Originally scoped as saved player groupings ("Wednesday Skull King crew") with their own `ProfileGroup` + `ProfileGroupMember` tables (added defensively in 6-A's migration but never populated by any UI). **The "played-with" suggestions that landed in PR 6-B already cover the recurring-crew use case** — picking the most-recent grouping is one tap, with no extra management surface to maintain. The groups feature added a second way to do the same thing for marginal benefit.

Dropped in the Phase 6 wrap-up PR (`chore/profiles-wrap-up`):
- Prisma models `ProfileGroup` + `ProfileGroupMember` removed from `prisma/schema.prisma`; new migration `<ts>_drop_profile_groups` drops both tables.
- Dexie v5 nullifies `profileGroups` and `profileGroupMembers`; `LocalProfileGroup*` types removed.
- The defensive `ProfileGroupMember` rewrite block in `src/server/lib/profile-merge.ts` is gone.
- No server routes, client mutations, hooks, components, i18n keys, or tests ever existed for groups — nothing else to clean up.

#### PR 6-E — Phase 6 wrap-up (`chore/profiles-wrap-up`)

Bundles the remaining Phase 6 follow-ups and a small UX polish into a single PR scoped to the Profiles surface:

- **Drop `ProfileGroup` infrastructure** — see above.
- **Cosmetic Dexie rename** — `LocalProfile3` → `LocalProfile` across `src/client/`. The `3` suffix dated from the v3 schema bump (when a legacy `LocalProfile` still existed); the legacy type is gone, so the suffix no longer adds information. Pure search-and-replace, no behavior change.
- **`User.alias` propagation to friend devices** — `syncSelfProfileAlias` (better-auth `user.update.after` hook) now compares the new alias to the existing self-Profile row and, when it actually changed, bumps `Match.updatedAt = NOW()` on every Match whose Player set joins through a Profile linked to that user. Friend devices' next routine pull-sync refreshes the embedded `linkedUser.alias` snapshots. New E2E `e2e/alias-propagates-to-friend.spec.ts` drives the cross-context UI flow.
- **"+ Add profile" action on the Players tab** — header trigger opens an inline alias form; submit calls the existing `createProfile` mutation and navigates straight to `/players/$profileId` so the new unclaimed profile is immediately ready to scan a friend's link code. i18n: `players.addProfile`, `players.addProfileForm.{placeholder,submit}`. New E2E `e2e/add-profile.spec.ts`.
- **Blur input after picker selection in the new-match form** — `SlotRow` now captures the input via `useRef` and calls `inputRef.current?.blur()` from both the `SuggestionChip` `onClick` and the "+ Create profile" inline-row `onClick`, so the mobile keyboard collapses as soon as a pick commits. New assertions in `e2e/new-match.spec.ts`.
- **Camera facing-mode default per editing context** — `useCamera` accepts an `{ initialFacingMode }` option; `AvatarUploader` derives it from the existing `isSelf` check (self-Profile → `"user"` for selfie, friend-Profile → `"environment"` because you're aiming the phone at them). The flip control still works on both paths. `LinkScanner` is untouched (it uses `qr-scanner` directly with `preferredCamera: "environment"`, correct for QR).
- **Settings avatar editor + shared `EditableAvatar` component** — extracted `src/client/components/profiles/EditableAvatar.tsx` (avatar preview + pencil edit button → swap to `AvatarUploader`-inside-`Group`). Used by both the profile detail page (replacing the inline `editingPhoto` JSX) and Settings (replacing the read-only `<img>` block). New `useSelfProfile` reactive hook returns the viewer's self-Profile from Dexie. Existing `data-testid="profile-edit-avatar"` is preserved so detail-page E2E selectors keep matching; new E2E `e2e/settings-avatar-edit.spec.ts` covers the Settings surface.

Out of scope (decided during planning, not shipping): **shower-side feedback when a scan needs a merge**. The implementation cost (transient server state + a new state branch in `LinkCodeDisplay` + i18n + E2E) is disproportionate to the rare two-stale-duplicates-at-once case it addresses.

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

## Phase 7: Avatars & Match Row — Design Refactor

**Goal**: ship the design pass on the avatar / profile-photo feature done with Claude Design (handoff in `plan-assets/design_handoff_avatars/`). Two things land together: a state-machine **Avatar Capture Studio** replacing the current `AvatarUploader`, and **avatar "stamps"** (photo + frame + colour ring) threaded through match history, the winner banner, the 7 Wonders Duel scorer, and every Skull King screen via a unified one-line match row.

The result is consistent player identification across every surface — set the stamp once in the studio, every consumer picks it up from the profile. Mocks are reference HTML/JSX prototypes, NOT code to port: recreate using the existing CSS-Modules + theme tokens + `Avatar` / `Button` / `Card` / `Pill` / `SketchRect` / `CatGlyph` / `Icon` primitives.

### Data model

The capture studio produces a **stamp**: a photo plus how it's framed. Add two fields to `Profile` (Prisma + Dexie `LocalProfile`):

| Field | Type | Default | Notes |
|---|---|---|---|
| `avatarFrame` | `'circle' \| 'rounded' \| 'tag'` | `'circle'` | Stamp shape. Radii: circle `50%`, rounded `≈26%` of size, tag `10% 34% 10% 34%` of size. |
| `avatarRing` | category key string \| null | `null` | One of `civil`, `scientific`, `commercial`, `guilds`, `progress`, `treasury`, `military`, `wonders`, or null. Stored as a key (not hex) so it re-themes. |

- `customAvatarUrl` keeps its current meaning. Client **bakes the reposition transform into a square JPEG before upload** — server's existing `sharp` pipeline (`avatar-storage.ts`) is unchanged. No `avatarCrop` column.
- Frame + ring apply uniformly to custom uploads, the linked Google photo, AND the initial-letter fallback.
- Migration backfills existing rows with `avatarFrame='circle'`, `avatarRing=NULL`. Cosmetic; no behaviour change for unmigrated clients.
- Dexie bumps v5 → v6 mirroring server fields; pull-sync populates.

### Part 1 — Avatar Capture Studio

**Replaces**: `src/client/components/profiles/AvatarUploader.tsx` (+ CSS). `EditableAvatar.tsx` unchanged structurally — same pencil-icon toggle, just opens the new studio.

State machine — 4 screens (mock source: `mocks/studio/{app,camera,reposition,style}.jsx`):

1. **Hub** — current stamp preview + alias + mono caption `YOUR CURRENT STAMP` / `NO PHOTO YET`. Three full-width action rows: **New photo** → camera; **From gallery** → native file input → reposition; **Style stamp** → style screen (accent border, disabled when no photo). Dashed "Use my "X" monogram" row clears the photo. Eyebrow `EDIT PROFILE` + existing `<ThemeToggle>` on the right. Critical UX fix: **styling reachable without retaking**.
2. **Camera** — full-bleed feed, NOT the current cramped circle. Warm-ink scrim with circular cut-out + hand-drawn dashed framing ring (WYSIWYG with the final crop). Bottom strip: Gallery + real shutter (`primary`) + Flip; top bar: `✕ Cancel` + `SELFIE`/`REAR` pill. Mirror front-camera preview, un-mirror on capture. Error state: hide shutter, keep Gallery (graceful fallback).
3. **Reposition** — the missing step. Circular crop window (~230px) with Pointer Events (drag, two-finger pinch, mouse wheel) + 1–4 zoom slider. Faint center cross guides. On confirm, bake `{x, y, scale}` into a square via offscreen canvas; that JPEG goes to `POST /api/profiles/:id/avatar`.
4. **Style** — live stamp preview + frame swatch row (3 options) + colour ring row (off + 8 category swatches). Store category key, not hex. Save persists `customAvatarUrl` + `avatarFrame` + `avatarRing` together with a brief `✓ Saved` confirmation.

`useCamera` extension: expose the live `<video>` element so reposition can sample non-centred crops. Existing `capture()` (1024×1024 centre-cropped JPEG) kept intact for any callers.

### Part 2 — `Avatar` component (extend, don't fork)

**Edit**: `src/client/components/ui/Avatar.tsx` + `Avatar.module.css`. Current `Avatar` already does photo URL resolution, `sm|md|lg|xl` sizes, 8-bucket initial fallback. Add:

- **`frame?: 'circle' | 'rounded' | 'tag'`** — default from `profile.avatarFrame`. Drives `border-radius`. Applies to both photo and initial fallback.
- **`ring?: CategoryKey | null`** — default from `profile.avatarRing`. Renders as `box-shadow: 0 0 0 <ringWidth>px var(--color-cat-<key>-strong)` where `ringWidth` scales ≈5–6% of avatar size.

### Part 3 — Avatars in play

General rules from review:

- **Winner mark**: filled gold disc + dark crown glyph (`#C99A2E` light / `#F0C84B` dark), overlaid top-right on the winner's avatar. Used wherever a winner / leader is shown.
- **"This is me"**: only in **match history / lists**, NOT during in-game scoring. Treatment = teal (`accent`) left edge tab on the row + teal `Highlighter` swipe behind my name + teal ring on my avatar. **No "You" pill** (dropped in review). This **replaces** the current bold-font `.playerNameSelf` treatment in `MatchHistoryRow`.
- **Names always visible** beside avatars (especially the initial-fallback case).

**3a. Unified Match Row** — `src/client/components/matches/MatchHistoryRow.tsx`. One compact component, identical in `/games/$slug_` history and on `/players/$profileId`, ONE line per match. Two layouts by player count:

- **2 players**: symmetric `avatar — VS — avatar`. Each side horizontal: avatar + name + score; centered `VsMark`; date beneath. Winner side gets the crown + accent-coloured score.
- **3+ players**: winner leads (avatar + crown + name), then `beat` + overlapping avatar stack (cap 4, then `+N`); winner's total score + date on the right.

Small game glyph at left: existing `CatGlyph` for 7WD, new `Icon name="skull-king"` for SK. Pass `me` prop: history list = signed-in user; profile detail = null. **Replaces** the current bi-layout (compact / podium) and removes the truncating-title pattern.

**3b. Winner Banner** — `src/client/components/match/WinnerBanner.tsx`. Winner's avatar + gold `WinnerBadge`, "X wins!", score line with runner-up's small avatar. Replaces today's 🏆 emoji. Draw rendering structurally unchanged.

**3c. 7 Wonders Duel scorer header** — `src/client/components/scoring/SevenWondersDuelScorer.tsx`. Two player name-blocks gain `<Avatar>`; leader gets `WinnerBadge`. **No me-highlight here** (in-game). Grid cells inside unchanged.

**3d. Skull King** — `src/client/components/scoring/skull-king/*`:

| File | Change |
|---|---|
| `MatchStartScreen.tsx` | Seating list: avatar + seat-number badge per row; dealer keeps its pill |
| `BiddingScreen.tsx` | Avatar + seat badge per row; active-player highlight stays; no me-highlight |
| `BidRecapScreen.tsx` | Avatar + seat badge per bid card; no me-highlight |
| `RoundResultScreen.tsx` | Player header gains avatar beside name |
| `RoundTransitionScreen.tsx` | New **dealer chip** (avatar + small card glyph) above the deal-card stack; standings rows get avatars; leader gets `WinnerBadge`; no me-highlight |
| `MatchCompleteScreen.tsx` | Winner's avatar + `WinnerBadge` up top; final-standings rows get avatars + existing medals |
| `ScoreboardScreen.tsx` | Column headers gain avatars (scales 2–8 players); `#1` gets `WinnerBadge`; no me-highlight |

Reuse `shared.module.css` / `sk/` primitives; only inject `<Avatar>` + `<WinnerBadge>` + (transition only) `<DealerChip>`.

### New shared UI — favor `Icon`, dedicate only when compositional

**Pure glyphs → add to `src/client/components/ui/Icon.tsx`** (the project's central glyph registry):

- **`crown`** — new `IconName`; consumed by `WinnerBadge`.
- **`skull-king`** — new `IconName` (crowned-skull mark); used at the left of SK match rows. Replaces the originally-considered `SkullKingMark.tsx` — no compositional logic, just a glyph.
- **`cards`** — already exists; reuse for the dealer-chip glyph unless the mock visual differs enough to warrant a `dealer-card` entry.

**Dedicated components (compositional / typographic / styled):**

- **`WinnerBadge.tsx`** (`components/ui/`) — overlay wrapper: filled gold disc + absolute-positioned anchor + `<Icon name="crown">` inside.
- **`VsMark.tsx`** (`components/ui/`) — Caveat "VS" inside a hand-drawn dashed ring; typographic, can't live in `Icon`.
- **`Highlighter.tsx`** (`components/ui/`) — translucent skewed accent block.
- **`DealerChip.tsx`** (`scoring/skull-king/sk/`) — composition: `<Avatar>` + `<Icon name="cards">` + label.

Theme tokens: add `--color-crown-gold-{light,dark}` if not already present; both `Parchment` and `Candlelit` from day one.

### Delivery — single PR (`feat/avatar-studio-and-stamps`, ~5–7 days)

Shipping the whole phase as one PR. The visual story is coherent end-to-end (a stamp set up in the studio is only meaningful when every consumer surface reads it), and reviewing as one unit avoids "stamps don't render anywhere yet" intermediate states. Order inside the branch so each commit leaves the app working:

1. Foundations — Prisma migration + backfill, Dexie v5→v6, server `PATCH` accepts new fields, `mutations.ts` extension.
2. `Avatar` extension (`frame` + `ring` props) + theme tokens.
3. New shared UI — extend `Icon` (`crown`, `skull-king`); add `WinnerBadge`, `VsMark`, `Highlighter`, `DealerChip`.
4. Capture Studio — 4-screen state machine, `useCamera` exposes video element, client-side canvas baking, i18n in en/fr.
5. In-play surfaces — `MatchHistoryRow`, `WinnerBanner`, `SevenWondersDuelScorer` header.
6. Skull King pass — all 7 SK screens per the table; `DealerChip` integrated on `RoundTransitionScreen`.
7. E2E — new `avatar-studio.spec.ts`, `match-row-me-highlight.spec.ts`; update `match-history`, `skull-king`, `7wd-scorer`, `settings-avatar-edit`.

**Crop strategy: client-side bake.** Reposition draws the `{x, y, scale}`-transformed image into an offscreen square canvas, exports to JPEG, uploads. Server `sharp` pipeline unchanged.

**Theme scope: both `Parchment` and `Candlelit` from day one.** Every new component reads CSS custom properties; no inline hex.

### Critical files

| File | Action |
|---|---|
| `prisma/schema.prisma` | Add `avatarFrame`, `avatarRing` on `Profile`; migration backfill |
| `src/server/routes/profiles.ts` | `PATCH` accepts new fields |
| `src/client/lib/db.ts` | Dexie v6: same two fields |
| `src/client/lib/mutations.ts` | Extend `patchProfile` |
| `src/client/components/ui/Avatar.tsx` (+ CSS) | `frame` + `ring` props |
| `src/client/components/profiles/AvatarUploader.tsx` (+ CSS) | Rebuild as 4-screen state machine |
| `src/client/components/profiles/EditableAvatar.tsx` | Opens new studio (minor) |
| `src/client/hooks/useCamera.ts` | Expose video element access |
| `src/client/components/ui/Icon.tsx` | Add `crown` + `skull-king`; reuse existing `cards` for dealer chip |
| `src/client/components/ui/WinnerBadge.tsx` | New — gold disc wrapping `<Icon name="crown">` |
| `src/client/components/ui/VsMark.tsx` | New — Caveat "VS" in dashed ring |
| `src/client/components/ui/Highlighter.tsx` | New — translucent skewed accent block |
| `src/client/components/scoring/skull-king/sk/DealerChip.tsx` | New — composition |
| `src/client/components/matches/MatchHistoryRow.tsx` (+ CSS) | Full rewrite, two-layout, new "me" treatment |
| `src/client/components/match/WinnerBanner.tsx` | Crown badge + avatars |
| `src/client/components/scoring/SevenWondersDuelScorer.tsx` | Header avatars + leader crown |
| `src/client/components/scoring/skull-king/*.tsx` | Per Part 3d table |
| `src/client/locales/{en,fr}/common.json` | `studio.*` + frame/ring strings |
| `e2e/avatar-studio.spec.ts` | New |
| `e2e/match-row-me-highlight.spec.ts` | New |

### Out of scope (deferred)

- `avatarCrop` (`{x, y, scale}`) as a separate schema field — we bake the transform into the JPEG.
- "Per-viewer stamp" — frame/ring are owner-controlled, viewer-invariant.
- Stamp on the bottom-nav profile pill / app header — not in the handoff scope.
- Animated stamp transitions / progressive-load polish.

### Reused, not rewritten

- `useCamera` — extended (raw video access), not replaced.
- Existing `Avatar.tsx` — extended.
- Server `sharp` pipeline — unchanged.
- `SketchRect`, `SketchUnderline`, `CatGlyph`, `Icon`, `Pill`, `Button`, `Card`, `Group`, `ThemeToggle` — reused.
- `displayProfileName` viewer-aware override (from PR 6-C) — unchanged.
- `shared.module.css` / `sk/` Skull-King primitives — reused.
- Mock inline-style implementations (`mocks/lib/ob-kit.jsx`, `mocks/studio/*`) are references, NOT code to port.

### Validation

- `npm run lint && npm run type-check` clean.
- `npm test` — full E2E suite green on Mobile Chrome + Mobile Safari.
- `npm run db:migrate && npm run db:seed && npm run db:test:reset` — migration clean both ways.
- Manual on integration deploy:
  1. Gallery upload → reposition → save with custom frame + ring → stamp identical in every list, scorer, banner.
  2. Linked friend with `useLinkedAvatar=true` → Google photo wears the owner's frame + ring choice.
  3. Profile with no photo → initial-letter fallback wears frame + ring.
  4. Match history: only "me" rows highlighted; `/players/$profileId`: none highlighted.
  5. 7WD scorer mid-game: leader's crown badge moves as the score shifts.
  6. Skull King full match: seat badges + avatars on all 7 screens, dealer chip on transition.
  7. Toggle theme: every new surface reads correctly in both `Parchment` and `Candlelit`.

---

## Phase 8: Polish + Distribution → v1.0.0

**Goal**: close every loose end gating the first official release. Broaden the login surface beyond Google (Facebook, with email-keyed account linking; Apple Sign-In deferred to v1.x because it requires the $99/yr Apple Developer Program), ship the public-facing pages needed for friend distribution (install help, privacy, terms), add a personal stats dashboard, fold in two creative additions (achievements, public match share-link), refresh the dev-facing artefacts (screenshot script + graphify graph), and tag `v1.0.0`.

### What's already there (acknowledged, not redone)

- **Real-time sync indicator** — shipped during the local-first refactor (`src/client/components/sync/SyncStatus.tsx`, mounted globally from `__root.tsx`).
- **Rematch button** — fully implemented: `MatchCompleteScreen.tsx:146` (Skull King), `SevenWondersDuelScorer.tsx:277` (7WD), `?rematchOf=` search param + prefill logic in `games/$slug_.new.tsx`.
- **Empty states** — every list screen already has concise prose: `players.empty`, `games.noMatches`, `players.stats.empty`, etc. No "polish" pass needed.

### Status snapshot

| Item | Status | PR landing it |
|---|---|---|
| Real-time sync indicator | ✅ Shipped | (already in `__root.tsx`) |
| Match history filters (game / profile / date) | ⛔ Dropped — existing per-game/per-profile navigation already scopes the lists; filters would duplicate it. Revisit in v1.x at scale. | — |
| Personal stats dashboard | 🟡 Per-profile only (6-B) | PR 8-C |
| Lighthouse PWA audit | 🟡 Infra ready, not run | PR 8-E |
| Install help page (public) | ❌ Missing | PR 8-E |
| v1.0.0 release tooling | ❌ Missing | PR 8-F |
| **Multi-provider auth + account linking** | ✅ Shipped (8-A, #27) | PR 8-A |
| **Privacy + ToS pages** (Facebook prereq) | ✅ Shipped (8-A, #27) | PR 8-A |
| **Account-switch leak** — same-device sign-in as different user sees prior user's matches (surfaced during 8-A testing) | ✅ Shipped (8-B, #28) | PR 8-B |
| **Achievements / badges** | ❌ Missing | PR 8-D |
| **Public read-only match share-link** | ❌ Missing | PR 8-D |
| **App version footer in Settings** | ❌ Missing | PR 8-E |
| **Screenshot-script refresh** (cover post-Phase-5 screens) | ❌ Stale | PR 8-F (end of phase so it captures everything) |
| **Graphify refresh** | ❌ Stale | PR 8-F (end of phase so it captures everything) |

### Phasing — 7 PRs

#### PR 8-A — Multi-provider auth + account linking + Privacy/ToS (`feat/multi-provider-auth`, ~2 days) ✅ DONE (#27)

**Goal**: Facebook sign-in alongside Google, with email-keyed account linking so one user has one `User` row regardless of which provider they've used. Public Privacy + ToS pages required by Facebook's app review. (Apple Sign-In gated behind the $99/yr Apple Developer Program — deferred to v1.x. The provider config is intentionally env-keyed so adding Apple later is a small additive change, not a refactor.)

**Server** (`src/server/lib/auth.ts`):
- Extend `socialProviders` with a `facebook` entry reading `FACEBOOK_CLIENT_ID/SECRET`. Each provider is env-gated so partial deploys hide unconfigured buttons.
- Enable account linking: `account.accountLinking = { enabled: true, trustedProviders: ["google", "facebook"] }`. Email-keyed matching reuses the existing User when a second provider signs in.
- `databaseHooks.user.create.after → ensureSelfProfile` is already provider-agnostic — no change.

**Client login page** (`src/client/routes/index.tsx`):
- Replace the hardcoded "Sign in with Google" block with an `OAUTH_PROVIDERS` config array (`[{ id, labelKey, GlyphComponent }, ...]`) and loop to render buttons.
- Move the inline `<GoogleGlyph>` SVG + new Facebook glyph into `src/client/components/auth/providerGlyphs.tsx`.

**i18n** (`locales/{en,fr}/common.json`): restructure `auth.signInWithGoogle` → `auth.signInWith.{google,facebook}`. Update the single call site.

**Static legal pages** (public, no auth):
- New unauthenticated routes `routes/privacy.tsx` and `routes/terms.tsx` (sibling of `routes/index.tsx`, OUTSIDE `_authenticated/`).
- Content lives as plain React; FR + EN bilingual via existing `i18n` infra. Footer links from both `/` (login page) and `/_authenticated/settings.tsx`.

**E2E** (`e2e/helpers/auth.ts` + new specs):
- Add `loginWithFacebook()` paralleling the existing Google helper. Wire `FACEBOOK_TEST_EMAIL/PASSWORD` for `BASE_URL`-driven deployed runs. Test-mode email/password path unaffected.
- New `e2e/auth-linking.spec.ts`: sign in Google → sign out → sign in Facebook (same email) → assert single `User` row + single self-Profile.

**Env / infra**:
- `.env.example`: add `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`. Coolify env vars set manually on `onboard-prod` + `onboard-integration` (propagates to previews per the topology in `CLAUDE.md`).
- Facebook app registration: single Meta app with production + integration + preview redirect URIs in the Facebook Login allowlist; Privacy URL on App Settings → Basic points to `/privacy`. Localhost is auto-allowed in Dev mode and does not need to be listed.

**Critical files**:

| File | Action |
|---|---|
| `src/server/lib/auth.ts` | Add Facebook to `socialProviders`; enable `accountLinking` |
| `src/client/routes/index.tsx` | Refactor to `OAUTH_PROVIDERS` config + loop |
| `src/client/components/auth/providerGlyphs.tsx` | New — Google + Facebook SVGs |
| `src/client/locales/{en,fr}/common.json` | Restructure `auth.signInWith.*` |
| `src/client/routes/privacy.tsx` | New — public Privacy Policy |
| `src/client/routes/terms.tsx` | New — public Terms of Service |
| `src/client/routes/_authenticated/settings.tsx` | Footer links to /privacy /terms |
| `.env.example` | Add FB vars |
| `e2e/helpers/auth.ts` | Add `loginWithFacebook` |
| `e2e/auth-linking.spec.ts` | New |

**Acceptance**: sign in via Google and Facebook both land on `/games` with the right user. Cross-provider sign-in for an existing email merges to the same User. `/privacy` + `/terms` reachable without auth, both languages.

#### PR 8-B — Scope Dexie reads by viewer (`fix/scope-reads-by-viewer`, ~2 hours) ✅ DONE (#28)

**Goal**: fix the cross-account leak surfaced during PR 8-A testing. On mobile (and any device where a previous user's session was active), signing in as a different user shows the prior user's matches in `/games` because Dexie still carries A's rows and UI reads don't filter by current viewer.

**Why this PR exists**: Phase 5c made Dexie the local source of truth, and UI hooks (`useLiveQuery`) read directly from it. The server's match-visibility predicate (`Match.createdById = me OR EXISTS(Player JOIN Profile WHERE ownerId = me OR linkedUserId = me)`) is enforced on `GET /api/matches` but the client trusts whatever Dexie holds. When a second user signs in on the same device, their pull-sync ADDS their data without PURGING A's, and reads return the union. Decision (from chat): keep all local data (it's not critical, and avoiding purge preserves any unsynced offline writes), and instead scope every read by `viewerId`.

**Branches off**: `main`. Independent of PR 8-A — the visibility logic doesn't require multi-provider auth; PR 8-A just made the bug easy to encounter. Either PR can merge first.

**Approach** — central helper + viewer-keyed hook signatures:

- New `src/client/lib/visibility.ts`:
  - `loadVisibleProfileIds(viewerId): Promise<Set<string>>` — profiles where `ownerId === viewerId OR linkedUserId === viewerId`.
  - `isMatchVisible(match, matchPlayers, viewerId, visibleProfileIds): boolean` — predicate mirroring the server. Cheap to call inside an existing query loop.
- Every read hook that surfaces matches accepts a **required** `viewerId: string | null` and filters before returning. Required-param keeps the type-checker honest per [[feedback_required_params_over_optional]].

**Hooks to scope**:

| Hook | Current | Fix |
|---|---|---|
| `useMatchList(gameId?)` | reads all matches | + required `viewerId`; filter via `isMatchVisible` |
| `useMatch(id)` | reads any match by id | + required `viewerId`; return `status: "missing"` if not visible |
| `useProfile(id)` | reads any profile by id | + `viewerId`; missing if `ownerId !== viewerId && linkedUserId !== viewerId` |
| `useProfileStats(profileId, ...)` | aggregates matches involving the profile | scope the match join by viewer |
| `usePlayedWith(...)` | reads matches | scope by viewer |
| `useHeadToHead(...)` | reads matches between two profiles | scope by viewer |
| `useProfileRecentMatches(...)` | reads matches involving a profile | scope by viewer |
| `useProfileSuggestions(...)` | reads profiles | scope by `ownerId === viewerId` if not already |
| `useProfileList(viewerId)` | already scoped ✓ | — audit only |
| `useSelfProfile(viewerId)` | already scoped ✓ | — |
| `useOwnedProfileIndex(viewerId)` | already scoped ✓ | — |
| `useGame/useGames` | game templates (global) | — no scoping needed |

**Call sites** to update (pass `session.user.id` through):
- `src/client/routes/_authenticated/matches/$id.tsx` — useMatch
- `src/client/routes/_authenticated/games/$slug.tsx` — useMatchList
- `src/client/routes/_authenticated/players/$profileId.tsx` — useProfile, useProfileStats, useProfileRecentMatches, etc.
- `MatchHistoryRow.tsx` — if it reads anything itself
- Stats dashboard (PR 8-C, builds against the new scoped hooks)

**E2E** (`e2e/account-switch.spec.ts`): in TEST mode, sign up as user A via email/password → create a 7WD match → sign out → sign up as user B (different email, same context) → navigate to `/games/7-wonders-duel` → assert A's match is NOT in the history → assert B's empty-state shows correctly. Drive through UI, not API.

**Acceptance**:
- After A signs out and B signs in on the same device, B sees zero matches (B is new), A sees their full history when they sign back in.
- No `npm run lint` / `npm run type-check` regressions.
- All existing E2E specs still pass (the new viewerId param means every consumer compiles correctly).
- The fix also closes the same-provider variant (two Google accounts on one device).

**Critical files**:

| File | Action |
|---|---|
| `src/client/lib/visibility.ts` | New — `loadVisibleProfileIds` + `isMatchVisible` |
| `src/client/hooks/data/useMatchList.ts` | + `viewerId` param, filter |
| `src/client/hooks/data/useMatch.ts` | + `viewerId` param, visibility gate |
| `src/client/hooks/data/useProfiles.ts` | Audit + scope the 8 exports |
| `src/client/routes/_authenticated/games/$slug.tsx` | Thread `session.user.id` |
| `src/client/routes/_authenticated/matches/$id.tsx` | Same |
| `src/client/routes/_authenticated/players/$profileId.tsx` | Same |
| `src/client/components/matches/MatchHistoryRow.tsx` | If it reads from Dexie, scope; otherwise — |
| `e2e/account-switch.spec.ts` | New |

**Out of scope** (deferred):
- Force-purge on sign-out — explicitly NOT done per chat decision; reads are scoped instead so prior-user data stays available if they sign back in.
- Tombstones / explicit "this row is stale" markers — not needed because the viewer filter rejects all cross-account rows reactively.
- Cross-tab session-mismatch detection — same-device same-tab covers the reported bug; multi-tab is a future hardening.

#### PR 8-C — "Your stats" dashboard (`feat/stats-dashboard`, ~1.5 days)

**Goal**: viewer-personal dashboard — "your stats". Framed top-to-bottom as the signed-in user's own performance, with a single panel showing where they rank vs linked friends per game.

**Why no match filters**: the existing per-game (`games/$slug.tsx`) and per-profile (`players/$profileId.tsx`) navigation already scopes the match lists end-to-end. Adding overlay filter chrome would duplicate the work the navigation already does, at a match volume (<50) where scrolling is fine. Revisit in v1.x if/when match volume makes the lists painful.

**Layout** (`routes/_authenticated/stats/index.tsx`, all reads via `useLiveQuery` over Dexie — no server change):
- **Hero strip** — your totals: matches played, matches completed, total wins, overall win-rate. Plus two "favourites" pills: most-played game, most-played opponent (any Profile co-played, including unlinked aliases — see _Definitions_ below).
- **Per-game cards** — one card per game you've played. Each card shows YOUR data for that game: win-rate, current win streak, longest streak, best single-match score, total matches at this game. Empty card with "play your first match" CTA if you haven't played that game.
- **Per-game rankings panel** — per game, a small ordered table of every Profile visible to the viewer that has played at this game (you + owned aliases + non-owned profiles surfaced through shared matches), ranked by **raw wins** (primary) → win-rate (tiebreaker, rewards efficiency at equal wins) → completed-match count → alias. Win-rate is still shown alongside the wins count to compensate the heavy-volume player whose absolute wins outpace a more efficient low-volume opponent. The earlier 3-match gate was dropped during 8-C testing: with wins as the primary key there's no small-sample blowout to guard against (a 100% rate from 1 match can't dominate a 50% rate from 20 anymore). Your row highlighted using the existing "me" treatment from Phase 7.
- **(No achievements row in this PR.)** Deliberately not scaffolded — the row lands in PR 8-D (achievements + share-link) so this PR doesn't ship an empty placeholder.

**Definitions** (pin down ahead of implementation so the hooks don't drift):
- **Visible profiles** = whatever `loadVisibleProfileIds(viewerId)` from PR 8-B returns, i.e. profiles where `ownerId === viewerId OR linkedUserId === viewerId`, **plus** any other Profile that appears as a Player in a Match visible to the viewer (i.e. you've shared at least one match with that profile through any owner). The rankings panel iterates this set, not just linked friends.
- **"Most-played opponent"** = any Profile other than the viewer's own self-Profile, counted by appearances in completed visible matches. Unlinked aliases ("Mum") and friends-of-friends-but-not-linked both count.
- **Win** = the viewer's Profile placed 1st outright (no tie) in a completed match. Ties at 1st do NOT count as wins.
- **Streak ordering** — completed matches are ordered by `completedAt` (the experience-time, not `playedAt`). A loss / tied-1st / non-1st result breaks the streak. Incomplete matches are ignored; if they're later completed as a loss, their `completedAt` slots them naturally into the order.
- **Current streak** = consecutive wins ending at the most recent completed match. 0 if the latest completed match wasn't a win.
- **Max streak** = longest run of consecutive wins in the viewer's full completed-match history.
- **Rankings sort** = `wins` desc → `winRate` desc → `completedMatches` desc → alias asc. Wins-as-primary makes a 3-match minimum unnecessary; row meta renders as `{wins}W · {rate}% · {matches}m` so the rate stays visible as context for high-volume comparisons.

Stats tab added to bottom-nav between Games and Players (icon `bar-chart-2` — add to `Icon.tsx` if not already present). i18n: `nav.stats`, `stats.*`.

**Hooks** (`src/client/hooks/data/`):
- `useMyStats()` — totals + favourites for the signed-in user.
- `useMyGameStats(gameId)` — per-game personal numbers (rate, streak, best).
- `useGameRankings(gameId)` — small ordered list (me + linked friends) for the friend rankings panel.

**E2E** (`e2e/stats-dashboard.spec.ts`): seed matches with known outcomes; assert the user's totals + per-game numbers + ranking position match a hand-computed reference. UI-driven, no API shortcuts.

**Critical files**:

| File | Action |
|---|---|
| `src/client/routes/_authenticated/stats/index.tsx` | New — personal dashboard |
| `src/client/hooks/data/useMyStats.ts` | New |
| `src/client/hooks/data/useMyGameStats.ts` | New |
| `src/client/hooks/data/useGameRankings.ts` | New |
| `src/client/components/layout/BottomNav.tsx` | Add Stats tab |
| `src/client/components/ui/Icon.tsx` | Add `bar-chart-2` if missing |
| `src/client/locales/{en,fr}/common.json` | `stats.*`, `nav.stats` |

**Acceptance**: stats numbers match a hand-computed reference for a seeded fixture; the dashboard updates within seconds of a new match completing (`useLiveQuery` reactivity); the friend-rankings panel shows the viewer's own row highlighted.

#### PR 8-D — Achievements + public match share-link (`feat/achievements-and-share`, ~3 days)

**Goal**: two creative additions chosen during planning. Independent of each other; bundled because each is small. Sequenced before the install/Lighthouse PR so the dashboard's achievements row lands while the stats work is still fresh and so the install-help/audit PR captures the final UI surface.

**Achievements (client-only, no schema change)**:
- Fixed set v1: `firstWin` (any game), `tenWins[gameId]` per game played, `winStreak5` (5 completed matches in a row won, same game), `biggestBlowout[gameId]` (largest winning margin recorded). All computed live in Dexie via a new `useAchievements(profileId)` hook over `matches` + `scores` joined to `players`. Takes any `profileId` so the same hook + component works for self and for friends.
- `<AchievementsRow profileId>` mounted in TWO surfaces:
  1. **Your stats** page (`routes/_authenticated/stats/index.tsx`) — added below the per-game cards. PR 8-C deliberately did not scaffold a placeholder; this PR introduces the row itself.
  2. **Profile detail** page (`routes/_authenticated/players/$profileId.tsx`) — below the existing stats panel, passing the visited profile id. Shows what your friend has unlocked.
- Each stamp: `<Icon>` + i18n label + unlocked-date. Locked achievements not shown in v1 (no "0/10" teasers — keeps the surface clean for the small initial set).
- `Icon` additions: `trophy`, `medal`, `flame`, plus a rotated/recoloured `crown` for `tenWins`.

**Match share-link (server-backed, public route)**:
- Schema (`prisma/schema.prisma`): new `MatchShareToken { id String @id @default(cuid()); matchId String @unique; createdById String; createdAt; matchRef Match @relation(...) }`. One token per match, owner-only creation. No expiry in v1 — owner can revoke.
- Server:
  - `POST /api/matches/:id/share-token` — owner creates a token (idempotent — returns existing if present). Returns `{ token, url }`.
  - `DELETE /api/matches/:id/share-token` — owner revokes.
  - `GET /api/share/:token` — public, no auth. Returns minimal payload: game name + slug, completedAt, players (alias + final score), winner, victoryType. No `profileIds`, no `createdById`, no extraneous metadata.
- Client:
  - Public route `routes/share.$token.tsx` (outside `_authenticated/`). Renders the summary using the same `MatchHistoryRow`-style layout for visual consistency, plus an "Install OnBoard to track your own matches" CTA linking to `/install` (added by PR 8-E) + the login page. Until 8-E lands, the CTA can point at `/` — the link target is swapped in 8-E without touching this PR.
  - Open-Graph meta tags rendered server-side via Hono's static-file branch for the `/share/:token` URL so chat-app unfurls show the matchup. (Single-purpose exception to the SPA-only stance; document the rationale next to the handler.)
  - "Share match" action on `MatchCompleteScreen.tsx` (SK) and end-of-match state in `SevenWondersDuelScorer.tsx`: dialog with the `/share/:token` URL + copy button + revoke option. Uses Web Share API where available, fallback to clipboard.
- E2E: owner shares match → unauthenticated context loads `/share/:token` and sees the right data → owner revokes → public route now 404. Verify OG meta tags via `page.evaluate` against `<head>`.

**i18n**: `achievements.{firstWin, tenWins, winStreak5, biggestBlowout}` + `share.{cta, copyLink, revoke, installCta}` etc.

**Critical files**:

| File | Action |
|---|---|
| `prisma/schema.prisma` | Add `MatchShareToken` + migration |
| `src/server/routes/matches.ts` | Add share-token endpoints |
| `src/server/routes/share.ts` | New — public `GET /api/share/:token` |
| `src/server/app.ts` | Public `/share/:token` HTML handler with OG meta SSR |
| `src/client/routes/share.$token.tsx` | New public route |
| `src/client/hooks/data/useAchievements.ts` | New |
| `src/client/components/profiles/AchievementsRow.tsx` | New — takes `profileId` prop, used in both surfaces |
| `src/client/routes/_authenticated/players/$profileId.tsx` | Mount achievements row for the visited profile |
| `src/client/routes/_authenticated/stats/index.tsx` | Mount achievements row for the viewer's self-Profile |
| `src/client/components/scoring/skull-king/MatchCompleteScreen.tsx` | Share dialog |
| `src/client/components/scoring/SevenWondersDuelScorer.tsx` | Share dialog |
| `src/client/components/ui/Icon.tsx` | Add achievement glyphs |
| `src/client/locales/{en,fr}/common.json` | `achievements.*`, `share.*` |
| `e2e/achievements.spec.ts` + `e2e/share-link.spec.ts` | New |

**Acceptance**: a fresh user wins their first 7WD match → "First Win" stamp appears on their stats + profile within seconds (`useLiveQuery` reactivity). A completed match's share URL renders publicly with the right data, unfurls correctly in iMessage/Slack previews, revoke kills it on the next request.

#### PR 8-E — Public install help + Lighthouse audit + Settings version footer (`feat/install-help-and-lighthouse`, ~1 day)

**Goal**: every loose-end gating a friend's "go install OnBoard" experience. Dev-asset refresh (screenshots + graphify) is deliberately deferred to PR 8-F so it captures the final state of everything, not a snapshot that gets invalidated by 8-D's UI work.

**Public install-help page**:
- New route `routes/install.tsx` (outside `_authenticated/`). Two collapsible sections: iOS (Safari → Share → Add to Home Screen) and Android (Chrome → menu → Install app). Detects platform via UA hints, expands the relevant section by default. Uses placeholder/existing screenshots from `plan-assets/` — refreshed assets land in 8-F.
- Linked from the login page footer.
- Re-point the share-link page's install CTA (introduced in 8-D) at `/install`.
- The authenticated install-prompt UI in `settings.tsx` stays — the new `/install` page is for friends arriving from a chat link who haven't signed in yet.

**Lighthouse audit + manifest polish**:
- Run Lighthouse against integration with mobile + desktop presets.
- Manifest gaps to close in `vite.config.ts`: add `shortcuts[]` for "New match" + "Stats". Verify `purpose: "maskable"` icon has the recommended safe-area padding.
- `screenshots[]` deferred to PR 8-F (depends on the asset refresh). Lighthouse installability + PWA-quality checks don't require `screenshots[]` for a passing score.
- Fix any sub-100 finding the audit surfaces.

**Settings additions** (`routes/_authenticated/settings.tsx`):
- App version footer: `OnBoard v{packageVersion} • {gitSha.slice(0,7)}`. Inject `__APP_VERSION__` and `__GIT_SHA__` via Vite `define` in `vite.config.ts`. `gitSha` comes from a `GIT_SHA` build arg passed by the Dockerfile.
- (No formal feedback link — the app's audience is friends who can reach the owner directly.)

**Critical files**:

| File | Action |
|---|---|
| `src/client/routes/install.tsx` | New — public install guide |
| `src/client/routes/index.tsx` | Footer link to `/install` |
| `src/client/routes/share.$token.tsx` | Re-point install CTA at `/install` |
| `vite.config.ts` | Add `shortcuts[]` to manifest; `define` for version+SHA |
| `src/client/routes/_authenticated/settings.tsx` | Version footer |
| `Dockerfile` | Pass `GIT_SHA` build arg |

**Acceptance**: Lighthouse PWA criteria pass against integration (mobile + desktop). Logged-out visitor can reach `/install` from `/`. Settings shows `v0.x.y • abc1234`.

#### PR 8-F — Dev-asset refresh + v1.0.0 release (`release/v1.0.0`, ~1 day)

**Goal**: regenerate the dev artefacts now that everything in 8-A/B/C/D has landed, then cut the version and deploy to production.

**Screenshot script refresh** (`scripts/capture-screenshots.ts`):
- Audit current screen coverage against the post-Phase-8 surface. Add: Players tab (`/players`), profile detail (`/players/$id`), Avatar Capture Studio's 4 states, every Skull King screen (start, bidding, bid recap, round result, transition, complete, scoreboard), Stats dashboard, Install help page, public share-link page, login page with both providers visible, Privacy + ToS pages.
- Re-render `plan-assets/screenshots/` for every covered screen.

**Manifest `screenshots[]`** (`vite.config.ts`):
- Add `screenshots[]` referencing a curated subset (login, games, scorer, profile detail, stats — 5 representative shots in mobile viewport).

**Graphify refresh**:
- Run `graphify update .` to ingest the post-Phase-8 code into `graphify-out/`. Commit as one `chore(graphify)` at HEAD; run `/squash-graphify` if multiple accumulate during the phase.

**Release**:
- Bump `package.json` to `"version": "1.0.0"`.
- New `CHANGELOG.md` at repo root, with one entry per merged phase from this `PLAN.md` (Phase 0 through Phase 8, plus 5b/5c/8b notes). Keep `PLAN.md` present for now — Phase 8b's doc pass migrates it to a CHANGELOG-only model.
- Tag `v1.0.0`, push tag. Coolify production deploy fires automatically per `.github/workflows/deploy-prod.yml`.
- Smoke test on production: login via each provider, create a match in each game, install on a real phone, verify share-link unfurls.
- Update this Phase 8 section to mark PRs 8-A through 8-F as ✅ DONE; PR 8-G (doc pass) begins once v1.0.0 is verified in production.

#### PR 8-G — Documentation pass (`chore/docs-pass`, post-v1.0.0, ~1.5 days)

**Goal**: Replace the bootstrap-era doc set with a stable reference, now that v1.0.0 is shipped and the architecture has settled. The final sub-PR of Phase 8. Runs AFTER PR 8-F has tagged v1.0.0 — no user-facing changes, no version bump (or a `1.0.1` docs-only bump if you prefer).

PR 8-F creates an initial `CHANGELOG.md` seeded from Phase 0–8 entries; 8-G finishes the migration by promoting/expanding the doc set, then removes `PLAN.md` itself.

The gap today: project description, data model, auth flow, game rules, public surfaces (install / privacy / terms / share-link), and API surface are scattered across `CLAUDE.md`, `PLAN.md`, source comments, and one offline-specific doc. Writing it earlier would have produced churn — this PR parks the work behind the v1 freeze.

**What to write**:

- **README rewrite** — currently bootstrap-only. Replace with: what OnBoard is, who it's for, the offline-first stance, install instructions (link to the public `/install` page shipped in 8-E), link to the doc set below.
- **`docs/architecture.md`** — companion to `docs/offline-architecture.md`, covering what offline doesn't:
  - **Data model**: Profile / Player / Match / Score / `MatchShareToken` relationships; single-Profile model; `ownerId` + `linkedUserId` semantics; the `avatarFrame` / `avatarRing` stamp model from Phase 7.
  - **Auth flow**: better-auth with Google + Facebook (wired in 8-A; Apple deferred to v1.x — see Out of scope). Session cookie semantics. **Email-keyed account linking** — one `User` regardless of which provider signed in. Link-token HMAC for profile-to-account binding (from 6-C).
  - **Profile-linking model**: bilateral QR scan, merge-on-collision, unlink propagation.
  - **Sync engine** internals at a higher level than `offline-architecture.md`'s deep dive: client-CUID idempotency, push/pull with `since=` cursor, LWW on `updatedAt`.
  - **Stats engine** (from 8-C): viewer-personal computation pattern (`useMyStats`, `useMyGameStats`, `useGameRankings`) — all derived from Dexie via `useLiveQuery`, no server endpoint.
  - **Achievements engine** (from 8-D): client-only computation over `matches` + `scores`, same `useLiveQuery` pattern; fixed v1 set; same `<AchievementsRow>` works for self and friends.
  - **Match share-link** (from 8-D): `MatchShareToken` table, public unauthenticated `/share/:token` route, OG meta tags rendered server-side as a **deliberate exception** to the SPA-only stance — document why and where.
  - **Build-time version injection** (from 8-E): how `__APP_VERSION__` and `__GIT_SHA__` flow from `package.json` + Docker build arg into the Settings footer.
- **`docs/games/{skull-king,7-wonders-duel}.md`** — per-game rules + scoring tables + variant matrix. Currently lives as comments next to the scoring functions; promoting it makes the rules legible without reading TypeScript and gives a home for screenshots.
- **`docs/api.md`** — route reference (request / response shapes, auth requirements, error codes). Cover the post-Phase-8 surface in full:
  - `/api/auth/*` (better-auth handlers for Google + Facebook)
  - `/api/games`, `/api/matches`, `/api/profiles`, `/api/profile-groups` (legacy CRUD)
  - Profile link/unlink/merge + link-token endpoints (from 6-C)
  - Avatar upload/delete (from 6-B)
  - **Share-token endpoints** (`POST` / `DELETE /api/matches/:id/share-token`, `GET /api/share/:token`) from 8-D
  - Generated from the Hono route handlers if practical; hand-written otherwise.
- **`docs/public-surfaces.md`** (NEW) — short reference for the five unauthenticated routes that ship by v1.0: `/` (login), `/install` (PWA install guide), `/privacy`, `/terms`, `/share/:token`. What each is for, what it shows logged-out, how it integrates with auth.
- **`CONTRIBUTING.md`** — fold in the conventions that currently live in `CLAUDE.md` and aren't AI-instruction-specific (lint rules, test conventions, commit style, branch workflow, the multi-provider env-var setup, Coolify topology). `CLAUDE.md` keeps its AI-targeted material.

**What to retire**:

- **`PLAN.md`** → fully migrated into `CHANGELOG.md` (the initial CHANGELOG.md from PR 8-F becomes the canonical history; remaining PLAN.md narrative is folded in). `PLAN.md` is then removed.
- Scattered scoring rules in source comments → migrate to `docs/games/*.md`, leave a one-line pointer in the source.

**Acceptance**: a new contributor can clone the repo, read `README.md` → `docs/architecture.md` → `docs/public-surfaces.md` → `docs/api.md`, and understand the system without reading any source code. `CLAUDE.md` no longer duplicates content that lives in `docs/`. The doc set reflects the actual three-provider auth model, achievements + share-link surfaces, and the public-route SSR exception.

### Validation

End-to-end gate before tagging v1.0.0:

- `npm run lint && npm run type-check && npm test` clean.
- Lighthouse PWA criteria pass on integration (Mobile + Desktop).
- All three OAuth providers verified manually on integration with real accounts.
- Account-linking: sign in Google → log out → sign in Facebook (same email) → still one `User` row + one self-Profile + one match history.
- Public surfaces work logged-out: `/`, `/install`, `/privacy`, `/terms`, `/share/<token>`.
- Stats dashboard matches a hand-computed reference for a seeded fixture; achievements unlock live without reload after a winning match completes.
- Share-link copy → paste in iMessage + Slack + WhatsApp → unfurl shows match summary; revoke → next request 404.
- Screenshots refreshed in `plan-assets/screenshots/`, manifest `screenshots[]` references them, install on a real phone shows them in the OS install card.
- `graphify-out/` matches HEAD.
- Production deploy succeeds; v1.0.0 tag visible on GitHub; CHANGELOG entry for the release.

### Out of scope (deferred to v1.x or Phase 9+)

- Match history filters — existing per-game/per-profile navigation already scopes the lists; revisit at match-volume scale in v1.x.
- Magic-link / email auth — Facebook already covers the alternative-provider ask for v1.0.
- **Apple Sign-In** — requires the $99/yr Apple Developer Program to register a Services ID + Sign in with Apple key. Decided during PR 8-A planning that the recurring cost wasn't worth it for a friend-circle PWA where every Apple-ID user can sign in via Google or Facebook instead. The provider config in `auth.ts` is intentionally env-gated so adding Apple later is a small additive change (re-add the provider block, the Apple glyph, the i18n key, and the `APPLE_*` env vars), not a refactor.
- Per-match notes / match duration display — not enough weight to delay v1.0; revisit if friends ask for them.
- Phase 9 (Skull King Rascal variant) ships post-v1.0 as v1.1.

---

## Phase 9: Skull King — Rascal Variant

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
