#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma db push --skip-generate

echo "Seeding database (conditional)..."
npx tsx prisma/seed.ts

echo "Starting server..."
exec node dist/server/index.js
