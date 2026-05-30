-- PR 6-C — Scope linkedUserId uniqueness to (ownerId, linkedUserId).
--
-- The previous global unique index made the link flow impossible:
-- friend B's self-Profile occupied linkedUserId = B, so no other
-- owner could ever link one of their profiles to B. The new shape
-- lets each owner maintain at most one linked Profile per friend,
-- while different owners can independently link the same friend.

-- Drop the old global unique constraint on linkedUserId.
DROP INDEX IF EXISTS "Profile_linkedUserId_key";

-- Composite unique: at most one Profile per (owner, linked user). Nulls
-- are treated as distinct by PostgreSQL by default, so an owner can
-- have multiple unclaimed profiles (linkedUserId = NULL) — unchanged
-- behavior.
CREATE UNIQUE INDEX "Profile_ownerId_linkedUserId_key"
  ON "Profile"("ownerId", "linkedUserId");
