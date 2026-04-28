# OnBoard - Project Conventions

## Overview

Board game score tracker PWA. SPA architecture (React + Vite) with Hono API server.

See [PLAN.md](PLAN.md) for the full development plan (tech stack rationale, phases, data model).

## Development

### Prerequisites

- Node.js 20+
- Docker (for PostgreSQL)

### Setup

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate   # Apply Prisma migrations
npm run db:seed      # Seed game templates
npm run dev          # Vite dev server + Hono API (port 5173)
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (frontend + API on port 5173) |
| `npm run dev:kill` | Kill any process on port 5173 (stale dev servers) |
| `npm run build` | Build client (Vite) + server (tsc) |
| `npm run start` | Run production server |
| `npm run lint` | ESLint (must pass, zero warnings) |
| `npm run type-check` | TypeScript strict check |
| `npm test` | Reset test DB + run all E2E tests (both browsers) |
| `npm run test:chrome` | Reset test DB + E2E on Mobile Chrome only |
| `npm run test:safari` | Reset test DB + E2E on Mobile Safari only |
| `npm run db:migrate` | Create + apply Prisma migrations (dev) |
| `npm run db:seed` | Seed game templates |
| `npm run db:reset` | Reset dev DB + re-apply migrations + seed |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:push` | Apply Prisma schema directly (no migration file) |
| `npm run screenshots` | Capture mobile-viewport PNGs of every screen into `plan-assets/screenshots/` (standalone — boots its own dev server in test mode, not part of the E2E test campaign) |

### Architecture

```
src/
  client/          # React SPA (served by Vite in dev, by Hono in prod)
    main.tsx       # Entry point
    routes/        # TanStack Router pages (file-based routing)
    components/    # React components (by feature)
    hooks/         # Custom hooks
    lib/           # Client utilities (auth-client, query-client, i18n)
    locales/       # i18n translation files (en/, fr/)
  server/          # Hono API server
    index.ts       # Entry point (serves API + static files)
    app.ts         # Hono app with routes + auth handler
    routes/        # API route handlers (games, matches, scores, players)
    lib/           # Server utilities (Prisma client, auth config)
    middleware/     # Hono middleware (auth)
  shared/          # Types and logic shared between client & server
    scoring/       # Game scoring calculations
```

### Dev workflow

In development, `npm run dev` starts Vite on port 5173. A custom Vite plugin mounts the Hono API as middleware, so `/api/*` requests are handled in the same process — no separate server needed.

In production, a single Hono process serves both the API and the SPA static files on port 3000.

### Port conflicts

The dev server and Playwright both use port 5173. Stale processes on that port cause "socket hang up" or "ECONNREFUSED" errors.

`npm run dev` auto-kills any existing process on port 5173 before starting. For E2E tests, run `npm run dev:kill` beforehand since Playwright starts its own dev server.

## Testing

### E2E (Playwright)

- Projects: Mobile Chrome (Pixel 5), Mobile Safari (iPhone 13)
- Tests go in `e2e/` directory
- Always use `await page.waitForLoadState("domcontentloaded")` after `goto()`
- Never use `networkidle` wait (hangs with long-lived connections)
- Use `fill()` over `type()` for form inputs
- Retries: 1 locally, 2 in CI
- Workers: uncapped locally, 1 in CI

### Running against deployed environments

```bash
BASE_URL="https://on-board-preview.jolelievre.com" npm run test:chrome
```

Google OAuth login is automated — requires `GOOGLE_TEST_EMAIL` and `GOOGLE_TEST_PASSWORD` in `.env.test.local`.

## Code Style

- English only for code, comments, file names, documentation
- French only for user-facing app strings (UI labels, messages)
- ESLint must pass with zero warnings before commit
- TypeScript strict mode, no `any` unless absolutely necessary
- Prefer named exports over default exports

## Deployment

- Docker multi-stage build (see `Dockerfile`)
- Coolify: auto-deploy on push to main (integration), manual deploy on release (production)
- Preview environment on PRs (fixed URL)
- `entrypoint.sh`: runs `prisma migrate deploy` then seeds + starts server (preserves data across deploys)

## Git Workflow

- Feature branches off `main`
- PRs for review
- Atomic commits
- First push: `git push -u origin <branch>`
