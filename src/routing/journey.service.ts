import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RoutingService } from './routing.service';

@Injectable()
export class JourneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly routingService: RoutingService,
  ) {}

  /**
   * Plans a journey.
   * @param from          [lng, lat] of the user's current GPS position
   * @param toCoords      [lng, lat] of the destination (always required now —
   *                      the frontend sends this regardless of source)
   * @param toName        Display name of the destination, used for fare matching
   * @param toLocationId  Exact local Location id, if the pick came from our
   *                      own database. Omitted/ignored for live-OSM picks.
   */
  async planJourney(
    from: [number, number],
    toCoords: [number, number],
    toName: string,
    toLocationId?: string,
  ) {
    const [fromLng, fromLat] = from;
    const [toLng, toLat] = toCoords;

    const nearestOrigin = await this.findNearestLocation(fromLat, fromLng);
    if (!nearestOrigin) {
      return { routes: null, journeyGuide: null, message: "Could not resolve your location." };
    }

    // Resolve destination display info — use the real Location row if we
    // have one (id given and not an external "osm:" id), otherwise just
    // use the coordinates/name the frontend already resolved.
    let destination: { id: string | null; name: string; type: string; lga: string | null; area: string | null };

    if (toLocationId && !toLocationId.startsWith("osm:")) {
      const local = await this.prisma.location.findUnique({ where: { id: toLocationId } });
      if (!local) throw new NotFoundException(`No location found for id ${toLocationId}`);
      destination = local;
    } else {
      destination = { id: null, name: toName, type: "OTHER", lga: null, area: null };
    }

    // Real alternative road paths — with graceful degradation if GraphHopper
    // has trouble: try alternatives first, fall back to a single best route,
    // and if routing fails entirely, still return fare/landmark data rather
    // than crashing the whole request.
    let physicalRoutes: any[] = [];
    let routingFailed = false;

    try {
      physicalRoutes = await this.routingService.getRouteAlternatives([fromLng, fromLat], [toLng, toLat], 3);
    } catch (err) {
      console.warn("Alternative routing failed, trying single route:", err);
      try {
        const single = await this.routingService.getRoute([fromLng, fromLat], [toLng, toLat]);
        physicalRoutes = [single];
      } catch (err2) {
        console.error("Routing failed entirely:", err2);
        routingFailed = true;
      }
    }

    // Fuzzy fare match by name — works whether or not destination has a local id
    const fareSnapshots = await this.prisma.$queryRaw<any[]>`
      SELECT *,
        GREATEST(
          similarity("toName", ${destination.name}),
          similarity(${destination.name}, "toName")
        ) AS sim
      FROM "RouteFareSnapshot"
      WHERE "fromLocationId" = ${nearestOrigin.id}
        AND (
          "toName" ILIKE ${'%' + destination.name + '%'}
          OR ${destination.name} ILIKE ('%' || "toName" || '%')
          OR similarity("toName", ${destination.name}) > 0.25
        )
      ORDER BY sim DESC
      LIMIT 5;
    `;

    const currentHour = new Date().getHours();
    const isRushHour = (currentHour >= 6 && currentHour <= 9) || (currentHour >= 16 && currentHour <= 20);
    const rushHourMultiplier = isRushHour ? 1.4 : 1.0;

    const transitOptions = await Promise.all(
      fareSnapshots.map(async (snapshot) => {
        // Pull one real crowdsourced description for this exact route+mode,
        // if a commuter wrote one when reporting their fare.
        const sampleReport = await this.prisma.fareReport.findFirst({
          where: {
            fromLocationId: nearestOrigin.id,
            toName: snapshot.toName,
            transportType: snapshot.transportType,
            routeDescription: { not: null },
          },
          orderBy: { reportedAt: 'desc' },
          select: { routeDescription: true },
        });

        return {
          transportType: snapshot.transportType,
          estimatedFare: {
            min: Math.round(snapshot.minFare * rushHourMultiplier),
            max: Math.round(snapshot.maxFare * rushHourMultiplier),
            typical: Math.round(snapshot.typicalFare * rushHourMultiplier),
          },
          sampleSize: snapshot.sampleSize,
          isRushHourPrice: isRushHour,
          lastUpdated: snapshot.lastCalculatedAt,
          routeDescription: sampleReport?.routeDescription ?? null,
        };
      }),
    );

    return {
      routes: physicalRoutes.map((r) => ({
        distanceMeters: r.distanceMeters,
        durationSeconds: r.durationSeconds,
        geometry: r.geometry,
        steps: r.steps,
      })),
      routingUnavailable: routingFailed,
      journeyGuide: {
        boardingFrom: {
          id: nearestOrigin.id,
          name: nearestOrigin.name,
          type: nearestOrigin.type,
          description: nearestOrigin.description || "Main boarding spot",
          lga: nearestOrigin.lga,
          area: nearestOrigin.area,
          nearbyLandmarks: await this.findNearbyLandmarks(nearestOrigin.latitude, nearestOrigin.longitude, nearestOrigin.id),
        },
        alightingAt: {
          id: destination.id,
          name: destination.name,
          type: destination.type,
          lga: destination.lga,
          area: destination.area,
          nearbyLandmarks: await this.findNearbyLandmarks(toLat, toLng, destination.id),
        },
        options: transitOptions.length > 0 ? transitOptions : [
          {
            transportType: 'DANFO',
            note: 'No active crowd snapshot yet. Showing estimated local baseline.',
            estimatedFare: { min: 400, max: 800, typical: 500 },
            isRushHourPrice: isRushHour,
          }
        ],
      },
    };
  }

  /**
   * Finds well-known nearby places (landmarks, markets, hospitals, etc.)
   * within ~500m — the kind of reference points Lagosians actually use
   * when giving directions ("near Tantalizers", "opposite GTBank").
   */
  private async findNearbyLandmarks(
    lat: number,
    lng: number,
    excludeId: string | null,
    radiusKm = 0.5,
    limit = 3,
  ): Promise<string[]> {
    const results = await this.prisma.$queryRaw<any[]>`
      SELECT name, distance FROM (
        SELECT name,
        (6371 * acos(cos(radians(${lat})) * cos(radians(latitude)) * cos(radians(longitude) - radians(${lng})) + sin(radians(${lat})) * sin(radians(latitude)))) AS distance
        FROM "Location"
        WHERE type IN ('LANDMARK', 'MARKET', 'HOSPITAL', 'SCHOOL', 'PARK', 'FERRY_TERMINAL')
          AND id != ${excludeId ?? ''}
          AND name IS NOT NULL
      ) sub
      WHERE distance < ${radiusKm}
      ORDER BY distance
      LIMIT ${limit};
    `;
    return results.map((r) => r.name);
  }

  private async findNearestLocation(lat: number, lng: number): Promise<any> {
    const locations = await this.prisma.$queryRaw<any[]>`
      SELECT *, 
      (6371 * acos(cos(radians(${lat})) * cos(radians(latitude)) * cos(radians(longitude) - radians(${lng})) + sin(radians(${lat})) * sin(radians(latitude)))) AS distance 
      FROM "Location" 
      WHERE type != 'ROAD'
      ORDER BY distance 
      LIMIT 1;
    `;
    return locations[0];
  }
}