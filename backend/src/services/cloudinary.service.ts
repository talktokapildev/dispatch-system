// backend/src/services/cloudinary.service.ts
// Handles Cloudinary uploads for driver onboarding documents.
//
// Uses Node 18+ native fetch + FormData — no extra npm packages needed.
//
// Required env vars:
//   CLOUDINARY_CLOUD_NAME    — your cloud name from dashboard
//   CLOUDINARY_UPLOAD_PRESET — an unsigned upload preset name
//
// Cloudinary dashboard setup:
//   Settings > Upload > Upload presets > Add upload preset
//   Set signing mode: Unsigned
//   Set folder: driver-applications
//   Copy preset name → CLOUDINARY_UPLOAD_PRESET in Railway env vars
//
// Optional (for signed uploads — more secure):
//   CLOUDINARY_API_KEY
//   CLOUDINARY_API_SECRET
//   CLOUDINARY_SIGNED=true

import crypto from "crypto";

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME!;
const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const USE_SIGNED = process.env.CLOUDINARY_SIGNED === "true";

export type CloudinaryFolder =
  | "driver-applications/pco-badge"
  | "driver-applications/driving-licence-front"
  | "driver-applications/driving-licence-back"
  | "driver-applications/phv-licence"
  | "driver-applications/insurance"
  | "driver-applications/mot"
  | "driver-applications/dbs-check"
  | "driver-applications/v5c-logbook";

export interface CloudinaryUploadResult {
  url: string;
  publicId: string;
}

/**
 * Upload a base64-encoded image (data URI or raw base64) to Cloudinary.
 * Uses native fetch + FormData (Node 18+) — no npm packages required.
 */
export async function uploadToCloudinary(
  base64Data: string,
  folder: CloudinaryFolder,
  applicationId: string
): Promise<CloudinaryUploadResult> {
  if (!CLOUD_NAME) {
    throw new Error("CLOUDINARY_CLOUD_NAME not set in environment");
  }

  // Normalise — accept either raw base64 or data URI format
  const imageData = base64Data.startsWith("data:")
    ? base64Data
    : `data:image/jpeg;base64,${base64Data}`;

  const publicId = `${applicationId}_${Date.now()}`;
  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

  // Native FormData (available globally in Node 18+)
  const form = new FormData();
  form.append("file", imageData);
  form.append("folder", folder);
  form.append("public_id", publicId);

  if (USE_SIGNED && API_KEY && API_SECRET) {
    const timestamp = Math.round(Date.now() / 1000).toString();
    const paramsString = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`;
    const signature = crypto
      .createHash("sha256")
      .update(paramsString + API_SECRET)
      .digest("hex");

    form.append("api_key", API_KEY);
    form.append("timestamp", timestamp);
    form.append("signature", signature);
  } else {
    if (!UPLOAD_PRESET) {
      throw new Error(
        "CLOUDINARY_UPLOAD_PRESET not set (required for unsigned uploads)"
      );
    }
    form.append("upload_preset", UPLOAD_PRESET);
  }

  // Native fetch — no import needed in Node 18+
  // Do NOT set Content-Type manually — fetch sets it automatically
  // with the correct multipart boundary when body is FormData
  const response = await fetch(uploadUrl, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cloudinary upload failed (${response.status}): ${error}`);
  }

  const result = (await response.json()) as {
    secure_url: string;
    public_id: string;
  };

  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
}

/**
 * Delete an image from Cloudinary by public ID.
 * Called when a driver re-uploads to replace an existing document.
 * Requires API key + secret (signed request).
 */
export async function deleteFromCloudinary(publicId: string): Promise<void> {
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    console.warn(
      "Cloudinary delete skipped — credentials not fully configured"
    );
    return;
  }

  const timestamp = Math.round(Date.now() / 1000).toString();
  const signature = crypto
    .createHash("sha256")
    .update(`public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`)
    .digest("hex");

  const form = new FormData();
  form.append("public_id", publicId);
  form.append("api_key", API_KEY);
  form.append("timestamp", timestamp);
  form.append("signature", signature);

  await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/destroy`, {
    method: "POST",
    body: form,
  });
}
