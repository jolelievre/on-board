# OnBoard - Project Conventions

## Overview

Board game score tracker PWA. SPA architecture (React + Vite) with Hono API server.

## Development

### Prerequisites

- Node.js 20+
- Docker (for PostgreSQL)

### Setup

```bash
cp .env.example .env
docker compose up -d
npm install
npx prisma db push
npm run dev          # Vite dev server + Hono API (port 5173)
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (frontend + API on port 5173) |
| `npm run build` | Build client (Vite) + server (tsc) |
| `npm run start` | Run production server |
| `npm run lint` | ESLint (must pass, zero warnings) |
| `npm run type-check` | TypeScript strict check |
| `npm test` | Reset test DB + run all E2E tests |
| `npm run test:chrome` | E2E on Mobile Chrome only |
| `npm run test:safari` | E2E on Mobile Safari only |
| `npm run db:push` | Apply Prisma schema to dev DB |
| `npm run db:seed` | Seed game templates |
| `npm run db:reset` | Force-reset dev DB + seed |
| `npm run db:studio` | Open Prisma Studio |

### Architecture

```
src/
  client/          # React SPA (served by Vite in dev, by Hono in prod)
    main.tsx       # Entry point
    App.tsx        # Root component
    routes/        # TanStack Router pages
    components/    # React components (by feature)
    hooks/         # Custom hooks
    lib/           # Client utilities (Dexie DB, sync engine)
  server/          # Hono API server
    index.ts       # Entry point (serves API + static files)
    routes/        # API route handlers
    lib/           # Server utilities (Prisma client, helpers)
  shared/          # Types and logic shared between client & server
    scoring/       # Game scoring calculations
```

### Dev workflow

In development, `npm run dev` starts Vite on port 5173. A custom Vite plugin mounts the Hono API as middleware, so `/api/*` requests are handled in the same process — no separate server needed.

In production, a single Hono process serves both the API and the SPA static files on port 3000.

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
BASE_URL="https://your-deployed-url.example.com" npm run test:chrome
```

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
- `entrypoint.sh`: runs `prisma db push` then starts server (preserves data across deploys)

## Git Workflow

- Feature branches off `main`
- PRs for review
- Atomic commits
- First push: `git push -u origin <branch>`
