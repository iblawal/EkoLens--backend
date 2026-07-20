// src/routing/journey.controller.ts

import { Controller, Get, Query, ParseFloatPipe } from '@nestjs/common';
import { JourneyService } from './journey.service';

@Controller('journey')
export class JourneyController {
  constructor(private readonly journeyService: JourneyService) {}

  @Get('plan')
  async planJourney(
    @Query('fromLng', ParseFloatPipe) fromLng: number,
    @Query('fromLat', ParseFloatPipe) fromLat: number,
    @Query('toLng', ParseFloatPipe) toLng: number,
    @Query('toLat', ParseFloatPipe) toLat: number,
    @Query('toName') toName: string,
    @Query('toLocationId') toLocationId?: string,
  ) {
    return this.journeyService.planJourney(
      [fromLng, fromLat],
      [toLng, toLat],
      toName,
      toLocationId,
    );
  }
}