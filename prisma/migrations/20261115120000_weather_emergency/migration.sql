CREATE TYPE "WeatherAlertCategory" AS ENUM (
    'HEAVY_RAIN',
    'THUNDERSTORM',
    'LIGHTNING',
    'STRONG_WIND',
    'EXTREME_HEAT',
    'SEVERE_WEATHER',
    'FLOODING_RISK',
    'OTHER'
);

CREATE TYPE "WeatherAlertSeverity" AS ENUM ('MINOR', 'MODERATE', 'SEVERE', 'EXTREME');
CREATE TYPE "WeatherLocationKind" AS ENUM ('CURRENT', 'SAVED', 'DESTINATION', 'ROUTE', 'GROUP_RIDE');
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'PUSH');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED');
CREATE TYPE "EmergencyIncidentType" AS ENUM (
    'MOTORCYCLE_ACCIDENT',
    'MOTORCYCLE_BREAKDOWN',
    'MEDICAL_EMERGENCY',
    'FLAT_TIRE',
    'ENGINE_PROBLEM',
    'LOST_RIDER',
    'PERSONAL_SAFETY',
    'OTHER'
);
CREATE TYPE "EmergencyIncidentStatus" AS ENUM (
    'SOS_ACTIVATED',
    'NOTIFICATIONS_SENT',
    'ASSISTANCE_ACKNOWLEDGED',
    'ASSISTANCE_IN_PROGRESS',
    'RESOLVED',
    'CANCELED'
);
CREATE TYPE "EmergencyNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'ACKNOWLEDGED');

CREATE TABLE "WeatherNotificationPreference" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "heavyRain" BOOLEAN NOT NULL DEFAULT true,
    "thunderstorm" BOOLEAN NOT NULL DEFAULT true,
    "lightning" BOOLEAN NOT NULL DEFAULT true,
    "strongWind" BOOLEAN NOT NULL DEFAULT true,
    "extremeHeat" BOOLEAN NOT NULL DEFAULT true,
    "severeWeather" BOOLEAN NOT NULL DEFAULT true,
    "floodingRisk" BOOLEAN NOT NULL DEFAULT true,
    "locationBased" BOOLEAN NOT NULL DEFAULT false,
    "groupRideWeather" BOOLEAN NOT NULL DEFAULT true,
    "sound" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursStart" VARCHAR(5),
    "quietHoursEnd" VARCHAR(5),
    "pushToken" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "WeatherNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WeatherWatchLocation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rideId" UUID,
    "kind" "WeatherLocationKind" NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "routePoints" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "WeatherWatchLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WeatherAlert" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "locationId" UUID,
    "provider" VARCHAR(40) NOT NULL,
    "providerId" VARCHAR(255) NOT NULL,
    "dedupeKey" VARCHAR(255) NOT NULL,
    "category" "WeatherAlertCategory" NOT NULL,
    "severity" "WeatherAlertSeverity" NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "description" TEXT NOT NULL,
    "instruction" TEXT,
    "area" VARCHAR(500),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "effectiveAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "fingerprint" VARCHAR(64) NOT NULL,
    "official" BOOLEAN NOT NULL DEFAULT false,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "WeatherAlert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDeliveryLog" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "alertId" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(255) NOT NULL,
    "providerMessageId" VARCHAR(255),
    "error" TEXT,
    "attemptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),
    CONSTRAINT "NotificationDeliveryLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmergencyContact" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phoneNumber" VARCHAR(32) NOT NULL,
    "relationship" VARCHAR(80),
    "priority" INTEGER NOT NULL DEFAULT 1,
    "verifiedAt" TIMESTAMPTZ(3),
    "notifyOnSos" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmergencyIncident" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "EmergencyIncidentType" NOT NULL,
    "status" "EmergencyIncidentStatus" NOT NULL DEFAULT 'SOS_ACTIVATED',
    "description" VARCHAR(1000),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyMeters" DOUBLE PRECISION,
    "locationLink" VARCHAR(500),
    "activatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),
    "canceledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "EmergencyIncident_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmergencyNotification" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "contactId" UUID,
    "recipientUserId" UUID,
    "status" "EmergencyNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" VARCHAR(255),
    "error" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmergencyNotification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmergencyLocationUpdate" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyMeters" DOUBLE PRECISION,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmergencyLocationUpdate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmergencyAcknowledgement" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "message" VARCHAR(500),
    "acknowledgedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmergencyAcknowledgement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WeatherNotificationPreference_userId_key" ON "WeatherNotificationPreference"("userId");
