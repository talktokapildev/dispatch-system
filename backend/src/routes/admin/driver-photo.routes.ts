// backend/src/routes/admin/driver-photo.routes.ts
// Admin-only routes for confirming a driver's passenger-facing profile photo.
// GET   /api/v1/admin/drivers/:driverId/suggested-photo
// PATCH /api/v1/admin/drivers/:driverId/photo

import { FastifyInstance } from "fastify";
import { uploadToCloudinary } from "../../services/cloudinary.service";
import { getFaceCroppedUrl } from "../../utils/cloudinaryFaceCrop";

export async function adminDriverPhotoRoutes(fastify: FastifyInstance) {
  // ─── GET /admin/drivers/:driverId/suggested-photo ──────────────────────────
  // Looks up the driver's approved PCO badge document and returns a
  // face-cropped candidate URL, for admin review before confirming.
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

      const suggestedPhotoUrl = getFaceCroppedUrl(badgeDoc.fileUrl);
      if (!suggestedPhotoUrl) {
        return reply.status(422).send({
          error: "Could not generate a suggested crop from this document",
        });
      }

      return reply
        .status(200)
        .send({ badgeUrl: badgeDoc.fileUrl, suggestedPhotoUrl });
    }
  );

  // ─── PATCH /admin/drivers/:driverId/photo ───────────────────────────────────
  // Confirms the driver's profile photo. Accepts EITHER:
  //   { photoUrl }  — confirm a URL directly (e.g. the suggested crop above)
  //   { image }     — base64 data URI, uploaded fresh (manual replacement)
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
          // NOTE: check CloudinaryFolder type in cloudinary.service.ts —
          // "drivers/profile-photos" may need adding to that union type.
          const uploadResult = await uploadToCloudinary(
            image,
            "drivers/profile-photos",
            driverId
          );
          finalUrl = uploadResult.url;
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
