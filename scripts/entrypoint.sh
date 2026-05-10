#!/bin/sh
set -e

# RESET_DB=true wipes the database before migrations run. Intended for
# preview/integration when bad test data needs to be cleared without a
# manual `prisma migrate reset`. Hard-blocked on production. Remember to
# flip it back to false (or remove it) after the reset deploy — every
# subsequent deploy with RESET_DB=true will wipe again.
if [ "$RESET_DB" = "true" ]; then
  if [ "$DEPLOY_ENV" = "production" ]; then
    echo "❌ RESET_DB=true is not allowed when DEPLOY_ENV=production. Aborting." >&2
    exit 1
  fi
  echo "⚠️  RESET_DB=true (DEPLOY_ENV=${DEPLOY_ENV:-unset}) — wiping the database..."
  # --skip-generate: prisma migrate reset auto-runs `prisma generate` as a
  # post-step, which tries to write to /app/node_modules/prisma. The runner
  # container's filesystem is owned by root and the process runs as appuser,
  # so that write fails. The Prisma client was already generated during the
  # Docker build (see Dockerfile), so runtime regeneration is unnecessary.
  npx prisma migrate reset --force --skip-seed --skip-generate
fi

echo "Running database migrations..."
npx prisma migrate deploy

echo "Seeding database (conditional)..."
npx tsx prisma/seed.ts

echo "Starting server..."
exec node dist/server/index.js
