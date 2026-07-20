// src/locations/locations.service.ts
//
// Search combines two sources:
// 1. Our own imported Location table (fast, and linked to crowdsourced fares)
// 2. Live Nominatim (OpenStreetMap's free search API) for broader coverage —
//    our local snapshot is a one-time import and won't have everything,
//    especially places that share names across different Lagos LGAs.
// Results are merged and deduped by rounded coordinates.

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface LocationSearchResult {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  lga: string | null;
  source: "local" | "osm_live";
  hasLocalData: boolean; // true if this also exists in our Location table (fare data available)
}

// Lagos bounding box — keeps Nominatim results relevant, not global
const LAGOS_VIEWBOX = "2.7,6.7,4.3,6.3"; // left,top,right,bottom

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: string, limit = 10): Promise<LocationSearchResult[]> {
    const cleaned = query.trim();
    if (cleaned.length < 2) return [];

    const [localResults, liveResults] = await Promise.all([
      this.searchLocal(cleaned, limit),
      this.searchNominatim(cleaned, limit),
    ]);

    // Merge, deduping by rounded coordinates (~11m precision)
    const seen = new Set<string>();
    const merged: LocationSearchResult[] = [];

    for (const r of localResults) {
      const key = `${r.latitude.toFixed(4)},${r.longitude.toFixed(4)}`;
      seen.add(key);
      merged.push(r);
    }

    for (const r of liveResults) {
      const key = `${r.latitude.toFixed(4)},${r.longitude.toFixed(4)}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(r);
      }
    }

    return merged.slice(0, limit);
  }

  private async searchLocal(query: string, limit: number): Promise<LocationSearchResult[]> {
    const results = await this.prisma.$queryRaw<any[]>`
      SELECT id, name, type, latitude, longitude, lga
      FROM "Location"
      WHERE type != 'ROAD'
        AND (
          name ILIKE ${query + "%"}
          OR name ILIKE ${"%" + query + "%"}
          OR similarity(name, ${query}) > 0.3
        )
      ORDER BY
        CASE WHEN name ILIKE ${query + "%"} THEN 0 ELSE 1 END,
        similarity(name, ${query}) DESC
      LIMIT ${limit};
    `;

    return results.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      latitude: r.latitude,
      longitude: r.longitude,
      lga: r.lga,
      source: "local" as const,
      hasLocalData: true,
    }));
  }

  private async searchNominatim(query: string, limit: number): Promise<LocationSearchResult[]> {
    try {
      const url =
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          query + ", Lagos, Nigeria"
        )}&viewbox=${LAGOS_VIEWBOX}&bounded=1&limit=${limit * 2}&addressdetails=1&dedupe=0`;

      const res = await fetch(url, {
        headers: { "User-Agent": "EkoLens/1.0 (Lagos transit app)" },
      });
      if (!res.ok) return [];

      const data = await res.json();

      return data.map((item: any) => ({
        id: `osm:${item.osm_type}:${item.osm_id}`,
        name: item.display_name.split(",")[0],
        type: (item.type || "OTHER").toUpperCase(),
        latitude: parseFloat(item.lat),
        longitude: parseFloat(item.lon),
        lga:
          item.address?.suburb ||
          item.address?.city_district ||
          item.address?.county ||
          null,
        source: "osm_live" as const,
        hasLocalData: false,
      }));
    } catch (err) {
      console.error("Nominatim search failed:", err);
      return []; // fail gracefully — local results still work
    }
  }
}