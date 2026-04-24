#!/bin/sh
set -e

echo "Resetting test database..."
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=yes DATABASE_URL="postgresql://postgres:postgres@localhost:5432/onboard_test" npx prisma db push --force-reset --skip-generate

echo "Seeding test database..."
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/onboard_test" npx tsx prisma/seed.ts
