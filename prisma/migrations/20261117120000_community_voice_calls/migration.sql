CREATE TABLE "CommunityVoiceCall" (
    "communityId" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityVoiceCall_pkey" PRIMARY KEY ("communityId"),
    CONSTRAINT "CommunityVoiceCall_callId_key" UNIQUE ("callId"),
    CONSTRAINT "CommunityVoiceCall_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CommunityVoiceParticipant" (
    "communityId" UUID NOT NULL,
    "userId" VARCHAR(128) NOT NULL,
    "displayName" VARCHAR(80) NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityVoiceParticipant_pkey" PRIMARY KEY ("communityId", "userId"),
    CONSTRAINT "CommunityVoiceParticipant_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "CommunityVoiceCall"("communityId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CommunityVoiceSignal" (
    "sequence" BIGSERIAL NOT NULL,
    "communityId" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "fromUserId" VARCHAR(128) NOT NULL,
    "toUserId" VARCHAR(128) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityVoiceSignal_pkey" PRIMARY KEY ("sequence"),
    CONSTRAINT "CommunityVoiceSignal_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "CommunityVoiceCall"("communityId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CommunityVoiceParticipant_communityId_lastSeenAt_idx" ON "CommunityVoiceParticipant"("communityId", "lastSeenAt");
CREATE INDEX "CommunityVoiceSignal_communityId_callId_toUserId_sequence_idx" ON "CommunityVoiceSignal"("communityId", "callId", "toUserId", "sequence");
CREATE INDEX "CommunityVoiceSignal_createdAt_idx" ON "CommunityVoiceSignal"("createdAt");
