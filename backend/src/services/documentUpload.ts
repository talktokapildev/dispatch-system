// backend/src/services/documentUpload.ts
//
// Reads a multipart document upload (driver app or admin site): text fields plus one or more
// files (pages). Each file is stored PRIVATELY in Cloudinary (folder drivers/documents, type
// authenticated); `files` holds storage references (cld:…), never URLs.
import type { FastifyRequest } from "fastify";
import type {} from "@fastify/multipart"; // request.parts()
import { uploadPrivate } from "./fileStorage";

export const MAX_PAGES = 6;

export async function readDocumentUpload(
  request: FastifyRequest,
  ownerKey: string
): Promise<{ fields: Record<string, string>; files: string[] }> {
  const fields: Record<string, string> = {};
  const files: string[] = [];
  for await (const part of request.parts()) {
    if (part.type === "field") {
      fields[part.fieldname] = String(part.value ?? "");
    } else if (part.type === "file") {
      const buffer = await part.toBuffer();
      if (!buffer.length) continue;
      if (files.length >= MAX_PAGES) continue;
      files.push(await uploadPrivate(buffer, "drivers/documents", `${ownerKey}_p${files.length + 1}`));
    }
  }
  return { fields, files };
}
