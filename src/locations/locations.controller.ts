// src/locations/locations.controller.ts

import { Controller, Get, Query } from "@nestjs/common";
import { LocationsService } from "./locations.service";

@Controller("locations")
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  // GET /locations/search?q=magodo
  @Get("search")
  async search(@Query("q") q: string) {
    if (!q) return [];
    return this.locationsService.search(q);
  }
}