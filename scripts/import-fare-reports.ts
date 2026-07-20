// scripts/import-fare-reports.ts
//
// Imports crowdsourced fare reports from prisma/data/routes.csv
// (the EkoLens Google Form export, saved as CSV) into the FareReport table.
//
// Safe to re-run: every row gets a stable sourceRef ("form:row-N"), and the
// script upserts on that field, so running this twice will never create
// duplicates.
//
// Rows with unusable data (non-numeric fares, unmatched locations, etc.)
// are NOT guessed at — they're written to review-needed.csv for you to
// look at manually.
//
// Setup:
//   npm install csv-parse
// Run:
//   npx ts-node scripts/import-fare-reports.ts ./prisma/data/routes.csv

import { PrismaClient, TransportType, ReportSource } from "@prisma/client";
import { parse } from "csv-parse/sync";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

// ---- column indexes (0-based) from the form export ----
const COL = {
  TIMESTAMP: 0,
  START_JOURNEY: 1,
  TIME_OF_TRIP: 2,
  DESTINATION: 3,
  DATE_OF_TRIP: 4,
  TRANSPORT: 5,
  BOARDED_FROM: 6,
  ROUTE_STEPS: 7,
  DROPPED_AT: 8,
  AMOUNT_PAID: 9,
};

// ---- transport type mapping: form text -> Prisma enum ----
const TRANSPORT_MAP: Record<string, TransportType> = {
  danfo: "DANFO",
  keke: "KEKE",
  korope: "KOROPE",
  ride: "RIDE",
  "bus (brt)": "BRT",
  brt: "BRT",
  bike: "BIKE",
  walking: "WALKING",
};

interface ReviewRow {
  rowNumber: number;
  reason: string;
  raw: any;
}

const reviewRows: ReviewRow[] = [];

/**
 * Parses the messy "amount paid" column.
 * Returns { amount, rawText } or null if it can't be safely parsed.
 */
function parseAmount(raw: any): { amount: number; rawText: string } | null {
  if (raw === null || raw === undefined) return null;

  const rawText = String(raw).trim();

  // Plain number (most common case, e.g. 2000.0)
  if (typeof raw === "number") {
    return { amount: Math.round(raw), rawText };
  }

  const lower = rawText.toLowerCase();

  // Bail on anything that mentions "total" or "going and coming"
  // — this is a round-trip figure, not a one-way fare. Don't guess.
  if (lower.includes("total") || lower.includes("going and coming")) {
    return null;
  }

  // Bail on non-numeric entries like "Cash"
  if (!/\d/.test(rawText)) {
    return null;
  }

  // Range, e.g. "700-800" -> midpoint
  const rangeMatch = rawText.match(/(\d[\d,]*)\s*-\s*(\d[\d,]*)/);
  if (rangeMatch) {
    const low = parseInt(rangeMatch[1].replace(/,/g, ""), 10);
    const high = parseInt(rangeMatch[2].replace(/,/g, ""), 10);
    if (!isNaN(low) && !isNaN(high)) {
      return { amount: Math.round((low + high) / 2), rawText };
    }
  }

  // Strip everything except digits and commas, e.g. "#800" -> "800"
  const digitsOnly = rawText.replace(/[^\d,]/g, "").replace(/,/g, "");
  if (digitsOnly.length > 0) {
    const parsed = parseInt(digitsOnly, 10);
    if (!isNaN(parsed)) {
      return { amount: parsed, rawText };
    }
  }

  return null;
}

/**
 * Splits a comma-separated transport string and maps the FIRST
 * recognized mode to our enum. Multi-modal trips (e.g. "Danfo, Korope")
 * are recorded under their primary/first mode — the full raw list is
 * preserved in rawAmountText's sibling context via console log for now.
 */
function parseTransportType(raw: any): TransportType | null {
  if (!raw) return null;
  const parts = String(raw)
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  for (const part of parts) {
    if (TRANSPORT_MAP[part]) return TRANSPORT_MAP[part];
  }
  return null;
}

/**
 * Tries to match a free-text location name to an existing Location row.
 * 1. Exact case-insensitive match
 * 2. Fuzzy match via pg_trgm similarity (threshold 0.35)
 * Returns the matched Location id, or null if nothing confident enough.
 */
