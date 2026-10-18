// backend/scripts/test-file-links.ts
//
// Pure tests for private document storage: storage references, legacy URL parsing, signed
// file links (tamper / expiry), link names, and signed Cloudinary delivery URLs.
// No network, no database.
//   node -r ts-node/register scripts/test-file-links.ts
process.env.CLOUDINARY_CLOUD_NAME = "testcloud";
process.env.CLOUDINARY_API_KEY = "123456";
process.env.CLOUDINARY_API_SECRET = "test-secret";
process.env.FILE_TOKEN_SECRET = "x".repeat(40);
process.env.BACKEND_URL = "https://backend.example.test/";
process.env.API_PREFIX = "/api/v1";

import {
  isRef,
  parseCloudinaryUrl,
  parseStored,
  storedExtension,
  toRef,
  upstreamUrl,
} from "../src/services/fileStorage";
import {
  fileLinker,
  resetFileTokenKeyForTests,
  signFileToken,
  verifyFileToken,
} from "../src/services/fileLinks";
import { linkApplicationDocs } from "../src/services/applicationDocs";
import Fastify from "fastify";
import { fileRoutes } from "../src/routes/files";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}`, detail ?? "");
  }
}

// ─── Legacy URLs ───
const legacyJpg = "https://res.cloudinary.com/testcloud/image/upload/v1729000000/drivers/documents/abc_p1.jpg";
const legacyPdf = "https://res.cloudinary.com/testcloud/image/upload/v1729000000/driver-applications/insurance/app1_1729.pdf";
const a1 = parseCloudinaryUrl(legacyJpg);
check("1 legacy jpg parsed", a1?.publicId === "drivers/documents/abc_p1" && a1?.format === "jpg" && a1?.type === "upload" && a1?.resourceType === "image", a1);
const a2 = parseCloudinaryUrl(legacyPdf);
check("2 legacy pdf parsed", a2?.publicId === "driver-applications/insurance/app1_1729" && a2?.format === "pdf", a2);
check("3 other cloud rejected", parseCloudinaryUrl("https://res.cloudinary.com/othercloud/image/upload/v1/x.jpg") === null);
check("4 other host rejected", parseCloudinaryUrl("https://evil.example.com/testcloud/image/upload/v1/x.jpg") === null);
check(
  "5 transformation URL rejected",
  parseCloudinaryUrl("https://res.cloudinary.com/testcloud/image/upload/w_400,h_400,c_thumb,g_face/v1/drivers/documents/x.jpg") === null
);

// ─── References ───
const ref = toRef({ type: "authenticated", resourceType: "image", format: "pdf", publicId: "drivers/documents/k_p1_1_ab" });
check("6 ref format", ref === "cld:authenticated:image:pdf:drivers/documents/k_p1_1_ab", ref);
const s = parseStored(ref);
check("7 ref round trip", s?.kind === "ref" && s.asset.publicId === "drivers/documents/k_p1_1_ab" && s.asset.format === "pdf", s);
check("8 isRef", isRef(ref) && !isRef(legacyJpg) && !isRef(null));
check("9 unknown value", parseStored("https://example.test/a.jpg")?.kind === "unknown");
check("10 extensions", storedExtension(parseStored(ref)) === "pdf" && storedExtension(parseStored(legacyJpg)) === "jpg" && storedExtension(parseStored("x")) === "bin");

// ─── Upstream (server-side) URLs ───
const up = upstreamUrl(parseStored(ref)!)!;
check("11 authenticated → signed delivery URL", /^https:\/\/res\.cloudinary\.com\/testcloud\/image\/authenticated\/s--[A-Za-z0-9_-]{8}--\/.*drivers\/documents\/k_p1_1_ab\.pdf/.test(up), up);
check("12 legacy public → same URL", upstreamUrl(parseStored(legacyJpg)!) === legacyJpg);
check("13 unknown → no upstream", upstreamUrl(parseStored("https://example.test/a.jpg")!) === null);

// ─── Tokens ───
const viewer = { kind: "admin" as const, id: "u1" };
const now = Date.UTC(2026, 9, 18, 12, 0, 0);
const t = signFileToken({ ref, viewer, context: "doc:d1", page: 2 }, 600, now);
const v = verifyFileToken(t, now + 1000);
check("14 valid token", v.ok && v.payload.r === ref && v.payload.v === "admin:u1" && v.payload.c === "doc:d1" && v.payload.p === 2, v);
check("15 expired after 10 min", (() => { const r = verifyFileToken(t, now + 601_000); return !r.ok && r.reason === "expired"; })());
const [body, sig] = t.split(".");
const forged = Buffer.from(JSON.stringify({ r: toRef({ type: "authenticated", resourceType: "image", format: "jpg", publicId: "drivers/documents/OTHER" }), v: "admin:u1", c: "doc:d1", p: 1, e: 9999999999 })).toString("base64url");
check("16 changed payload rejected", (() => { const r = verifyFileToken(`${forged}.${sig}`, now); return !r.ok && r.reason === "bad_signature"; })());
check("17 garbage rejected", !verifyFileToken("nope", now).ok && !verifyFileToken(`${body}.`, now).ok && !verifyFileToken(`${body}.${sig}.x`, now).ok);
process.env.FILE_TOKEN_SECRET = "y".repeat(40);
resetFileTokenKeyForTests();
check("18 other secret rejects old token", !verifyFileToken(t, now).ok);
process.env.FILE_TOKEN_SECRET = "x".repeat(40);
resetFileTokenKeyForTests();
check("19 original secret accepts again", verifyFileToken(t, now).ok);

// ─── Links ───
const files = fileLinker(undefined, viewer);
const doc = files.doc({ id: "d1", fileUrl: ref, pageUrls: [legacyJpg], type: "INSURANCE" });
check("20 doc pages are links", doc.pages.length === 2 && doc.pages.every((p) => p.startsWith("https://backend.example.test/api/v1/files/")), doc.pages);
check("21 link names keep extension", doc.pages[0].includes("/files/page-1.pdf?t=") && doc.pages[1].includes("/files/page-2.jpg?t="), doc.pages);
check("22 fileUrl/pageUrls replaced, other fields kept", doc.fileUrl === doc.pages[0] && doc.pageUrls[0] === doc.pages[1] && (doc as any).type === "INSURANCE");
check("23 no storage refs leak", !JSON.stringify(doc).includes("cld:") && !JSON.stringify(doc).includes("res.cloudinary.com"));
const tok = new URL(doc.pages[0]).searchParams.get("t") ?? "";
const tv = verifyFileToken(tok);
check("24 link token names the right file", tv.ok && tv.payload.r === ref && tv.payload.c === "doc:d1" && tv.payload.p === 1, tv);

const app = linkApplicationDocs(files, "app1", {
  id: "app1",
  name: "Test",
  docPcoBadge: ref,
  docMot: null,
  docInsurance: [legacyPdf, ref],
  docV5c: [],
});
check("25 application docs linked", typeof app.docPcoBadge === "string" && app.docPcoBadge.includes("/files/") && app.docMot === null && app.docInsurance.length === 2 && app.docV5c.length === 0 && app.name === "Test", app);
check("26 application has no refs", !JSON.stringify(app).includes("cld:") && !JSON.stringify(app).includes("res.cloudinary.com"));

// ─── GET /files/:name?t=… (Cloudinary fetch stubbed) ───
async function routeTests() {
  const fetched: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    fetched.push(String(url));
    if (String(url).includes("MISSING")) return new Response("nope", { status: 404 });
    return new Response(Buffer.from("%PDF-1.4 test"), {
      status: 200,
      headers: { "content-type": "application/pdf", "content-length": "13" },
    });
  }) as typeof fetch;
  const app = Fastify();
  await app.register(fileRoutes, { prefix: "/api/v1" });
  const path = (link: string) => link.replace("https://backend.example.test", "");

  const ok = await app.inject({ method: "GET", url: path(doc.pages[0]) });
  check(
    "27 route streams the file",
    ok.statusCode === 200 && ok.body === "%PDF-1.4 test" && ok.headers["content-type"] === "application/pdf",
    { status: ok.statusCode, headers: ok.headers }
  );
  check(
    "28 private, no-store, inline",
    String(ok.headers["cache-control"]).includes("no-store") &&
      ok.headers["x-content-type-options"] === "nosniff" &&
      String(ok.headers["content-disposition"]).startsWith('inline; filename="page-1.pdf"'),
    ok.headers
  );
  check("29 fetched via signed authenticated URL", /\/image\/authenticated\/s--/.test(fetched[0] ?? ""), fetched);
  check("30 response never contains the Cloudinary URL", !JSON.stringify(ok.headers).includes("res.cloudinary.com"));

  const expired = signFileToken({ ref, viewer, context: "doc:d1" }, 600, Date.now() - 700_000);
  const r410 = await app.inject({ method: "GET", url: `/api/v1/files/page-1.pdf?t=${expired}` });
  check("31 expired link → 410", r410.statusCode === 410 && r410.body.includes("expired"), r410.statusCode);
  const rBad = await app.inject({ method: "GET", url: `/api/v1/files/page-1.pdf?t=${forged}.${sig}` });
  check("32 forged link → 404", rBad.statusCode === 404);
  const before = fetched.length;
  const unknownTok = signFileToken({ ref: "https://example.test/a.jpg", viewer, context: "doc:x" });
  const rUnknown = await app.inject({ method: "GET", url: `/api/v1/files/page-1.bin?t=${unknownTok}` });
  check("33 non-Cloudinary value → 404, not fetched", rUnknown.statusCode === 404 && fetched.length === before);
  const missingTok = signFileToken({ ref: toRef({ type: "authenticated", resourceType: "image", format: "jpg", publicId: "drivers/documents/MISSING" }), viewer, context: "doc:m" });
  const rMissing = await app.inject({ method: "GET", url: `/api/v1/files/page-1.jpg?t=${missingTok}` });
  check("34 missing in storage → 404", rMissing.statusCode === 404);

  await app.close();
  globalThis.fetch = realFetch;
}

routeTests()
  .catch((err) => {
    fail++;
    console.log("FAIL route tests crashed", err);
  })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
