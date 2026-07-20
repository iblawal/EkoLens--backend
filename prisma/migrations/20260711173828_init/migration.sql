-- CreateTable
CREATE TABLE "TripReport" (
    "id" TEXT NOT NULL,
    "startLocation" TEXT NOT NULL,
    "timeOfTrip" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "tripDate" TEXT NOT NULL,
    "transportMode" TEXT NOT NULL,
    "boardingPoint" TEXT NOT NULL,
    "routeSteps" TEXT NOT NULL,
    "dropOffPoint" TEXT NOT NULL,
    "fareAmount" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "landmarkUsed" TEXT NOT NULL,
    "wasSafe" TEXT NOT NULL,
    "safetyTips" TEXT,
    "wasOvercharged" TEXT NOT NULL,
    "busChanges" TEXT NOT NULL,
    "waitTime" TEXT NOT NULL,
    "trafficLevel" TEXT NOT NULL,
    "extraNotes" TEXT,
    "waitBeforeMoving" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripReport_pkey" PRIMARY KEY ("id")
);
