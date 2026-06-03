-- CreateTable
CREATE TABLE "SyncFailureLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" INTEGER,
    "errorMessage" TEXT,
    "errorField" TEXT,
    "errorHint" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "clientFailedAt" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncFailureLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncFailureLog_reportedAt_idx" ON "SyncFailureLog"("reportedAt");
