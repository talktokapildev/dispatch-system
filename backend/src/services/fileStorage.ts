// backend/src/services/fileStorage.ts
//
// Cloudinary storage for driver documents (private) and profile photos (public).
//
// Private files (licences, DBS, insurance, MOT, V5C) are uploaded as type "authenticated":
// Cloudinary only delivers them (and any transformation of them) with a signed URL. The
// database stores a storage reference, never a URL:
//
//   cld:<type>:<resourceType>:<format>:<publicId>
//   e.g. cld:authenticated:image:pdf:drivers/documents/3f2a_p1_1729250000000_a1b2c3
//
// Browsers never see a Cloudinary URL for these: the API hands out short-lived links to our
// own GET /files/:token/:name (see fileLinks.ts), which fetches the file here server-side.
//
// Older rows still hold public URLs (https://res.cloudinary.com/<cloud>/image/upload/v…/…)
// until scripts/privatise-documents.ts has moved them. Both formats are understood.
//
// Env: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET (all required in
// production — the server refuses to start without them, see assertFileStorageConfig).
import crypto from "crypto";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

export type CloudinaryFolder =
  | "driver-applications/pco-badge"
  | "driver-applications/driving-licence-front"
  | "driver-applications/driving-licence-back"
  | "driver-applications/phv-licence"
  | "driver-applications/insurance"
  | "driver-applications/mot"
  | "driver-applications/dbs-check"
  | "driver-applications/v5c-logbook"
  | "drivers/profile-photos"
  | "drivers/documents";

/** A file in Cloudinary: enough to build a (signed) delivery URL or move it. */
export interface CloudinaryAsset {
  type: string; // "authenticated" | "upload" | "private"
  resourceType: string; // "image" | "raw" | "video"
  format: string; // "jpg", "pdf", … ("" when unknown)
  publicId: string; // includes folders, no extension
}

export type StoredFile =
  | { kind: "ref"; asset: CloudinaryAsset } // cld:… reference (new)
  | { kind: "url"; url: string; asset: CloudinaryAsset } // legacy public Cloudinary URL
  | { kind: "unknown"; value: string }; // anything else (test data, foreign URLs)

const REF_PREFIX = "cld:";

// ─── Config ──────────────────────────────────────────────────────────────────

let configured = false;
function cloudName(): string {
  return (process.env.CLOUDINARY_CLOUD_NAME ?? "").trim();
}

function ensureConfigured() {
  if (configured) return;
  const cloud_name = cloudName();
  const api_key = process.env.CLOUDINARY_API_KEY?.trim();
  const api_secret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (!cloud_name || !api_key || !api_secret)
    throw new Error(
      "Cloudinary is not configured: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET"
    );
  cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
  configured = true;
}

/** Names of missing env vars (empty = OK). Used at startup. */
export function missingStorageConfig(): string[] {
  return ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"].filter(
    (k) => !(process.env[k] ?? "").trim()
  );
}

// ─── References ──────────────────────────────────────────────────────────────

export function toRef(a: CloudinaryAsset): string {
  return `${REF_PREFIX}${a.type}:${a.resourceType}:${a.format}:${a.publicId}`;
}

export function isRef(value: string | null | undefined): boolean {
  return !!value && value.startsWith(REF_PREFIX);
}

/**
 * Parse a public Cloudinary delivery URL of OUR cloud into its parts.
 * https://res.cloudinary.com/<cloud>/<resource>/<type>/[s--sig--/][v123/]<publicId>.<ext>
 * Returns null for other hosts/clouds or URLs with transformations (we never stored those).
 */
export function parseCloudinaryUrl(url: string, cloud = cloudName()): CloudinaryAsset | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.hostname !== "res.cloudinary.com") return null;
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  // [cloud, resource, type, ...rest]
  if (parts.length < 4 || !cloud || parts[0] !== cloud) return null;
  const [, resourceType, type, ...rest] = parts;
  if (!["image", "raw", "video"].includes(resourceType)) return null;
  if (rest[0] && /^s--[A-Za-z0-9_-]+--$/.test(rest[0])) rest.shift();
  if (rest[0] && /^v\d+$/.test(rest[0])) rest.shift();
  if (!rest.length) return null;
  // Transformations (e.g. w_400,h_400,c_thumb) — we never stored those.
  if (rest.slice(0, -1).some((seg) => seg.includes(","))) return null;
  const last = rest[rest.length - 1];
  const dot = resourceType === "raw" ? -1 : last.lastIndexOf(".");
  const format = dot > 0 ? last.slice(dot + 1).toLowerCase() : "";
  const name = dot > 0 ? last.slice(0, dot) : last;
  const publicId = [...rest.slice(0, -1), name].join("/");
  return { type, resourceType, format, publicId };
}

