// scripts/run-aggregation-once.ts
//
// Manually triggers the fare aggregation logic once, without waiting for
// the hourly cron. Useful right after importing new FareReport data.
//
// Run:
//   npx ts-node scripts/run-aggregation-once.ts

import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { FareAggregationService } from "../src/fares/fare-aggregation.service";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const fareAggregationService = app.get(FareAggregationService);

  console.log("Running fare aggregation manually...");
  await fareAggregationService.recalculateAllFareRanges();
  console.log("Done.");

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});