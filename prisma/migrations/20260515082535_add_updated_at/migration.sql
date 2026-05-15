-- Add `updatedAt` to Match, Player, Score.
-- Backfill in two steps so existing rows in deployed environments don't
-- violate NOT NULL: add nullable, backfill, then set NOT NULL.

-- Match
ALTER TABLE "Match" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "Match" SET "updatedAt" = COALESCE("completedAt", "startedAt") WHERE "updatedAt" IS NULL;
ALTER TABLE "Match" ALTER COLUMN "updatedAt" SET NOT NULL;

-- Player (no per-row timestamp available; use parent match's startedAt as a stable backfill).
ALTER TABLE "Player" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "Player" p SET "updatedAt" = m."startedAt" FROM "Match" m WHERE p."matchId" = m."id" AND p."updatedAt" IS NULL;
ALTER TABLE "Player" ALTER COLUMN "updatedAt" SET NOT NULL;

-- Score (same approach as Player).
ALTER TABLE "Score" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "Score" s SET "updatedAt" = m."startedAt" FROM "Match" m WHERE s."matchId" = m."id" AND s."updatedAt" IS NULL;
ALTER TABLE "Score" ALTER COLUMN "updatedAt" SET NOT NULL;
