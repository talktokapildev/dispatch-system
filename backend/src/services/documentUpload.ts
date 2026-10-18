// backend/src/services/documentUpload.ts
//
// Reads a multipart document upload (driver app or admin site): text fields plus one or more
// files (pages). Each file goes to Cloudinary (folder drivers/documents).
import type { FastifyRequest } from "fastify";
import type {} from "@fastify/multipart"; // request.parts()
import { uploadToCloudinary } from "./cloudinary.service";

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
      const dataUri = `data:${part.mimetype};base64,${buffer.toString("base64")}`;
      const res = await uploadToCloudinary(
        dataUri,
        "drivers/documents",
        `${ownerKey}_p${files.length + 1}`
      );
      files.push(res.url);
    }
  }
  return { fields, files };
}
