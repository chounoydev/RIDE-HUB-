CREATE TABLE "CommunityChatMessage" (
    "id" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "senderId" VARCHAR(128) NOT NULL,
    "senderName" VARCHAR(80) NOT NULL,
    "text" VARCHAR(1000) NOT NULL,
    "imageDataUrl" TEXT,
    "audioDataUrl" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CommunityChatMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommunityChatMessage_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CommunityChatEvent" (
    "sequence" BIGSERIAL NOT NULL,
    "communityId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityChatEvent_pkey" PRIMARY KEY ("sequence"),
    CONSTRAINT "CommunityChatEvent_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CommunityChatMessage_communityId_createdAt_idx" ON "CommunityChatMessage"("communityId", "createdAt");
CREATE INDEX "CommunityChatEvent_communityId_sequence_idx" ON "CommunityChatEvent"("communityId", "sequence");
