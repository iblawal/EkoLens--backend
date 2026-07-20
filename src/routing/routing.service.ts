// src/routing/routing.service.ts

import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";

export interface RouteStep {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
  geometry: [number, number][];
}

@Injectable()
export class RoutingService {
  private readonly apiKey: string;
  private readonly baseUrl = "https://graphhopper.com/api/1/route";

  constructor(
    private readonly config: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.apiKey = this.config.get<string>("GRAPHHOPPER_API_KEY") ?? "";
    if (!this.apiKey) {
      console.warn("GRAPHHOPPER_API_KEY is not set — routing requests will fail.");
    }
  }

  /** Single best route (existing behavior, used where only one path is needed). */
  async getRoute(from: [number, number], to: [number, number]): Promise<RouteResult> {
    const routes = await this.requestRoutes(from, to, false);
    if (routes.length === 0) throw new HttpException("No route found", HttpStatus.NOT_FOUND);
    return routes[0];
  }

  /**
   * Requests genuinely distinct alternative road paths from GraphHopper
   * (not fabricated "cheapest/fastest" labels — these are real different
   * routes GraphHopper's own algorithm finds).
   */
  async getRouteAlternatives(
    from: [number, number],
    to: [number, number],
    maxAlternatives = 3,
  ): Promise<RouteResult[]> {
    const routes = await this.requestRoutes(from, to, true, maxAlternatives);
    if (routes.length === 0) throw new HttpException("No route found", HttpStatus.NOT_FOUND);
    return routes;
  }

  private async requestRoutes(
    from: [number, number],
    to: [number, number],
    alternatives: boolean,
    maxAlternatives = 3,
  ): Promise<RouteResult[]> {
    const [fromLng, fromLat] = from;
    const [toLng, toLat] = to;

    const queryParams = new URLSearchParams({
      vehicle: "car",
      type: "json",
      points_encoded: "false",
      key: this.apiKey,
    });

    if (alternatives) {
      queryParams.set("algorithm", "alternative_route");
      queryParams.set("alternative_route.max_paths", String(maxAlternatives));
      queryParams.set("alternative_route.max_weight_factor", "1.6");
    }

    const url = `${this.baseUrl}?${queryParams.toString()}&point=${fromLat},${fromLng}&point=${toLat},${toLng}`;

    try {
      const response = await firstValueFrom(this.httpService.get(url));
      const data = response.data;
      const paths = data.paths ?? [];

      return paths.map((path: any) => {
        const steps: RouteStep[] = (path.instructions ?? []).map((instr: any) => ({
          instruction: instr.text,
          distanceMeters: instr.distance,
          durationSeconds: instr.time / 1000,
        }));

        return {
          distanceMeters: path.distance,
          durationSeconds: path.time / 1000,
          steps,
          geometry: path.points.coordinates,
        };
      });
    } catch (err: any) {
      const status = err.response?.status || HttpStatus.BAD_GATEWAY;
      const errorMessage = err.response?.data?.message || err.message;
      throw new HttpException(`Routing request failed: ${errorMessage}`, status);
    }
  }
}