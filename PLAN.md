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

**Goal**: Close the gaps left by Phase 5 — most importantly, let users start *and* play a match end-to-end with no network.

### Shipped

- **Offline login redirect** — a previously-authenticated user with a cached session lands on `/games` instead of being stranded on the login screen. (`src/client/routes/index.tsx`)
- **Self suggestion always available** — `usePlayerSuggestions` synthesizes the current user from the auth session, falls back to Dexie `localProfiles` when offline, and merges with the server response when it arrives.
- **Match-detail offline cold-start** — `usePrefetchGames` hydrates `["matches", id]` from the list response (which already includes players + scores), so any past match opens instantly offline.
- **`matchDrafts` flow for offline match creation** — synthetic match seeded into the cache, queued POST, scorers route through `syncEngine.enqueue` for draft ids, reconciliation rewrites draft → real ids on flush. Match page shows a "Draft" badge until reconciled.
- **SW update prompt** — `registerType: "prompt"` + `UpdateBanner` mounted from `__root.tsx`. The new precache is fully populated before the user accepts the reload — eliminates the stale-precache window observed during PR #8 testing.

### Documented in `docs/offline-architecture.md`

- The login-when-offline policy
- Player suggestions three-tier resolution
- Match-drafts reconciliation (id resolution map)
- "Where offline runs" — Dexie + SW work in every modern browser, not just installed PWAs

### Validation

- Create + score a match end-to-end with WiFi off the entire time, reconnect, see it sync correctly.
- Deploy a new build while a tab is open; the user is prompted, accepts, and the new version is fully available offline immediately.
- Self chip is the first suggestion on a brand-new install with no match history.

### Follow-up (not in 5b)

- If the font precache miss observed during PR #8 reappears after the SW update flow ships: add the woff2 URLs to `runtimeCaching` with `CacheFirst` as a backstop.
- The architectural feedback from PR #11 review was split into Phase 5c (data model) and Phase 5d (GameClient abstraction) — see below. Phase 5b remains scoped to offline-first; the refactors land in their own PRs.

---

## Phase 5c: Users as first-class entities

**Goal**: Replace name-based unregistered-player references with proper `User` entities, owned by their creator until linked to an auth account.

**Why before more games or features**:
- Today's name-only matching is unstable (case/typo collisions, same-name friends — see PR #11 review comment #2)
- The link-friend-account feature in Phase 6 needs a stable cross-match reference
- The Phase 5d GameClient abstraction's surface is cleaner with unambiguous user ids — building it against today's nullable-userId model and rewriting after 5c would waste work
- Phase 7 (Skull King Rascal) and any future game add complexity to the per-game data layer; better to lock the model first

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
3. **Offline creation of unclaimed users**: typing a brand-new name in the new-match form when offline becomes TWO writes — `POST /api/users` then `POST /api/matches`. The sync engine's id-substitution map (currently match id + per-position player ids) must extend to **user ids**: when a queued POST /api/users succeeds, map `draftu_<uuid>` → real `userId`; subsequent queued POST /api/matches bodies referencing `draftu_xxx` get rewritten before fetch.
4. **Migration**: every existing Player without `userId` → create a User per `(creator, distinct case-insensitive name)` tuple, attribute `Player.userId`, retain the original name on Player as a migration audit trail (or move it to `User.alias`). Reversibility via the audit trail.
5. **Auth integration / claiming**: how does an unclaimed User become claimed? Options: (a) on Google sign-in, if email matches an unclaimed User any creator owns, prompt the new auth user to claim it; (b) the creator explicitly invites via email link; (c) deferred to Phase 6.
6. **First-launch UX**: a brand-new authenticated user has no owned-users pool. The "self" entry in suggestions is them; the next entries come from creating new owned users inline as they type names in the new-match form.
7. **Offline reads of the user list**: like matches, the user's own list should be prefetched + persisted to TanStack cache, with a Dexie mirror for the offline write queue.

### Files likely affected

- `prisma/schema.prisma` — schema change + migration
- `src/server/routes/users.ts` (new) — list/create/patch + suggestions filter
- `src/server/routes/matches.ts` — Player creation now references existing User; reject names without matching User
- `src/server/routes/players.ts` — collapsed into users or removed
- `src/client/hooks/usePlayerSuggestions.ts` → `useUserSuggestions` or `useOwnedUsers`
- `src/client/lib/sync.ts` — user id substitution
- `src/client/routes/_authenticated/games/$slug_.new.tsx` — autocomplete from owned users; "create new user" inline
- `src/client/routes/_authenticated/users/` (new section?) — manage owned users
- `src/client/lib/db.ts` — likely a `users` Dexie mirror; revisit `localProfiles`

### Validation

- Existing match flows (create, score, complete) keep working with the new model
- An offline-created brand-new user reconciles correctly on reconnect (POST /users replayed, then POST /matches with substituted id)
- A friend with the same name as the logged-in user no longer collides on suggestions
- Migration is reversible for at least one rollback window

---

## Phase 5d: GameClient abstraction

**Goal**: Extract data-access logic from scorer components into per-game clients with a shared base. Components stay focused on UI + local state; data layer becomes independently testable.

**Why after 5c**:
- Score payloads and player references will reshape with first-class Users
- A new "create user inline" action becomes a fourth client method
- Building against today's model and rewriting wastes effort

### Criteria (from the user)

- Mutualize as much code as possible across games
- Clear responsibility split: global action/layer logic in the generic client, per-game data shaping (UI state → payload) in the specific client
- Per-game clients live in dedicated files
- Each action in the client decides which of the three layers applies (server, cache, local DB) — configurable so a per-game client can declare it doesn't need a particular layer

### Sketch (revisit at implementation time)

```
src/client/lib/match-client/
  types.ts          # SaveScoresInput, PatchInput, CompleteInput contracts
  match-client.ts   # createMatchClient({ match, queryClient, setSaveStatus })
                    # → { saveScores, patchMatch, completeMatch, ... }
                    # owns: draft detection, online vs offline routing,
                    #       optimistic cache writes, saveStatus lifecycle,
                    #       syncEngine.enqueue, matches list invalidation
  use-match-client.ts  # React hook: useMatchClient(match) wraps the above
                       # via useMutation so components get isPending etc.
  seven-wonders.ts  # buildScorePayload(values) — pure data shaping
  skull-king.ts     # buildScorePayload(round, entries),
                    # buildPersistDraftPatch(...) — pure data shaping
```

### Generic client responsibilities

- Online happy path: `api()` call
- Draft (id starts with `draft_`): `applyOptimistically()` + `syncEngine.enqueue()` + return resolved
- Offline error on a real match: same as draft
- `saveStatus` lifecycle (saving → saved → idle, or → offline / error)
- Cache invalidation rules (e.g. `["matches", id]`, `["matches"]` list)

### Per-game responsibilities

- Pure data builders: turn UI state into the payload shape the generic client consumes
- Game-specific callbacks for cases the generic can't handle (variant-specific score rules, custom phase transitions, etc.)

### Validation

- All existing scorer behavior preserved (E2E suite passes unchanged)
- New unit tests for the client run without React / UI
- Phase 7 (Skull King Rascal) becomes the third client and validates the abstraction's generality

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
