// backend/src/routes/admin/driver-photo.routes.ts
// Admin-only routes for confirming a driver's passenger-facing profile photo.
// GET   /api/v1/admin/drivers/:driverId/suggested-photo
// PATCH /api/v1/admin/drivers/:driverId/photo
//
// The PCO badge is a private document: the admin site gets a short-lived link to it
// (badgeUrl), crops the face in the browser and sends the result back as { image }.
// The confirmed photo is stored PUBLIC (passengers see it).

import { FastifyInstance } from "fastify";
import { decodeDataUri, isRef, uploadPublicImage } from "../../services/fileStorage";
import { fileLinker } from "../../services/fileLinks";

/** A profile photo URL we accept as-is: a public Cloudinary image of ours, nothing private. */
function acceptablePhotoUrl(url: string): boolean {
  if (isRef(url) || url.includes("/files/")) return false;
  try {
    const u = new URL(url);
    const cloud = (process.env.CLOUDINARY_CLOUD_NAME ?? "").trim();
    return (
      u.protocol === "https:" &&
      u.hostname === "res.cloudinary.com" &&
      !!cloud &&
      u.pathname.startsWith(`/${cloud}/image/upload/`)
    );
  } catch {
    return false;
  }
}

export async function adminDriverPhotoRoutes(fastify: FastifyInstance) {
  // ─── GET /admin/drivers/:driverId/suggested-photo ──────────────────────────
  // Looks up the driver's latest PCO badge document and returns a short-lived link to it
  // (badgeUrl) for the in-browser cropper. suggestedPhotoUrl is no longer produced (the badge
  // is private, so Cloudinary can't crop it publicly) and is always null.
  fastify.get(
    "/admin/drivers/:driverId/suggested-photo",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { driverId } = request.params as { driverId: string };

      const badgeDoc = await fastify.prisma.driverDocument.findFirst({
        where: { driverId, type: "PCO_LICENSE", archivedAt: null },
        orderBy: { createdAt: "desc" },
      });

      if (!badgeDoc) {
        return reply
          .status(404)
          .send({ error: "No PCO badge document found for this driver" });
      }

      const files = fileLinker(request, { kind: "admin", id: request.user.userId });
      const badgeUrl = files.link(badgeDoc.fileUrl, `doc:${badgeDoc.id}`, 1);
      return reply.status(200).send({ badgeUrl, suggestedPhotoUrl: null });
    }
  );

  // ─── PATCH /admin/drivers/:driverId/photo ───────────────────────────────────
  // Confirms the driver's profile photo. Accepts EITHER:
  //   { photoUrl }  — keep an existing PUBLIC Cloudinary image URL of ours
  //   { image }     — base64 data URI (the browser crop, or a manual upload)
  fastify.patch(
    "/admin/drivers/:driverId/photo",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { driverId } = request.params as { driverId: string };
      const { photoUrl, image } = request.body as {
        photoUrl?: string;
        image?: string;
      };
      const adminUser = (request as any).user;

      const driver = await fastify.prisma.driver.findUnique({
        where: { id: driverId },
      });
      if (!driver) return reply.status(404).send({ error: "Driver not found" });

      let finalUrl: string;

      if (image) {
        try {
          finalUrl = await uploadPublicImage(
            decodeDataUri(image),
            "drivers/profile-photos",
            driverId
          );
        } catch (err: any) {
          fastify.log.error(
            { err },
            "Cloudinary upload failed for driver photo"
          );
          return reply
            .status(500)
            .send({ error: "Photo upload failed. Please try again." });
        }
      } else if (photoUrl) {
        if (!acceptablePhotoUrl(photoUrl))
          return reply
            .status(400)
            .send({ error: "This photo can't be used. Please upload the image instead." });
        finalUrl = photoUrl;
      } else {
        return reply
          .status(400)
          .send({ error: "Provide either photoUrl or image" });
      }

      await fastify.prisma.driver.update({
        where: { id: driverId },
        data: { photoUrl: finalUrl },
      });

      fastify.log.info(
        { driverId, adminUserId: adminUser?.userId },
        "Driver profile photo confirmed by admin"
      );

      return reply
        .status(200)
        .send({ message: "Driver photo updated", photoUrl: finalUrl });
    }
  );
}
