/*
  Warnings:

  - You are about to drop the column `state` on the `Location` table. All the data in the column will be lost.
  - You are about to drop the `Landmark` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RouteReport` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[osmId]` on the table `Location` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `Location` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `type` on the `Location` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "TransportType" AS ENUM ('DANFO', 'KEKE', 'KOROPE', 'RIDE', 'BRT', 'BIKE');

-- CreateEnum
CREATE TYPE "ReportSource" AS ENUM ('USER', 'CSV_SEED');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('BUS_STOP', 'LANDMARK', 'AREA', 'ROAD', 'MARKET', 'SCHOOL', 'HOSPITAL', 'PARK', 'FERRY_TERMINAL', 'OTHER');

-- AlterTable
ALTER TABLE "Location" DROP COLUMN "state",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "lga" TEXT,
ADD COLUMN     "osmId" TEXT,
ADD COLUMN     "osmType" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
DROP COLUMN "type",
ADD COLUMN     "type" "LocationType" NOT NULL;

-- DropTable
DROP TABLE "Landmark";

-- DropTable
DROP TABLE "RouteReport";

-- CreateTable
CREATE TABLE "FareReport" (
    "id" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toName" TEXT NOT NULL,
    "transportType" "TransportType" NOT NULL,
    "amountPaid" INTEGER NOT NULL,
    "source" "ReportSource" NOT NULL DEFAULT 'USER',
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FareReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteFareSnapshot" (
    "id" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toName" TEXT NOT NULL,
    "transportType" "TransportType" NOT NULL,
    "minFare" INTEGER NOT NULL,
    "maxFare" INTEGER NOT NULL,
    "typicalFare" INTEGER NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "outliersExcluded" INTEGER NOT NULL,
    "lastCalculatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteFareSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FareReport_fromLocationId_toName_transportType_idx" ON "FareReport"("fromLocationId", "toName", "transportType");

-- CreateIndex
CREATE INDEX "FareReport_reportedAt_idx" ON "FareReport"("reportedAt");

-- CreateIndex
CREATE INDEX "RouteFareSnapshot_toName_idx" ON "RouteFareSnapshot"("toName");

-- CreateIndex
CREATE UNIQUE INDEX "RouteFareSnapshot_fromLocationId_toName_transportType_key" ON "RouteFareSnapshot"("fromLocationId", "toName", "transportType");

-- CreateIndex
CREATE UNIQUE INDEX "Location_osmId_key" ON "Location"("osmId");

-- CreateIndex
CREATE INDEX "Location_name_idx" ON "Location"("name");

-- CreateIndex
CREATE INDEX "Location_type_idx" ON "Location"("type");

-- CreateIndex
CREATE INDEX "Location_lga_idx" ON "Location"("lga");

-- AddForeignKey
ALTER TABLE "FareReport" ADD CONSTRAINT "FareReport_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteFareSnapshot" ADD CONSTRAINT "RouteFareSnapshot_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