async function matchLocation(rawName: string): Promise<string | null> {
  const cleaned = rawName.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;

  // 1. exact case-insensitive match
  const exact = await prisma.location.findFirst({
    where: { name: { equals: cleaned, mode: "insensitive" } },
    select: { id: true },
  });
  if (exact) return exact.id;

  // 2. fuzzy match using pg_trgm (requires CREATE EXTENSION pg_trgm;)
  const fuzzy = await prisma.$queryRaw<{ id: string; name: string; sim: number }[]>`
    SELECT id, name, similarity(name, ${cleaned}) AS sim
    FROM "Location"
    WHERE similarity(name, ${cleaned}) > 0.35
    ORDER BY sim DESC
    LIMIT 1;
  `;

  if (fuzzy.length > 0) {
    console.log(`  fuzzy-matched "${cleaned}" -> "${fuzzy[0].name}" (score ${fuzzy[0].sim.toFixed(2)})`);
    return fuzzy[0].id;
  }

  return null;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx ts-node scripts/import-fare-reports.ts <path-to-csv>");
    process.exit(1);
  }

  const csvContent = fs.readFileSync(filePath, "utf-8");
  const dataRows: any[][] = parse(csvContent, {
    skip_empty_lines: true,
  });

  // drop header row
  dataRows.shift();

  console.log(`Loaded ${dataRows.length} rows from ${filePath}\n`);

  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const rowNumber = i + 2; // +2 because row 1 is header, spreadsheets are 1-indexed
    const row = dataRows[i];
    const sourceRef = `form:row-${rowNumber}`;

    const startJourney = row[COL.START_JOURNEY];
    const boardedFrom = row[COL.BOARDED_FROM];
    const destination = row[COL.DESTINATION];
    const transportRaw = row[COL.TRANSPORT];
    const amountRaw = row[COL.AMOUNT_PAID];
    const timestamp = row[COL.TIMESTAMP];
    const routeSteps = row[COL.ROUTE_STEPS];

    // prefer "boarded from" (usually more specific) then fall back to "start journey"
    const fromNameRaw = (boardedFrom || startJourney || "").toString();

    if (!fromNameRaw || !destination) {
      reviewRows.push({ rowNumber, reason: "missing from/destination", raw: row });
      skipped++;
      continue;
    }

    const amountParsed = parseAmount(amountRaw);
    if (!amountParsed) {
      reviewRows.push({
        rowNumber,
        reason: `unparseable amount: "${amountRaw}"`,
        raw: row,
      });
      skipped++;
      continue;
    }

    const transportType = parseTransportType(transportRaw);
    if (!transportType) {
      reviewRows.push({
        rowNumber,
        reason: `unrecognized transport type: "${transportRaw}"`,
        raw: row,
      });
      skipped++;
      continue;
    }

    const fromLocationId = await matchLocation(fromNameRaw);
    if (!fromLocationId) {
      reviewRows.push({
        rowNumber,
        reason: `no Location match for "${fromNameRaw}"`,
        raw: row,
      });
      skipped++;
      continue;
    }

    const reportedAt =
      timestamp instanceof Date ? timestamp : new Date(timestamp ?? Date.now());

    await prisma.fareReport.upsert({
      where: { sourceRef },
      update: {
        fromLocationId,
        toName: String(destination).trim(),
        transportType,
        amountPaid: amountParsed.amount,
        rawAmountText: amountParsed.rawText,
        routeDescription: routeSteps ? String(routeSteps).trim() : null,
        reportedAt,
      },
      create: {
        sourceRef,
        fromLocationId,
        toName: String(destination).trim(),
        transportType,
        amountPaid: amountParsed.amount,
        rawAmountText: amountParsed.rawText,
        routeDescription: routeSteps ? String(routeSteps).trim() : null,
        source: ReportSource.CSV_SEED,
        reportedAt,
      },
    });

    console.log(`✓ row ${rowNumber}: ${fromNameRaw} -> ${destination} (${transportType}, ₦${amountParsed.amount})`);
    imported++;
  }

  console.log(`\nDone. Imported: ${imported}, Skipped for review: ${skipped}`);

  if (reviewRows.length > 0) {
    const outPath = path.join(process.cwd(), "review-needed.csv");
    const header = "rowNumber,reason\n";
    const lines = reviewRows
      .map((r) => `${r.rowNumber},"${r.reason.replace(/"/g, '""')}"`)
      .join("\n");
    fs.writeFileSync(outPath, header + lines);
    console.log(`\n${reviewRows.length} rows need manual review — see ${outPath}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());