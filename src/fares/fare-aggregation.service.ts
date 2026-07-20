// src/fares/fare-aggregation.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { TransportType } from "@prisma/client";

const ROLLING_WINDOW_DAYS = 30;

@Injectable()
export class FareAggregationService {
  private readonly logger = new Logger(FareAggregationService.name);

  constructor(private prisma: PrismaService) {}

  @Cron("0 * * * *") // every hour on the hour
  async recalculateAllFareRanges() {
    this.logger.log("Starting hourly fare recalculation...");

    const cutoff = new Date(Date.now() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // group reports by route + transport type
    const groups = await this.prisma.fareReport.groupBy({
      by: ["fromLocationId", "toName", "transportType"],
      where: { reportedAt: { gte: cutoff } },
    });

    let updated = 0;

    for (const group of groups) {
      const reports = await this.prisma.fareReport.findMany({
        where: {
          fromLocationId: group.fromLocationId,
          toName: group.toName,
          transportType: group.transportType,
          reportedAt: { gte: cutoff },
        },
        select: { amountPaid: true },
      });

      const amounts = reports.map((r) => r.amountPaid).sort((a, b) => a - b);
      const filtered = this.filterOutliers(amounts);

      if (filtered.length === 0) continue;

      const minFare = filtered[0];
      const maxFare = filtered[filtered.length - 1];
      const typicalFare = this.median(filtered);
      const outliersExcluded = amounts.length - filtered.length;

      await this.prisma.routeFareSnapshot.upsert({
        where: {
          fromLocationId_toName_transportType: {
            fromLocationId: group.fromLocationId,
            toName: group.toName,
            transportType: group.transportType as TransportType,
          },
        },
        update: {
          minFare,
          maxFare,
          typicalFare,
          sampleSize: filtered.length,
          outliersExcluded,
        },
        create: {
          fromLocationId: group.fromLocationId,
          toName: group.toName,
          transportType: group.transportType as TransportType,
          minFare,
          maxFare,
          typicalFare,
          sampleSize: filtered.length,
          outliersExcluded,
        },
      });

      updated++;
    }

    this.logger.log(`Fare recalculation done. ${updated} routes updated.`);
  }

  /** IQR-based outlier filtering. Skips filtering if sample too small. */
  private filterOutliers(sorted: number[]): number[] {
    if (sorted.length < 5) return sorted; // not enough data to filter meaningfully

    const q1 = this.percentile(sorted, 25);
    const q3 = this.percentile(sorted, 75);
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    return sorted.filter((v) => v >= lowerBound && v <= upperBound);
  }

  private percentile(sorted: number[], p: number): number {
    const idx = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
  }

  private median(sorted: number[]): number {
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
}