export function parseStored(value: string | null | undefined): StoredFile | null {
  if (!value) return null;
  if (value.startsWith(REF_PREFIX)) {
    const body = value.slice(REF_PREFIX.length);
    const m = /^([a-z]+):([a-z]+):([a-z0-9]*):(.+)$/i.exec(body);
    if (!m) return { kind: "unknown", value };
    return {
      kind: "ref",
      asset: { type: m[1], resourceType: m[2], format: m[3].toLowerCase(), publicId: m[4] },
    };
  }
  const asset = parseCloudinaryUrl(value);
  if (asset) return { kind: "url", url: value, asset };
  return { kind: "unknown", value };
}

/** File extension to show in links ("jpg", "pdf"; "bin" when unknown). */
export function storedExtension(stored: StoredFile | null): string {
  if (!stored || stored.kind === "unknown") return "bin";
  return stored.asset.format || (stored.asset.resourceType === "image" ? "jpg" : "bin");
}

/**
 * URL our server fetches the file from (never given to a browser).
 * Authenticated/private assets get a signed delivery URL; legacy public URLs are used as-is.
 */
export function upstreamUrl(stored: StoredFile): string | null {
  if (stored.kind === "unknown") return null;
  const a = stored.asset;
  if (a.type === "upload" && stored.kind === "url") return stored.url;
  ensureConfigured();
  return cloudinary.url(a.publicId, {
    type: a.type,
    resource_type: a.resourceType,
    ...(a.format ? { format: a.format } : {}),
    sign_url: a.type !== "upload",
    secure: true,
  });
}

// ─── Uploads ─────────────────────────────────────────────────────────────────

function uniqueId(base: string): string {
  const safe = base.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return `${safe}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function uploadBufferRaw(
  buffer: Buffer,
  opts: { folder: string; publicId: string; type: "authenticated" | "upload" }
): Promise<UploadApiResponse> {
  ensureConfigured();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder,
        public_id: opts.publicId,
        type: opts.type,
        resource_type: "image", // images and PDFs (PDF delivery is enabled on the account)
        overwrite: false,
        unique_filename: false,
        use_filename: false,
      },
      (err, res) => (err || !res ? reject(err ?? new Error("Empty Cloudinary response")) : resolve(res))
    );
    stream.end(buffer);
  });
}

/** Decode "data:<mime>;base64,…" or raw base64 (treated as JPEG). */
export function decodeDataUri(data: string): Buffer {
  const comma = data.startsWith("data:") ? data.indexOf(",") : -1;
  return Buffer.from(comma >= 0 ? data.slice(comma + 1) : data, "base64");
}

/** Upload a private document page. Returns the storage reference to save in the DB. */
export async function uploadPrivate(
  buffer: Buffer,
  folder: CloudinaryFolder,
  ownerKey: string
): Promise<string> {
  if (!buffer.length) throw new Error("Empty file");
  const res = await uploadBufferRaw(buffer, {
    folder,
    publicId: uniqueId(ownerKey),
    type: "authenticated",
  });
  return toRef({
    type: res.type ?? "authenticated",
    resourceType: res.resource_type ?? "image",
    format: (res.format ?? "").toLowerCase(),
    publicId: res.public_id,
  });
}

/** Upload a PUBLIC image (driver profile photo shown to passengers). Returns its URL. */
export async function uploadPublicImage(
  buffer: Buffer,
  folder: "drivers/profile-photos",
  ownerKey: string
): Promise<string> {
  const res = await uploadBufferRaw(buffer, { folder, publicId: uniqueId(ownerKey), type: "upload" });
  return res.secure_url;
}

// ─── Moving existing files (scripts/privatise-documents.ts) ───────────────────

/** Does the asset exist in Cloudinary with this delivery type? */
export async function assetExists(a: CloudinaryAsset): Promise<boolean> {
  ensureConfigured();
  try {
    await cloudinary.api.resource(a.publicId, { type: a.type, resource_type: a.resourceType });
    return true;
  } catch (err: any) {
    const code = err?.error?.http_code ?? err?.http_code;
    if (code === 404) return false;
    throw err;
  }
}

/**
 * Make a public asset authenticated (same public id). Old public URLs stop working and the
 * CDN cache is invalidated. Safe to repeat: if it is already authenticated, nothing changes.
 */
export async function makeAuthenticated(a: CloudinaryAsset): Promise<CloudinaryAsset> {
  ensureConfigured();
  const target: CloudinaryAsset = { ...a, type: "authenticated" };
  if (a.type === "authenticated") return target;
  try {
    await cloudinary.uploader.rename(a.publicId, a.publicId, {
      type: a.type,
      to_type: "authenticated",
      resource_type: a.resourceType,
      invalidate: true,
      overwrite: false,
    });
    return target;
  } catch (err) {
    // Already moved by an earlier (interrupted) run?
    if (await assetExists(target)) return target;
    throw err;
  }
}
