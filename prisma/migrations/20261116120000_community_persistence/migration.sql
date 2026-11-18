CREATE TYPE "CommunityMembershipStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'BANNED');

CREATE TABLE "Community" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "description" VARCHAR(240) NOT NULL,
    "ownerId" VARCHAR(128) NOT NULL,
    "ownerName" VARCHAR(80) NOT NULL,
    "logoDataUrl" TEXT,
    "themeColor" VARCHAR(7) NOT NULL DEFAULT '#ff7a1a',
    "meeting" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityMembership" (
    "communityId" UUID NOT NULL,
    "userId" VARCHAR(128) NOT NULL,
    "displayName" VARCHAR(80) NOT NULL,
    "status" "CommunityMembershipStatus" NOT NULL DEFAULT 'PENDING',
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "approvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CommunityMembership_pkey" PRIMARY KEY ("communityId", "userId"),
    CONSTRAINT "CommunityMembership_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Community_createdAt_idx" ON "Community"("createdAt" DESC);
CREATE INDEX "CommunityMembership_communityId_status_idx" ON "CommunityMembership"("communityId", "status");
CREATE INDEX "CommunityMembership_userId_status_idx" ON "CommunityMembership"("userId", "status");
