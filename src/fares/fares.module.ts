// src/fares/fares.module.ts
import { Module } from "@nestjs/common";
import { FareAggregationService } from "./fare-aggregation.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  providers: [FareAggregationService],
})
export class FaresModule {}