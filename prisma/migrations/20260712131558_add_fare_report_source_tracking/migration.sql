/*
  Warnings:

  - A unique constraint covering the columns `[sourceRef]` on the table `FareReport` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransportType" ADD VALUE 'MARUWA';
ALTER TYPE "TransportType" ADD VALUE 'TAXI';
ALTER TYPE "TransportType" ADD VALUE 'UBER';
ALTER TYPE "TransportType" ADD VALUE 'WALKING';

-- AlterTable
ALTER TABLE "FareReport" ADD COLUMN     "rawAmountText" TEXT,
ADD COLUMN     "sourceRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FareReport_sourceRef_key" ON "FareReport"("sourceRef");
