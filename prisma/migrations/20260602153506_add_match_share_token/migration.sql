-- CreateTable
CREATE TABLE "MatchShareToken" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchShareToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchShareToken_matchId_key" ON "MatchShareToken"("matchId");

-- CreateIndex
CREATE INDEX "MatchShareToken_createdById_idx" ON "MatchShareToken"("createdById");

-- AddForeignKey
ALTER TABLE "MatchShareToken" ADD CONSTRAINT "MatchShareToken_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchShareToken" ADD CONSTRAINT "MatchShareToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
