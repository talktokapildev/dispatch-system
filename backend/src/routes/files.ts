// backend/src/routes/files.ts
//
// GET /api/v1/files/:name?t=<token> — serve a private document page through a short-lived link
// (see services/fileLinks.ts). No auth header needed: the signed token is the permission.
// The file is fetched from Cloudinary server-side (signed URL) and streamed back; the Cloudinary
// URL never reaches the browser. Every view is logged ("[Files] view …") for the GDPR record.
import { Readable } from "stream";
import type { ReadableStream as WebReadableStream } from "stream/web";
import { FastifyInstance } from "fastify";
import { verifyFileToken } from "../services/fileLinks";
import { parseStored, storedExtension, upstreamUrl } from "../services/fileStorage";

const UPSTREAM_TIMEOUT_MS = 20_000;
const ALLOWED_TYPES = /^(image\/(jpeg|png|webp|gif|heic|heif|avif)|application\/pdf)$/i;

function contentTypeFor(ext: string, upstream: string | null): string {
  const t = (upstream ?? "").split(";")[0].trim().toLowerCase();
  if (ALLOWED_TYPES.test(t)) return t;
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

export async function fileRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/files/:name",
    { config: { rateLimit: false } },
    async (request, reply) => {
      // Token in the query string: it is longer than Fastify's 100-character path-param limit.
      const { name } = request.params as { name: string };
      const token = String((request.query as Record<string, unknown>)?.t ?? "");
      const notAvailable = (status: number, text: string) =>
        reply
          .status(status)
          .header("Cache-Control", "no-store")
          .type("text/plain; charset=utf-8")
          .send(text);

      const v = verifyFileToken(token);
      if (!v.ok) {
        if (v.reason === "expired")
          return notAvailable(410, "This link has expired. Reload the page to see the document.");
        return notAvailable(404, "File not found");
      }
      const { r: ref, v: viewer, c: context, p: page } = v.payload;
      const stored = parseStored(ref);
      const url = stored ? upstreamUrl(stored) : null;
      if (!stored || !url) return notAvailable(404, "File not found");

      let upstream: Response;
      try {
        upstream = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      } catch (err) {
        request.log.error({ err, context, page }, "[Files] fetch from storage failed");
        return notAvailable(502, "The file could not be loaded. Please try again.");
      }
      if (!upstream.ok || !upstream.body) {
        request.log.warn(
          { status: upstream.status, context, page },
          "[Files] storage did not return the file"
        );
        return notAvailable(upstream.status === 404 ? 404 : 502, "File not found");
      }

      const ext = storedExtension(stored);
      const type = contentTypeFor(ext, upstream.headers.get("content-type"));
      const safeName = /^[A-Za-z0-9._-]{1,60}$/.test(name) ? name : `page-${page}.${ext}`;
      const length = upstream.headers.get("content-length");

      request.log.warn({ viewer, context, page }, "[Files] view");

      reply
        .header("Content-Type", type)
        .header("Cache-Control", "private, no-store, max-age=0")
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .header("X-Robots-Tag", "noindex, nofollow")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .header(
          "Content-Disposition",
          `${type === "application/octet-stream" ? "attachment" : "inline"}; filename="${safeName}"`
        );
      if (length) reply.header("Content-Length", length);
      return reply.send(Readable.fromWeb(upstream.body as unknown as WebReadableStream));
    }
  );
}
