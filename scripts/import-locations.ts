// scripts/import-locations.ts
//
// Imports Lagos location data into the Location table from two OSM exports:
//   1. lagos-places.geojson  — points: bus stops, landmarks, hospitals, etc.
//   2. lagos-roads.geojson   — named streets (LineStrings)
//
// Safe to re-run: every row is upserted on osmId, so running this twice
// never creates duplicates — it just refreshes existing rows.
//
// Run:
//   npx ts-node scripts/import-locations.ts

import { PrismaClient, LocationType } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

const PLACES_FILE = path.join(process.cwd(), "prisma/data/lagos-places.geojson");
const ROADS_FILE = path.join(process.cwd(), "prisma/data/lagos-roads.geojson");

const BATCH_SIZE = 300;

/**
 * Maps OSM tags -> our LocationType enum.
 * Order matters: more specific checks first.
 */
function mapType(tags: Record<string, any>): LocationType {
  if (tags.highway === "bus_stop") return "BUS_STOP";
  if (tags.public_transport) return "BUS_STOP"; // stop_position, platform, station

  if (tags.amenity === "hospital") return "HOSPITAL";
  if (tags.amenity === "school") return "SCHOOL";
  if (tags.amenity === "marketplace") return "MARKET";
  if (tags.amenity === "ferry_terminal") return "FERRY_TERMINAL";

  if (tags.leisure === "park") return "PARK";

  if (tags.tourism || tags.historic) return "LANDMARK";

  if (tags.place) return "AREA";

  if (tags.highway) return "ROAD";

  return "OTHER";
}

function getCenter(geometry: any): { lat: number; lng: number } | null {
  if (!geometry) return null;

  if (geometry.type === "Point") {
    const [lng, lat] = geometry.coordinates;
    return { lat, lng };
  }

  if (geometry.type === "LineString") {
    const coords = geometry.coordinates;
    const mid = coords[Math.floor(coords.length / 2)];
    const [lng, lat] = mid;
    return { lat, lng };
  }

  if (geometry.type === "Polygon") {
    const ring = geometry.coordinates[0];
    const mid = ring[Math.floor(ring.length / 2)];
    const [lng, lat] = mid;
    return { lat, lng };
  }

  return null;
}

interface LocationRow {
  name: string;
  type: LocationType;
  latitude: number;
  longitude: number;
  osmId: string;
  osmType: string;
  lga: string | null;
}

function extractRows(featureCollection: any): LocationRow[] {
  const rows: LocationRow[] = [];

  for (const feature of featureCollection.features ?? []) {
    const props = feature.properties ?? {};
    const name = (props.name || "").toString().trim();
    if (!name) continue;

    const center = getCenter(feature.geometry);
    if (!center) continue;

    const osmId = (props["@id"] || "").toString();
    if (!osmId) continue; // required for our unique upsert key

    const [osmType] = osmId.split("/"); // "way/1234" -> "way"

    rows.push({
      name,
      type: mapType(props),
      latitude: center.lat,
      longitude: center.lng,
      osmId,
      osmType: osmType || null,
      lga: props.admin_name ? String(props.admin_name).trim() : null,
    });
  }

  return rows;
}

async function importRows(rows: LocationRow[], label: string) {
  console.log(`\nImporting ${rows.length} rows from ${label}...`);
  let done = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    await prisma.$transaction(
      batch.map((row) =>
        prisma.location.upsert({
          where: { osmId: row.osmId },
          update: {
            name: row.name,
            type: row.type,
            latitude: row.latitude,
            longitude: row.longitude,
            osmType: row.osmType,
            lga: row.lga,
          },
          create: {
            name: row.name,
            type: row.type,
            latitude: row.latitude,
            longitude: row.longitude,
            osmId: row.osmId,
            osmType: row.osmType,
            lga: row.lga,
          },
        })
      )
    );

    done += batch.length;
    console.log(`  ${done}/${rows.length}`);
  }
}

async function main() {
  if (!fs.existsSync(PLACES_FILE)) {
    console.error(`Missing file: ${PLACES_FILE}`);
    process.exit(1);
  }
  if (!fs.existsSync(ROADS_FILE)) {
    console.error(`Missing file: ${ROADS_FILE}`);
    process.exit(1);
  }

  const places = JSON.parse(fs.readFileSync(PLACES_FILE, "utf-8"));
  const roads = JSON.parse(fs.readFileSync(ROADS_FILE, "utf-8"));

  const placeRows = extractRows(places);
  const roadRows = extractRows(roads);

  console.log(`Parsed ${placeRows.length} named places, ${roadRows.length} named roads.`);

  await importRows(placeRows, "lagos-places.geojson");
  await importRows(roadRows, "lagos-roads.geojson");

  const total = await prisma.location.count();
  console.log(`\nDone. Location table now has ${total} total rows.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());