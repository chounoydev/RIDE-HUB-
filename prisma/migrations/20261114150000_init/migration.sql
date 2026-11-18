CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('RIDER', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "RideVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RideMemberRole" AS ENUM ('RIDER', 'LEADER', 'SWEEPER');

-- CreateEnum
CREATE TYPE "RideRegistrationStatus" AS ENUM ('REGISTERED', 'WAITLISTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoadReportStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "MotorcycleServiceType" AS ENUM ('OIL_CHANGE', 'TIRE_INSPECTION', 'BRAKE_INSPECTION', 'BATTERY_MAINTENANCE', 'GENERAL_SERVICE', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "displayName" VARCHAR(80) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'RIDER',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Motorcycle" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "make" VARCHAR(80) NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "modelYear" INTEGER,
    "odometerKm" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Motorcycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ride" (
    "id" UUID NOT NULL,
    "leaderId" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(2000),
    "visibility" "RideVisibility" NOT NULL DEFAULT 'PUBLIC',
    "status" "RideStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "distanceMeters" INTEGER,
    "meetingLatitude" DOUBLE PRECISION,
    "meetingLongitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Ride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RideParticipant" (
    "rideId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "RideMemberRole" NOT NULL DEFAULT 'RIDER',
    "status" "RideRegistrationStatus" NOT NULL DEFAULT 'REGISTERED',
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RideParticipant_pkey" PRIMARY KEY ("rideId","userId")
);

-- CreateTable
CREATE TABLE "RiderLocation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rideId" UUID,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "location" geography(Point,4326),

    CONSTRAINT "RiderLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoadReportCategory" (
    "code" VARCHAR(50) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RoadReportCategory_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "RoadReport" (
    "id" UUID NOT NULL,
    "reporterId" UUID,
    "categoryCode" VARCHAR(50) NOT NULL,
    "status" "RoadReportStatus" NOT NULL DEFAULT 'PENDING',
    "description" VARCHAR(2000),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "location" geography(Point,4326),
    "expiresAt" TIMESTAMPTZ(3),
    "verifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RoadReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRecord" (
    "id" UUID NOT NULL,
    "motorcycleId" UUID NOT NULL,
    "serviceType" "MotorcycleServiceType" NOT NULL,
    "servicedAt" TIMESTAMPTZ(3) NOT NULL,
    "odometerKm" INTEGER NOT NULL,
    "amountMinorUnits" INTEGER,
    "currencyCode" CHAR(3),
    "notes" VARCHAR(2000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Motorcycle_ownerId_idx" ON "Motorcycle"("ownerId");

-- CreateIndex
CREATE INDEX "Ride_status_startsAt_idx" ON "Ride"("status", "startsAt");

-- CreateIndex
CREATE INDEX "Ride_leaderId_startsAt_idx" ON "Ride"("leaderId", "startsAt");

-- CreateIndex
CREATE INDEX "RideParticipant_userId_joinedAt_idx" ON "RideParticipant"("userId", "joinedAt");

-- CreateIndex
CREATE INDEX "RideParticipant_rideId_status_idx" ON "RideParticipant"("rideId", "status");

-- CreateIndex
CREATE INDEX "RiderLocation_userId_recordedAt_idx" ON "RiderLocation"("userId", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "RiderLocation_rideId_recordedAt_idx" ON "RiderLocation"("rideId", "recordedAt");

-- CreateIndex
CREATE INDEX "RoadReport_status_expiresAt_idx" ON "RoadReport"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "RoadReport_categoryCode_createdAt_idx" ON "RoadReport"("categoryCode", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "RoadReport_reporterId_createdAt_idx" ON "RoadReport"("reporterId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MaintenanceRecord_motorcycleId_servicedAt_idx" ON "MaintenanceRecord"("motorcycleId", "servicedAt" DESC);

-- AddForeignKey
ALTER TABLE "Motorcycle" ADD CONSTRAINT "Motorcycle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideParticipant" ADD CONSTRAINT "RideParticipant_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideParticipant" ADD CONSTRAINT "RideParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderLocation" ADD CONSTRAINT "RiderLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderLocation" ADD CONSTRAINT "RiderLocation_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadReport" ADD CONSTRAINT "RoadReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadReport" ADD CONSTRAINT "RoadReport_categoryCode_fkey" FOREIGN KEY ("categoryCode") REFERENCES "RoadReportCategory"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_motorcycleId_fkey" FOREIGN KEY ("motorcycleId") REFERENCES "Motorcycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
