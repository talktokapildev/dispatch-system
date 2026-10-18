// backend/scripts/privatise-documents.ts
//
// Moves existing document files from PUBLIC Cloudinary URLs to private (authenticated) storage
// and replaces the URLs in the database with storage references (cld:…).
//
// Covers DriverDocument.fileUrl / pageUrls and DriverApplication.doc* (all rows, archived too).
// Profile photos (Driver.photoUrl) stay public; the script only warns if one points into a
// document folder.
//
// Usage (prod):
//   DATABASE_URL="$PROD_DB" CLOUDINARY_CLOUD_NAME=… CLOUDINARY_API_KEY=… CLOUDINARY_API_SECRET=… \
//     node -r ts-node/register scripts/privatise-documents.ts            # dry run (no changes)
//   … scripts/privatise-documents.ts --apply                               # move + update DB
//
// Safe to run again: values that are already references are skipped, and a file that was
// already moved by an interrupted run is detected and its row updated.
import { PrismaClient } from "@prisma/client";
import {
  type CloudinaryAsset,
  assetExists,
  makeAuthenticated,
  missingStorageConfig,
  parseStored,
  toRef,
} from "../src/services/fileStorage";
import { APP_DOC_MULTI, APP_DOC_SINGLE } from "../src/services/applicationDocs";

const APPLY = process.argv.includes("--apply");
const DOC_FOLDERS = ["driver-applications/", "drivers/documents/"];

type Outcome = { ref: string } | { error: string };

async function main() {
  const missing = missingStorageConfig();
  if (missing.length) {
    console.error(`Missing env: ${missing.join(", ")}`);
    process.exit(1);
  }
  const prisma = new PrismaClient();
  console.log(APPLY ? "=== APPLY: moving files and updating the database ===" : "=== DRY RUN: nothing will change ===");

  const docs = await prisma.driverDocument.findMany({
    select: { id: true, fileUrl: true, pageUrls: true },
  });
  const apps = await prisma.driverApplication.findMany({
    select: {
      id: true,
      docPcoBadge: true,
      docDrivingLicFront: true,
      docDrivingLicBack: true,
      docPhvLicence: true,
      docMot: true,
      docDbs: true,
      docInsurance: true,
      docV5c: true,
    },
  });

  // Every stored value, de-duplicated (approval copies application URLs into DriverDocument).
  const values = new Set<string>();
  for (const d of docs) [d.fileUrl, ...d.pageUrls].forEach((v) => v && values.add(v));
  for (const a of apps) {
    for (const f of APP_DOC_SINGLE) if (a[f]) values.add(a[f]!);
    for (const f of APP_DOC_MULTI) a[f].forEach((v) => v && values.add(v));
  }

  let alreadyPrivate = 0;
  const unknown: string[] = [];
  const toMove = new Map<string, CloudinaryAsset>();
  for (const v of values) {
    const s = parseStored(v);
    if (!s) continue;
    if (s.kind === "ref" || (s.kind === "url" && s.asset.type !== "upload")) alreadyPrivate++;
    else if (s.kind === "url") toMove.set(v, s.asset);
    else unknown.push(v);
  }
  console.log(
    `Files referenced: ${values.size} — public (to move): ${toMove.size}, already private: ${alreadyPrivate}, not Cloudinary: ${unknown.length}`
  );
  if (unknown.length)
    console.log(`  Not Cloudinary (left as-is): ${unknown.slice(0, 5).map((u) => u.slice(0, 60)).join(" | ")}${unknown.length > 5 ? " …" : ""}`);

  // Move (or, in a dry run, check) each public file.
  const outcome = new Map<string, Outcome>();
  let n = 0;
  for (const [url, asset] of toMove) {
    n++;
    const label = `[${n}/${toMove.size}] ${asset.publicId}.${asset.format || "?"}`;
    try {
      if (!APPLY) {
        const pub = await assetExists(asset);
        const priv = pub ? false : await assetExists({ ...asset, type: "authenticated" });
        console.log(`${label} ${pub ? "public — will move" : priv ? "already private — DB will be updated" : "NOT FOUND in Cloudinary"}`);
        continue;
      }
      const moved = await makeAuthenticated(asset);
      outcome.set(url, { ref: toRef(moved) });
      console.log(`${label} moved`);
    } catch (err: any) {
      const msg = err?.error?.message ?? err?.message ?? String(err);
      outcome.set(url, { error: msg });
      console.log(`${label} FAILED: ${msg}`);
    }
  }

  // Warn about profile photos built from document images.
  const photos = await prisma.driver.findMany({
    where: { photoUrl: { not: null } },
    select: { id: true, photoUrl: true },
  });
  const risky = photos.filter((p) => DOC_FOLDERS.some((f) => p.photoUrl!.includes(`/${f}`)));
  if (risky.length)
    console.log(
      `WARNING: ${risky.length} driver profile photo(s) point into a document folder and will stop showing once moved — re-crop them in admin (drivers: ${risky.map((r) => r.id).join(", ")})`
    );

  if (!APPLY) {
    await prisma.$disconnect();
    console.log("Dry run finished. Run again with --apply to make the changes.");
    return;
  }

  const swap = (v: string) => {
    const o = outcome.get(v);
    return o && "ref" in o ? o.ref : v;
  };
  let docRows = 0;
  for (const d of docs) {
    const fileUrl = swap(d.fileUrl);
    const pageUrls = d.pageUrls.map(swap);
    if (fileUrl === d.fileUrl && pageUrls.every((p, i) => p === d.pageUrls[i])) continue;
    await prisma.driverDocument.update({ where: { id: d.id }, data: { fileUrl, pageUrls } });
    docRows++;
  }
  let appRows = 0;
  for (const a of apps) {
    const data: Record<string, any> = {};
    for (const f of APP_DOC_SINGLE) if (a[f] && swap(a[f]!) !== a[f]) data[f] = swap(a[f]!);
    for (const f of APP_DOC_MULTI) {
      const next = a[f].map(swap);
      if (next.some((v, i) => v !== a[f][i])) data[f] = next;
    }
    if (!Object.keys(data).length) continue;
    await prisma.driverApplication.update({ where: { id: a.id }, data });
    appRows++;
  }
  const failed = [...outcome.values()].filter((o) => "error" in o).length;
  console.log(`Updated ${docRows} document row(s) and ${appRows} application row(s). Failed files: ${failed}.`);
  if (failed) console.log("Re-run with --apply after checking the failures above (finished ones are skipped).");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
