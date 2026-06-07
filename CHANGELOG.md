# Changelog

All notable changes to OnBoard, organised by phase per `PLAN.md`.

The format follows [Keep a Changelog](https://keepachangelog.com/), grouped by
phase rather than calendar release since v1.0.0 is the first public cut.

## [1.0.0] — 2026-06-07

First public release of OnBoard — a board-game score tracker built for a small
friend circle, offline-first, installable as a PWA, with rich per-game scorers
for 7 Wonders Duel and Skull King.

### Phase 0 — Project bootstrap + deployment

- Vite + React 19 + TypeScript + TailwindCSS scaffold; Hono server mounted as a
  Vite middleware plugin (single process, single port).
- PostgreSQL 16 (dev + test DBs), Prisma init, Docker multi-stage build.
- ESLint flat config, Playwright (Mobile Chrome + Mobile Safari), CI workflows
  (`ci.yml`, `deploy-prod.yml`, `e2e-deployed.yml`).
- Coolify topology: `onboard-integration` (auto-deploy on `main`, hosts per-PR
  previews) + `onboard-prod` (manual deploy on release).

### Phase 1 — Auth + data model + i18n

- `better-auth` integration with session cookies; email-keyed account model so
  any provider resolves to the same `User` row.
- Prisma schema for `Game`, `Match`, `MatchPlayer`, `Score` with seeded game
  templates (`7-wonders-duel`, `skull-king`).
- `react-i18next` setup with browser-language detection (en/fr).

### Phase 2 — 7 Wonders Duel scorer

- Per-category scoring (civil, scientific, commercial, guilds, wonders,
  treasury, military) with live totals + winner banner.
- Match list, match detail, "new match" form scaffolding shared across games.

### Phase 3 — Branding + UX

- Brand identity (Parchment/Candlelit themes, Caveat + JetBrains Mono type
  scale, wax-seal red + forest-teal accents).
- Component library — `Button`, `Input`, `Pill`, `Group`, `Icon` set, `Avatar`,
  `BottomNav`, `Header`.
- Logo SVG, animated boot intro, theme toggle.

### Phase 4 — Skull King scorer

- Classic-variant scoring across 10 rounds: bidding screen, bid recap, result
  with trick + bonus inputs (mermaid/pirate/14s), round transition, scoreboard
  overlay, match-complete winner banner.
- Per-game match-history shape extended for round-keyed scores.

### Phase 5 — Offline-first foundation

- `vite-plugin-pwa` integration; manifest + service worker (Workbox).
- Initial Dexie tables (`matches`, `players`, `games`).
- `useOnlineStatus`, `OfflineBanner`, sync queue scaffolding.

### Phase 5b — Stabilization cherry-picks

- Offline auth fallback keyed on better-auth fetch errors (not `navigator.onLine`)
  so captive portals and DevTools throttling behave the same.
- SW switched to `prompt` mode + `UpdateBanner` so new versions activate
  explicitly (no stale-precache window).
- Server returns full match shape on POST `/api/matches`; matches list response
  includes `game.id` to align with the detail shape.
- `RESET_DB` deploy toggle for preview/integration (hard-blocked on production).

### Phase 5c — Local-first refactor

- Rebuilt around a single source of truth in Dexie. The TanStack Query layer
  became thin orchestration over Dexie reads (`useLiveQuery`); server writes go
  through the sync queue with idempotent client-generated CUIDs.
- Pull-sync engine with per-table `?since=` cursors; full-pull on auth mount to
  cover device-cache eviction and shared-device user-switches.
- Sync queue persists across reloads; `SyncStatus` pill surfaces in-flight
  writes; `SyncFailedBanner` surfaces hard failures.

### Phase 6 — Profiles, Players tab, avatars, link-to-account

- **Profile MVP**: one `Profile` per player (linked-to-user or unclaimed),
  `Player` row per match-participant joins back to a Profile. `ownerId`
  captures which viewer created the unclaimed Profile.
- **Player picker** with played-with suggestions, alias-collision detection,
  and a self-suggestion synthesised from the auth session.
- **Avatars**: uploader → reposition (crop) → style (frame + ring) → saved.
  Owner-uploaded files served from `/api/uploads/avatars/*` with a Coolify
  persistent storage at `/app/uploads`.
- **Link-to-account via QR**: ephemeral signed link tokens (HMAC), shown as a
  QR code from one device and scanned from another to bind an unclaimed
  Profile to its real account. Merge dialog handles same-user duplicates.

### Phase 7 — Avatar & match-row design refactor

- Avatar stamp model with three frames (`circle`, `rounded`, `tag`) and a
  category-coloured ring for 7WD victory specialty.
- Match-row redesign with score chips, winner crown, "me" highlight, and
  per-game cover art.

### Phase 8 — Polish + distribution → v1.0.0

#### 8-A Multi-provider auth + Privacy/ToS
- Google + Facebook providers via `better-auth`; first provider wins the
  account, subsequent providers link to the same `User` via email match.
- Public `/privacy` and `/terms` pages, linked from the login footer.

#### 8-B Scope Dexie reads by viewer
- Every Dexie query filtered by the logged-in `viewerId` so a shared device
  doesn't leak a previous user's matches/profiles to the new viewer.

#### 8-C "Your stats" dashboard
- `/stats` route with hero (matches, wins, win rate), per-game breakdown,
  favourite-game + favourite-opponent insights.

#### 8-D Achievements + public share-link
- 20 achievements (first-win, win-streak, biggest blowout, perfect-call SK,
  scientist 7WD, comeback, sealed-lips, sidekick, the-link, habit, etc.)
  rendered on the Stats page.
- Public match-summary share-link (`/share/:token`) — server-side OG meta
  injection so chat apps unfurl the matchup, in-app share-sheet from the
  match-detail page.

#### 8-E + 8-F Sync queue visibility + recovery
- Settings → Sync panel renders every pending/failed/blocked/discarded entry,
  with Retry and Discard per-entry, cascade-discard for blocked dependents,
  and per-cascade collapse-toggle.

#### 8-G Delete match + delete profile
- Trash actions with soft-delete tombstones, cascading dependent cleanup, and
  a confirm dialog that surfaces what else gets removed.

#### 8-H Local↔server model consistency audit
- Compile-time guard (`scripts/check-model-drift.ts`) so Dexie's `LocalMatch`
  / `LocalProfile` types stay structurally aligned with the Prisma server
  schema; CI fails on drift.

#### 8-I Public install help + Lighthouse polish + version footer + share-app
- Public `/install` page (outside `_authenticated/`) with app-store-style
  hero, features bullets, mobile screenshots strip, and collapsible iOS +
  Android install steps with UA-driven default-open.
- Settings → Share OnBoard button using the Web Share API with clipboard
  fallback.
- Settings → version footer: `OnBoard v{packageVersion} · {sha7}` via Vite
  `define`, sourced from Coolify's auto-injected `SOURCE_COMMIT` build arg.
- PWA manifest gains `shortcuts[]` (New match → `/games`, Stats → `/stats`)
  and `screenshots[]` (6 curated narrow PNGs from the refreshed capture set).
- Cache-bust suffix `?v=__APP_VERSION__` on every stable-filename static
  asset (icons, favicon, screenshots) so a version bump invalidates them.
- Lighthouse audits on `/install` against the preview deploy ended at
  **Performance 87 mobile / 95 desktop, Accessibility 100, Best Practices
  100, SEO 100**. Round-by-round trajectory documented in the PR.

#### 8-J Dev-asset refresh + v1.0.0 release
- `scripts/capture-screenshots.ts` extended for the post-Phase-8 surface
  (stats dashboard, achievements tab, install help, share-link page,
  privacy/terms, login with both providers visible, avatar studio's 4-state
  hub/camera/reposition/style flow, current link-panel selectors).
- `plan-assets/screenshots/` regenerated (76 PNGs, both themes).
- `scripts/optimize-screenshots.ts` emits viewport-cropped PNG + 720w/360w
  WebP siblings for the install-prompt manifest entries.
- `package.json` bumped to 1.0.0.
- Graphify refreshed at HEAD to capture end-of-Phase-8 state.

## Out of scope for 1.0.0

- Skull King Rascal variant — slated for Phase 9.
- Apple sign-in — deferred to v1.x (waiting on a developer account).
- Documentation pass (README rewrite, stable doc set, `PLAN.md` retirement) —
  Phase 8K, ships after v1.0.0 is verified in production.