CREATE INDEX "WeatherNotificationPreference_enabled_locationBased_idx" ON "WeatherNotificationPreference"("enabled", "locationBased");
CREATE INDEX "WeatherWatchLocation_userId_enabled_idx" ON "WeatherWatchLocation"("userId", "enabled");
CREATE INDEX "WeatherWatchLocation_rideId_startsAt_idx" ON "WeatherWatchLocation"("rideId", "startsAt");
CREATE UNIQUE INDEX "WeatherAlert_dedupeKey_key" ON "WeatherAlert"("dedupeKey");
CREATE INDEX "WeatherAlert_userId_createdAt_idx" ON "WeatherAlert"("userId", "createdAt" DESC);
CREATE INDEX "WeatherAlert_locationId_expiresAt_idx" ON "WeatherAlert"("locationId", "expiresAt");
CREATE INDEX "WeatherAlert_category_expiresAt_idx" ON "WeatherAlert"("category", "expiresAt");
CREATE UNIQUE INDEX "NotificationDeliveryLog_idempotencyKey_key" ON "NotificationDeliveryLog"("idempotencyKey");
CREATE INDEX "NotificationDeliveryLog_userId_attemptedAt_idx" ON "NotificationDeliveryLog"("userId", "attemptedAt" DESC);
CREATE INDEX "NotificationDeliveryLog_status_attemptedAt_idx" ON "NotificationDeliveryLog"("status", "attemptedAt");
CREATE INDEX "EmergencyContact_userId_priority_idx" ON "EmergencyContact"("userId", "priority");
CREATE INDEX "EmergencyIncident_userId_activatedAt_idx" ON "EmergencyIncident"("userId", "activatedAt" DESC);
CREATE INDEX "EmergencyIncident_status_activatedAt_idx" ON "EmergencyIncident"("status", "activatedAt");
CREATE INDEX "EmergencyNotification_incidentId_createdAt_idx" ON "EmergencyNotification"("incidentId", "createdAt");
CREATE INDEX "EmergencyNotification_recipientUserId_createdAt_idx" ON "EmergencyNotification"("recipientUserId", "createdAt" DESC);
CREATE INDEX "EmergencyLocationUpdate_incidentId_recordedAt_idx" ON "EmergencyLocationUpdate"("incidentId", "recordedAt" DESC);
CREATE UNIQUE INDEX "EmergencyAcknowledgement_incidentId_userId_key" ON "EmergencyAcknowledgement"("incidentId", "userId");
CREATE INDEX "EmergencyAcknowledgement_userId_acknowledgedAt_idx" ON "EmergencyAcknowledgement"("userId", "acknowledgedAt" DESC);

ALTER TABLE "WeatherNotificationPreference" ADD CONSTRAINT "WeatherNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeatherWatchLocation" ADD CONSTRAINT "WeatherWatchLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeatherWatchLocation" ADD CONSTRAINT "WeatherWatchLocation_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeatherAlert" ADD CONSTRAINT "WeatherAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeatherAlert" ADD CONSTRAINT "WeatherAlert_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WeatherWatchLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDeliveryLog" ADD CONSTRAINT "NotificationDeliveryLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDeliveryLog" ADD CONSTRAINT "NotificationDeliveryLog_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "WeatherAlert"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmergencyIncident" ADD CONSTRAINT "EmergencyIncident_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmergencyNotification" ADD CONSTRAINT "EmergencyNotification_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "EmergencyIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmergencyNotification" ADD CONSTRAINT "EmergencyNotification_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "EmergencyContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmergencyNotification" ADD CONSTRAINT "EmergencyNotification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmergencyLocationUpdate" ADD CONSTRAINT "EmergencyLocationUpdate_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "EmergencyIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmergencyAcknowledgement" ADD CONSTRAINT "EmergencyAcknowledgement_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "EmergencyIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmergencyAcknowledgement" ADD CONSTRAINT "EmergencyAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
