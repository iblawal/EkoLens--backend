import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";

import { PrismaModule } from "../prisma/prisma.module";

import { RoutingService } from "./routing.service";
import { JourneyService } from "./journey.service";
import { JourneyController } from "./journey.controller";

@Module({
  imports: [
    HttpModule,
    PrismaModule,
  ],

  controllers: [
    JourneyController,
  ],

  providers: [
    RoutingService,
    JourneyService,
  ],

  exports: [
    RoutingService,
    JourneyService,
  ],
})
export class RoutingModule {}