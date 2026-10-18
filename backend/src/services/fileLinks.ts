// backend/src/services/fileLinks.ts
//
// Short-lived links to private files: <BACKEND_URL>/api/v1/files/<name>?t=<token>
//
// token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, FILE_TOKEN_SECRET))
// payload { r: storage ref or legacy URL, v: viewer ("admin:<userId>"), c: context ("doc:<id>"
// or "app:<id>:<field>"), p: page, e: expiry (unix seconds) }
//
// The link works in <img src>, <a href> and the driver app <Image> without an auth header, and
// stops working after FILE_LINK_TTL_SECONDS (10 min). The token is signed, so the file it names
// can't be changed. The name part ("page-1.pdf") is cosmetic: it lets the admin site tell PDFs
// from images and gives downloads a sensible file name.
import crypto from "crypto";
import type { FastifyRequest } from "fastify";
import { parseStored, storedExtension } from "./fileStorage";

export const FILE_LINK_TTL_SECONDS = 10 * 60;

export type ViewerKind = "admin" | "driver" | "applicant";
export interface Viewer {
  kind: ViewerKind;
  id: string;
}

export interface FileTokenPayload {
  r: string; // storage ref / legacy URL
  v: string; // viewer
  c: string; // context
  p: number; // page (1-based)
  e: number; // expires (unix seconds)
}

// ─── Secret ──────────────────────────────────────────────────────────────────

let cachedKey: Buffer | null = null;

/** True when a usable FILE_TOKEN_SECRET is set (≥ 32 characters). */
export function fileTokenSecretSet(): boolean {
  return (process.env.FILE_TOKEN_SECRET ?? "").trim().length >= 32;
}

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = (process.env.FILE_TOKEN_SECRET ?? "").trim();
  if (secret.length >= 32) {
    cachedKey = Buffer.from(secret, "utf8");
  } else if (process.env.NODE_ENV !== "production" && process.env.JWT_SECRET) {
    // Local development only: derive a separate key from JWT_SECRET.
    cachedKey = crypto.createHmac("sha256", process.env.JWT_SECRET).update("orangeride-file-links").digest();
  } else {
    throw new Error("FILE_TOKEN_SECRET is not set (needs at least 32 characters)");
  }
  return cachedKey;
}

/** Tests only: forget the cached key after changing env. */
export function resetFileTokenKeyForTests() {
  cachedKey = null;
}

// ─── Tokens ──────────────────────────────────────────────────────────────────

const b64url = (b: Buffer) => b.toString("base64url");

function sign(data: string): string {
  return b64url(crypto.createHmac("sha256", key()).update(data).digest());
}

export function signFileToken(
  input: { ref: string; viewer: Viewer; context: string; page?: number },
  ttlSeconds = FILE_LINK_TTL_SECONDS,
  now = Date.now()
): string {
  const payload: FileTokenPayload = {
    r: input.ref,
    v: `${input.viewer.kind}:${input.viewer.id}`,
    c: input.context,
    p: input.page ?? 1,
    e: Math.floor(now / 1000) + ttlSeconds,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${sign(body)}`;
}

export type VerifyResult =
  | { ok: true; payload: FileTokenPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyFileToken(token: string, now = Date.now()): VerifyResult {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return { ok: false, reason: "malformed" };
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = Buffer.from(sign(body), "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected))
    return { ok: false, reason: "bad_signature" };
  let payload: FileTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload || typeof payload.r !== "string" || typeof payload.e !== "number")
    return { ok: false, reason: "malformed" };
  if (payload.e * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

// ─── Links ───────────────────────────────────────────────────────────────────

/** Absolute base for links, e.g. https://backend-production-baf2.up.railway.app/api/v1 */
export function linkBase(request?: FastifyRequest): string {
  const env = (process.env.BACKEND_URL ?? "").trim().replace(/\/+$/, "");
  const origin = env || (request ? `${request.protocol}://${request.headers.host}` : "");
  return `${origin}${process.env.API_PREFIX || "/api/v1"}`;
}

export function fileLink(
  base: string,
  ref: string,
  viewer: Viewer,
  context: string,
  page = 1,
  now = Date.now()
): string {
  const ext = storedExtension(parseStored(ref));
  const token = signFileToken({ ref, viewer, context, page }, FILE_LINK_TTL_SECONDS, now);
  return `${base}/files/page-${page}.${ext}?t=${token}`;
}

type DocLike = { id: string; fileUrl: string; pageUrls?: string[] | null };

/**
 * Link helpers for one request. Everything that returns document files to a browser or app
 * goes through here, so stored references never leave the server.
 */
export function fileLinker(request: FastifyRequest | undefined, viewer: Viewer) {
  const base = linkBase(request);
  const now = Date.now();
  const link = (value: string | null | undefined, context: string, page = 1): string | null =>
    value ? fileLink(base, value, viewer, context, page, now) : null;
  return {
    link,
    list: (values: string[] | null | undefined, context: string): string[] =>
      (values ?? []).map((v, i) => link(v, context, i + 1)!).filter(Boolean),
    /** Replace fileUrl / pageUrls with links and add `pages` (all pages, in order). */
    doc<T extends DocLike>(d: T): Omit<T, "fileUrl" | "pageUrls"> & {
      fileUrl: string;
      pageUrls: string[];
      pages: string[];
    } {
      const pages = [d.fileUrl, ...(d.pageUrls ?? [])]
        .map((v, i) => link(v, `doc:${d.id}`, i + 1))
        .filter((v): v is string => !!v);
      return { ...d, fileUrl: pages[0] ?? "", pageUrls: pages.slice(1), pages };
    },
  };
}
