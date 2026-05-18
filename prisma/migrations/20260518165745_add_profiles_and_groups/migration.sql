-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "profileId" TEXT;

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "linkedUserId" TEXT,
    "alias" TEXT NOT NULL,
    "customAvatarUrl" TEXT,
    "useLinkedAvatar" BOOLEAN NOT NULL DEFAULT true,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileGroup" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileGroupMember" (
    "groupId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ProfileGroupMember_pkey" PRIMARY KEY ("groupId","profileId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_linkedUserId_key" ON "Profile"("linkedUserId");

-- CreateIndex
CREATE INDEX "Profile_ownerId_idx" ON "Profile"("ownerId");

-- CreateIndex
CREATE INDEX "Profile_linkedUserId_idx" ON "Profile"("linkedUserId");

-- CreateIndex
CREATE INDEX "ProfileGroup_ownerId_idx" ON "ProfileGroup"("ownerId");

-- CreateIndex
CREATE INDEX "ProfileGroupMember_profileId_idx" ON "ProfileGroupMember"("profileId");

-- CreateIndex
CREATE INDEX "Player_profileId_idx" ON "Player"("profileId");

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileGroup" ADD CONSTRAINT "ProfileGroup_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileGroupMember" ADD CONSTRAINT "ProfileGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProfileGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileGroupMember" ADD CONSTRAINT "ProfileGroupMember_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Data backfill ───
-- Three steps:
--   1. Create a self-Profile for every existing User (ownerId = linkedUserId
--      = self.id) so they appear in suggestions immediately.
--   2. Create one unclaimed Profile per (createdById, case-insensitive trimmed
--      name) tuple from existing Player rows where userId IS NULL.
--   3. Backfill Player.profileId on every existing row by joining back to the
--      Profile that represents them.
--
-- IDs are CUID-shaped strings ('c' + 24 hex chars) so they match the server's
-- CUID_RE validator. gen_random_uuid() is available in PostgreSQL >= 13
-- without enabling pgcrypto.

-- Step 1: self-Profile for every User missing one.
INSERT INTO "Profile" ("id", "ownerId", "linkedUserId", "alias", "useLinkedAvatar", "usedAt", "createdAt", "updatedAt")
SELECT
  'c' || substr(lower(translate(gen_random_uuid()::text, '-', '')), 1, 24),
  u."id",
  u."id",
  COALESCE(NULLIF(TRIM(u."alias"), ''), u."name"),
  true,
  NOW(),
  NOW(),
  NOW()
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "Profile" p WHERE p."linkedUserId" = u."id"
);

-- Step 2: unclaimed Profile per (createdById, lowered+trimmed name) tuple.
-- DISTINCT ON picks the earliest-encountered casing of the name as the alias.
WITH unclaimed_keys AS (
  SELECT DISTINCT ON (m."createdById", LOWER(TRIM(p."name")))
    m."createdById" AS owner_id,
    TRIM(p."name")  AS alias
  FROM "Player" p
  JOIN "Match"  m ON m."id" = p."matchId"
  WHERE p."userId" IS NULL
    AND TRIM(p."name") <> ''
  ORDER BY m."createdById", LOWER(TRIM(p."name")), m."startedAt" ASC
)
INSERT INTO "Profile" ("id", "ownerId", "linkedUserId", "alias", "useLinkedAvatar", "usedAt", "createdAt", "updatedAt")
SELECT
  'c' || substr(lower(translate(gen_random_uuid()::text, '-', '')), 1, 24),
  uk.owner_id,
  NULL,
  uk.alias,
  true,
  NOW(),
  NOW(),
  NOW()
FROM unclaimed_keys uk;

-- Step 3a: backfill Player.profileId for "self" players (userId set to the
-- match creator — today's only legitimate use of Player.userId).
UPDATE "Player" p
SET "profileId" = pr."id"
FROM "Profile" pr
WHERE p."profileId" IS NULL
  AND p."userId"   IS NOT NULL
  AND pr."linkedUserId" = p."userId";

-- Step 3b: backfill Player.profileId for unclaimed players, joining through
-- the match's creator and a case-insensitive alias match.
UPDATE "Player" p
SET "profileId" = pr."id"
FROM "Match" m, "Profile" pr
WHERE p."profileId" IS NULL
  AND p."userId"   IS NULL
  AND p."matchId"  = m."id"
  AND pr."ownerId" = m."createdById"
  AND pr."linkedUserId" IS NULL
  AND LOWER(TRIM(pr."alias")) = LOWER(TRIM(p."name"));
