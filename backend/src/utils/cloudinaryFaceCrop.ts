// backend/src/utils/cloudinaryFaceCrop.ts
//
// Derives a face-cropped, passenger-facing profile photo URL from any
// existing Cloudinary image URL (e.g. a driver's uploaded PCO badge photo).
// Uses Cloudinary's built-in face-detection gravity (g_face) — no add-on,
// no extra dependency, works on every Cloudinary plan.
//
// If Cloudinary can't detect a face in the source image it silently falls
// back to a plain center crop — so this is always a SUGGESTION for admin
// review, never auto-published to Driver.photoUrl directly.

const CLOUDINARY_UPLOAD_MARKER = "/upload/";

export function getFaceCroppedUrl(
  sourceUrl: string | null | undefined,
  size = 400
): string | null {
  if (!sourceUrl) return null;

  const markerIndex = sourceUrl.indexOf(CLOUDINARY_UPLOAD_MARKER);
  if (markerIndex === -1) return null; // not a recognisable Cloudinary URL

  const insertAt = markerIndex + CLOUDINARY_UPLOAD_MARKER.length;
  const transform = `w_${size},h_${size},c_thumb,g_face/`;

  return sourceUrl.slice(0, insertAt) + transform + sourceUrl.slice(insertAt);
}
