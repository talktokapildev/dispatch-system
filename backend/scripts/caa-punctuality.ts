// backend/scripts/caa-punctuality.ts
//
// CAA punctuality statistics → CaaPunctuality table (Gatwick rows only). Run by hand once a
// month, after the CAA publishes a new month (about 2 months' lag, usually mid-month):
//   https://www.caa.co.uk/data-and-analysis/uk-aviation-market/flight-punctuality/
// Use the "Punctuality Statistics Full Analysis Arrival Departure (CSV)" file — the script
// refuses any other layout. Re-importing a month replaces it (the CAA sometimes republishes).
// Each import also saves one total per UK airport and direction (CaaAirportMonth) for the
// /gatwick/delays comparison. Months older than 24 months are deleted.
// The website picks the change up within the hour
// (backend rebuilds caa:summary hourly; unmatched names appear in Railway logs as "[CAA]").
//
//   node --env-file=.env -r ts-node/register scripts/caa-punctuality.ts import <url-or-file> [more...] [--dry-run]
//   node --env-file=.env -r ts-node/register scripts/caa-punctuality.ts list
//   node --env-file=.env -r ts-node/register scripts/caa-punctuality.ts delete <YYYYMM>
//
// Production: prefix with DATABASE_URL="$PROD_DB".
import { readFile } from "node:fs/promises";
import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { addMonths, KEEP_MONTHS, parseCaaCsv, periodIso } from "../src/services/caaPunctualityRules";

const prisma = new PrismaClient();

async function load(src: string): Promise<string> {
  if (/^https?:\/\//i.test(src)) {
    const r = await axios.get<string>(src, {
      responseType: "text",
      timeout: 60_000,
      maxContentLength: 20 * 1024 * 1024,
      headers: { "User-Agent": "OrangeRide punctuality import (orangeride.co.uk)" },
      transformResponse: (x) => x,
    });
    return String(r.data);
  }
  return readFile(src, "utf8");
}

async function importOne(src: string, dryRun: boolean): Promise<number | null> {
  let parsed;
  try {
    parsed = parseCaaCsv(await load(src));
  } catch (err) {
    console.error(`✗ ${src}\n    ${(err as Error).message}`);
    return null;
  }
  const { period, rows } = parsed;
  const flights = (d: "A" | "D") => rows.filter((r) => r.direction === d).reduce((n, r) => n + r.matched + r.unmatched + r.cancelled, 0);
  console.log(
    `• ${periodIso(period)}: ${rows.length} Gatwick rows of ${parsed.allRows} ` +
      `(${flights("A")} arrivals, ${flights("D")} departures planned)` +
      (parsed.duplicates ? `, ${parsed.duplicates} repeated rows dropped` : "")
  );
  if (!rows.length) {
    console.error("    No Gatwick rows - not imported.");
    return null;
  }
  if (dryRun) return period;
  const [deleted, created, , airports] = await prisma.$transaction([
    prisma.caaPunctuality.deleteMany({ where: { period } }),
    prisma.caaPunctuality.createMany({ data: rows, skipDuplicates: true }),
    prisma.caaAirportMonth.deleteMany({ where: { period } }),
    prisma.caaAirportMonth.createMany({ data: parsed.airports, skipDuplicates: true }),
  ]);
  console.log(
    `    saved ${created.count}${deleted.count ? ` (replaced ${deleted.count} from an earlier import)` : ""}; ` +
      `UK airport totals: ${airports.count}`
  );
  return period;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "import") {
    const dryRun = rest.includes("--dry-run");
    const sources = rest.filter((a) => a !== "--dry-run");
    if (!sources.length) throw new Error("Give at least one CSV file or URL");
    let ok = 0;
    for (const s of sources) if ((await importOne(s, dryRun)) != null) ok++;
    console.log(`\n${ok}/${sources.length} file(s) ${dryRun ? "checked (dry run, nothing saved)" : "imported"}.`);
    if (!dryRun && ok) {
      const latest = (await prisma.caaPunctuality.aggregate({ _max: { period: true } }))._max.period;
      if (latest) {
        const cutoff = addMonths(latest, -(KEEP_MONTHS - 1));
        const old = await prisma.caaPunctuality.deleteMany({ where: { period: { lt: cutoff } } });
        await prisma.caaAirportMonth.deleteMany({ where: { period: { lt: cutoff } } });
        if (old.count) console.log(`Deleted ${old.count} rows older than ${periodIso(cutoff)}.`);
      }
    }
    await list();
    return;
  }
  if (cmd === "list") return list();
  if (cmd === "delete") {
    const p = Number(rest[0]);
    if (!/^20\d{2}(0[1-9]|1[0-2])$/.test(String(p))) throw new Error("Usage: delete YYYYMM");
    const r = await prisma.caaPunctuality.deleteMany({ where: { period: p } });
    await prisma.caaAirportMonth.deleteMany({ where: { period: p } });
    console.log(`Deleted ${r.count} rows for ${periodIso(p)}.`);
    return list();
  }
  console.log("Usage: caa-punctuality.ts import <url-or-file>... [--dry-run] | list | delete <YYYYMM>");
}

async function list() {
  const groups = await prisma.caaPunctuality.groupBy({
    by: ["period"],
    _count: { _all: true },
    _sum: { matched: true },
    orderBy: { period: "asc" },
  });
  if (!groups.length) return console.log("\nNo months imported yet.");
  const ap = await prisma.caaAirportMonth.groupBy({ by: ["period"], _count: { _all: true } });
  const apBy = new Map(ap.map((a: { period: number; _count: { _all: number } }) => [a.period, a._count._all]));
  console.log("\nMonths held:");
  for (const g of groups)
    console.log(
      `  ${periodIso(g.period)}  ${g._count._all} rows, ${g._sum.matched ?? 0} timed flights; ` +
        `UK airport totals: ${apBy.get(g.period) ?? 0}`
    );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
