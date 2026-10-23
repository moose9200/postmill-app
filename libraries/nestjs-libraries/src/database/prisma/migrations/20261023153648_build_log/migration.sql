-- AlterEnum
ALTER TYPE "CreationMethod" ADD VALUE 'BUILD_LOG';

-- CreateTable
CREATE TABLE "BuildSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "token" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "url" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuildSource_organizationId_repo_key" ON "BuildSource"("organizationId", "repo");

-- CreateIndex
CREATE INDEX "BuildActivity_organizationId_occurredAt_idx" ON "BuildActivity"("organizationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "BuildActivity_organizationId_externalId_key" ON "BuildActivity"("organizationId", "externalId");

-- AddForeignKey
ALTER TABLE "BuildSource" ADD CONSTRAINT "BuildSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildActivity" ADD CONSTRAINT "BuildActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
