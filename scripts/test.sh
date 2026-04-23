#!/bin/sh
set -e

echo "Resetting test database..."
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/onboard_test" npx prisma db push --force-reset --skip-generate

echo "Seeding test database..."
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/onboard_test" npx tsx prisma/seed.ts

echo "Running E2E tests..."
npx playwright test "$@"
