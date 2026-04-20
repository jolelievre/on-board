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

### Backend: Hono + PostgreSQL + Prisma

| Component | Choice | Rejected Alternative | Rationale |
|-----------|--------|---------------------|-----------|
| **API Server** | Hono | Express, Fastify, Next.js API routes | Native TypeScript framework, built on Web Standards (Request/Response), ultra-lightweight (~14KB). Serves the API AND the SPA static files → single process, single port (3000), single Docker container. Express is aging; Fastify is heavier; Next.js is overkill to serve a pure API. |
| **Auth** | better-auth | NextAuth (Auth.js) | Framework-agnostic (works with Hono natively), built-in Google OAuth, Prisma adapter, session management. NextAuth is tightly coupled to Next.js — possible with other frameworks but not natural. better-auth is the emerging choice for non-Next.js stacks. |
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

## Phase 0: Project Bootstrap + Deployment ✍️ IN PROGRESS

**Goal**: Minimal working project, deployed on Coolify, pipeline validated end-to-end.

### Steps

- [x] Rename `assets/` → `plan-assets/` (game rules reference, not committed)
- [x] `PLAN.md` with tech stack rationale (this file)
- [ ] Init Git repo + `.gitignore`
- [ ] Init Vite + React 19 + TypeScript + TailwindCSS
- [ ] Setup Hono server (serves SPA + `/api/health`)
- [ ] `docker-compose.yml`: PostgreSQL 16 (DBs `onboard_dev` + `onboard_test`)
- [ ] Prisma init (minimal schema, DB connection)
- [ ] ESLint flat config
- [ ] Playwright config (Mobile Chrome + Mobile Safari) + first smoke test
- [ ] `Dockerfile` multi-stage (deps → build client + server → runner)
- [ ] `scripts/entrypoint.sh`, `scripts/init-test-db.sql`
- [ ] `.env.example`, `.env.test`
- [ ] `CLAUDE.md` with project conventions
- [ ] Create GitHub repo `on-board`
- [ ] Configure Coolify: integration app (main branch, auto-deploy) + preview (fixed URL)
- [ ] First push → deploy → verify the page loads on Coolify

**Validation**: `npm run dev` starts, `/api/health` responds, `npm run lint` passes, site is accessible on Coolify.

---

## Phase 1: Auth + Data Model

> **TO BE VALIDATED** — Phases 1-8 have not been approved yet.

**Goal**: Google OAuth login via better-auth, DB schema, route structure.

- Prisma schema (User, Game, Match, Player, Score)
- better-auth: Google OAuth, Prisma adapter, Hono middleware
- Test mode: mock auth for E2E (no real Google OAuth in CI)
- API routes CRUD (games, matches, scores, players/suggestions)
- Client routes via TanStack Router (/, /games, /games/$slug, /matches/$id)
- E2E: auth, navigation

---

## Phase 2: 7 Wonders Duel — POC

**Goal**: Functional scoring, simple form inspired by the physical score grid.

- 7 score categories (military, treasury, wonders, civil, scientific, commercial, guilds)
- Special victories (military supremacy, scientific supremacy)
- New match: enter 2 player names (autocomplete)
- Score grid: 2 columns × 7 rows + auto-calculated total
- Match history
- E2E: full flow creation → scoring → end game → history

---

## Phase 3: CI/CD Pipeline

**Goal**: Full GitHub Actions pipeline (CI on PR, prod deploy on release, E2E on deployed envs).

- `ci.yml`: lint + type-check + build + E2E matrix (Chrome × Safari × campaigns)
- `deploy-prod.yml`: on release published → Coolify API
- `e2e-deployed.yml`: workflow_dispatch against preview/integration/production
- Coolify prod config (deploy via API on release tag)

---

## Phase 4: Claude Design — Branding + UX

**Goal**: Visual identity and UX patterns before going further with UI.

- Logo, color palette, typography
- Mobile-first design system
- 7 Wonders Duel scoring UX (refinement from POC)
- Skull King scoring UX (round-by-round, bids, tricks, bonuses)
- PWA indicators (offline, sync, install)

---

## Phase 5: Apply Design System

**Goal**: Implement the design across all existing pages.

- Custom Tailwind theme
- Reusable UI components
- PWA manifest + icons
- Mobile layout (header + bottom bar)

---

## Phase 6: Skull King

**Goal**: Full scoring with both variants (Classic + Rascal).

- 2-8 players, 10 rounds, bid/trick/bonus per round
- Classic scoring + Rascal variant
- Special capture bonuses
- E2E: full game, score calculations, variants

---

## Phase 7: Offline-first + PWA

**Goal**: Works offline, syncs when back online, installable.

- Dexie.js: local IndexedDB mirror of server entities
- vite-plugin-pwa (Workbox): SPA shell cache
- Sync engine (push/pull, Last-Write-Wins)
- E2E: offline test (context.setOffline), local persistence, online sync

---

## Phase 8: Polish + Distribution

**Goal**: Smooth experience, ready to share with friends.

- Real-time sync indicator
- Player autocomplete
- History filters
- Basic statistics
- Lighthouse PWA audit (score 100)
- Installation help page
- v1.0.0 → production deploy
