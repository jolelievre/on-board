-- Drop the unused ProfileGroup / ProfileGroupMember tables.
-- Phase 6-D (favorite player groups) was abandoned in favor of the
-- "played-with" suggestions shipped in PR 6-B, so these tables never
-- received any rows in any environment.

-- DropForeignKey
ALTER TABLE "ProfileGroupMember" DROP CONSTRAINT "ProfileGroupMember_profileId_fkey";

-- DropForeignKey
ALTER TABLE "ProfileGroupMember" DROP CONSTRAINT "ProfileGroupMember_groupId_fkey";

-- DropForeignKey
ALTER TABLE "ProfileGroup" DROP CONSTRAINT "ProfileGroup_ownerId_fkey";

-- DropTable
DROP TABLE "ProfileGroupMember";

-- DropTable
DROP TABLE "ProfileGroup";
