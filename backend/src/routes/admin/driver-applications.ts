// backend/src/routes/admin/driver-applications.ts
// Admin-only routes — protected by fastify.authenticateAdmin.
// GET   /api/v1/admin/driver-applications           — list (filter by status, or archived)
// GET   /api/v1/admin/driver-applications/:id       — single detail
// PATCH /api/v1/admin/driver-applications/:id/approve
// PATCH /api/v1/admin/driver-applications/:id/reject
// DELETE /api/v1/admin/driver-applications/:id              — soft delete (archive)
// DELETE /api/v1/admin/driver-applications/:id/permanent    — hard delete (requires name confirmation)

import { FastifyInstance } from "fastify";

async function sendSms(fastify: FastifyInstance, to: string, body: string) {
  try {
    const twilio = require("twilio");
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    await client.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
    });
  } catch (err) {
    fastify.log.error({ err }, "Failed to send SMS notification");
  }
}

export async function adminDriverApplicationRoutes(fastify: FastifyInstance) {
  // ─── GET /api/v1/admin/driver-applications ─────────────────────────────────
  fastify.get(
    "/admin/driver-applications",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { status } = request.query as { status?: string };

      // Archived is a virtual status — filter on deletedAt
      const isArchived = status === "ARCHIVED";
      const where = isArchived
        ? { deletedAt: { not: null } }
        : status
        ? {
            status: status as "PENDING" | "APPROVED" | "REJECTED",
            deletedAt: null,
          }
        : { deletedAt: null };

      const applications = await fastify.prisma.driverApplication.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          name: true,
          phone: true,
          email: true,
          pcoBadgeNumber: true,
          pcoBadgeExpiry: true,
          vehicleMake: true,
          vehicleModel: true,
          vehicleReg: true,
          rejectionReason: true,
          reviewedAt: true,
          deletedAt: true,
          deletedBy: true,
          createdAt: true,
          docPcoBadge: true,
          docDrivingLicFront: true,
          docDrivingLicBack: true,
          docPhvLicence: true,
          docInsurance: true,
          docMot: true,
          docDbs: true,
          docV5c: true,
        },
      });

      const shaped = applications.map((app) => ({
        ...app,
        documentsUploaded: [
          app.docPcoBadge,
          app.docDrivingLicFront,
          app.docDrivingLicBack,
          app.docPhvLicence,
          (app.docInsurance as string[]).length > 0 ? "ok" : null,
          app.docMot,
          app.docDbs,
          (app.docV5c as string[]).length > 0 ? "ok" : null,
        ].filter(Boolean).length,
        documentsTotal: 8,
      }));

      // Counts per status (non-archived only)
      const counts = await fastify.prisma.driverApplication.groupBy({
        by: ["status"],
        where: { deletedAt: null },
        _count: { id: true },
      });
      const archivedCount = await fastify.prisma.driverApplication.count({
        where: { deletedAt: { not: null } },
      });
      const summary = {
        PENDING: 0,
        APPROVED: 0,
        REJECTED: 0,
        ARCHIVED: archivedCount,
      };
      counts.forEach((c) => {
        summary[c.status] = c._count.id;
      });

      return reply.status(200).send({ applications: shaped, summary });
    }
  );

  // ─── GET /api/v1/admin/driver-applications/:id ─────────────────────────────
  fastify.get(
    "/admin/driver-applications/:id",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const application = await fastify.prisma.driverApplication.findUnique({
        where: { id },
      });
      if (!application)
        return reply.status(404).send({ error: "Application not found" });
      return reply.status(200).send({ application });
    }
  );

  // ─── PATCH /api/v1/admin/driver-applications/:id/approve ───────────────────
  fastify.patch(
    "/admin/driver-applications/:id/approve",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const adminUser = (request as any).user;

      const application = await fastify.prisma.driverApplication.findUnique({
        where: { id },
      });
      if (!application)
        return reply.status(404).send({ error: "Application not found" });
      if (application.status === "APPROVED")
        return reply
          .status(409)
          .send({ error: "Application already approved" });
      if (application.deletedAt)
        return reply
          .status(409)
          .send({ error: "Cannot approve an archived application" });

      const existingUser = await fastify.prisma.user.findUnique({
        where: { phone: application.phone },
        include: { driver: true },
      });
      if (existingUser?.driver) {
        return reply.status(409).send({
          error: "A driver account already exists for this phone number.",
        });
      }

      const vehicleCount = await fastify.prisma.driver.count();
      if (vehicleCount >= 20) {
        return reply.status(409).send({
          error: `TfL vehicle cap reached (${vehicleCount}/20). Remove an existing driver before approving.`,
        });
      }

      const v5cUrls = application.docV5c as string[];
      const insuranceUrls = application.docInsurance as string[];

      await fastify.prisma.$transaction(async (tx) => {
        let userId: string;

        if (existingUser) {
          const [firstName, ...rest] = application.name.split(" ");
          await tx.user.update({
            where: { id: existingUser.id },
            data: {
              roles: existingUser.roles.includes("DRIVER")
                ? existingUser.roles
                : { push: "DRIVER" },
              firstName: firstName ?? existingUser.firstName,
              lastName: rest.join(" ") || existingUser.lastName,
            },
          });
          userId = existingUser.id;
        } else {
          const newUser = await tx.user.create({
            data: {
              phone: application.phone,
              firstName: application.name.split(" ")[0] ?? application.name,
              lastName: application.name.split(" ").slice(1).join(" ") || "",
              roles: ["DRIVER"],
              isVerified: true,
            },
          });
          userId = newUser.id;
        }

        const driver = await tx.driver.create({
          data: {
            userId,
            pcoBadgeNumber: application.pcoBadgeNumber,
            pcoLicenseExpiry: application.pcoBadgeExpiry,
            drivingLicenseNumber: application.drivingLicenceNumber,
            status: "OFFLINE",
          },
        });

        await tx.vehicle.create({
          data: {
            driverId: driver.id,
            make: application.vehicleMake,
            model: application.vehicleModel,
            licensePlate: application.vehicleReg,
            year: application.vehicleYear,
            colour: application.vehicleColour,
            class: (application.vehicleClass as any) ?? "STANDARD",
            seats: application.vehicleSeats ?? 4,
            motExpiry: application.docMotExpiry ?? new Date("2099-01-01"),
            insuranceExpiry:
              application.docInsuranceExpiry ?? new Date("2099-01-01"),
            phvLicenceNumber: application.vehiclePhvLicenceNumber ?? null,
            phvLicenceExpiry: application.vehiclePhvLicenceExpiry ?? null,
            phvDiscNumber: application.vehiclePhvDiscNumber ?? null,
            emissionStandard: application.vehicleEmissionStandard ?? null,
            isUlezCompliant: application.vehicleIsUlezCompliant ?? false,
          },
        });

        type DocEntry = {
          url: string | null;
          type: string;
          expiryDate: Date | null;
        };
        const singleDocs: DocEntry[] = [
          {
            url: application.docPcoBadge,
            type: "PCO_LICENSE",
            expiryDate: application.pcoBadgeExpiry ?? null,
          },
          {
            url: application.docDrivingLicFront,
            type: "DRIVING_LICENSE",
            expiryDate: null,
          },
          {
            url: application.docDrivingLicBack,
            type: "DRIVING_LICENSE_BACK",
            expiryDate: null,
          },
          {
            url: application.docPhvLicence,
            type: "PHV_LICENCE",
            expiryDate: application.docPhvExpiry ?? null,
          },
          {
            url: application.docMot,
            type: "MOT_CERTIFICATE",
            expiryDate: application.docMotExpiry ?? null,
          },
          {
            url: application.docDbs,
            type: "DBS_CHECK",
            expiryDate: application.docDbsExpiry ?? null,
          },
        ];

        for (const { url, type, expiryDate } of singleDocs) {
          if (url) {
            await tx.driverDocument.create({
              data: {
                driverId: driver.id,
                type: type as any,
                fileUrl: url,
                status: "PENDING",
                expiryDate,
              },
            });
          }
        }

        for (const url of insuranceUrls) {
          await tx.driverDocument.create({
            data: {
              driverId: driver.id,
              type: "VEHICLE_INSURANCE" as any,
              fileUrl: url,
              status: "PENDING",
              expiryDate: application.docInsuranceExpiry ?? null,
            },
          });
        }

        for (const url of v5cUrls) {
          await tx.driverDocument.create({
            data: {
              driverId: driver.id,
              type: "V5C_LOGBOOK" as any,
              fileUrl: url,
              status: "PENDING",
              expiryDate: null,
            },
          });
        }

        await tx.driverApplication.update({
          where: { id },
          data: {
            status: "APPROVED",
            reviewedBy: adminUser.userId,
            reviewedAt: new Date(),
          },
        });
      });

      await sendSms(
        fastify,
        application.phone,
        `Hi ${
          application.name.split(" ")[0]
        }, your OrangeRide driver application has been approved! ` +
          `Open the OrangeRide Driver app and log in with your mobile number to get started. ` +
          `Our team will now review your documents — you'll be notified once dispatch is enabled.`
      );

      return reply
        .status(200)
        .send({ message: "Application approved. Driver account created." });
    }
  );

  // ─── PATCH /api/v1/admin/driver-applications/:id/reject ────────────────────
  fastify.patch(
    "/admin/driver-applications/:id/reject",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { reason } = request.body as { reason?: string };
      const adminUser = (request as any).user;

      if (!reason?.trim())
        return reply
          .status(400)
          .send({ error: "A rejection reason is required" });

      const application = await fastify.prisma.driverApplication.findUnique({
        where: { id },
      });
      if (!application)
        return reply.status(404).send({ error: "Application not found" });
      if (application.status === "APPROVED")
        return reply
          .status(409)
          .send({ error: "Cannot reject an already approved application" });

      await fastify.prisma.driverApplication.update({
        where: { id },
        data: {
          status: "REJECTED",
          rejectionReason: reason.trim(),
          reviewedBy: adminUser.userId,
          reviewedAt: new Date(),
        },
      });

      await sendSms(
        fastify,
        application.phone,
        `Hi ${
          application.name.split(" ")[0]
        }, unfortunately your OrangeRide driver application was not approved. ` +
          `Reason: ${reason.trim()}. ` +
          `Please open the OrangeRide Driver app to review and resubmit your application.`
      );

      return reply.status(200).send({ message: "Application rejected." });
    }
  );

  // ─── DELETE /api/v1/admin/driver-applications/:id — SOFT DELETE (ARCHIVE) ──
  // Archives the application and, if APPROVED, archives the associated driver
  // account so they can no longer log in or receive jobs.
  // No data is permanently removed at this stage.
  fastify.delete(
    "/admin/driver-applications/:id",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const adminUser = (request as any).user;

      const application = await fastify.prisma.driverApplication.findUnique({
        where: { id },
      });
      if (!application)
        return reply.status(404).send({ error: "Application not found" });
      if (application.deletedAt)
        return reply
          .status(409)
          .send({ error: "Application is already archived" });

      const now = new Date();

      await fastify.prisma.$transaction(async (tx) => {
        // Soft-delete the application record
        await tx.driverApplication.update({
          where: { id },
          data: { deletedAt: now, deletedBy: adminUser.userId },
        });

        // If APPROVED, also archive the associated driver account
        if (application.status === "APPROVED") {
          const user = await tx.user.findUnique({
            where: { phone: application.phone },
            include: { driver: true },
          });

          if (user?.driver) {
            // Archive driver, vehicle, and all documents
            await tx.driver.update({
              where: { id: user.driver.id },
              data: {
                archivedAt: now,
                archivedBy: adminUser.userId,
                status: "OFFLINE",
              },
            });
            await tx.vehicle.updateMany({
              where: { driverId: user.driver.id },
              data: { archivedAt: now },
            });
            await tx.driverDocument.updateMany({
              where: { driverId: user.driver.id },
              data: { archivedAt: now },
            });

            // Remove from Redis online set (can't be dispatched)
            try {
              await fastify.redis.srem("drivers:online", user.driver.id);
            } catch {
              // Non-blocking
            }
          }
        }
      });

      return reply
        .status(200)
        .send({ message: "Application archived successfully." });
    }
  );

  // ─── DELETE /api/v1/admin/driver-applications/:id/permanent — HARD DELETE ──
  // Permanently deletes ALL data for this application and associated driver.
  // Only works on already-archived applications.
  // Requires the driver's name to be confirmed in the request body.
  // Booking history is preserved (driverId nulled out, not deleted).
  fastify.delete(
    "/admin/driver-applications/:id/permanent",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { confirmName } = request.body as { confirmName?: string };

      const application = await fastify.prisma.driverApplication.findUnique({
        where: { id },
      });
      if (!application)
        return reply.status(404).send({ error: "Application not found" });
      if (!application.deletedAt) {
        return reply.status(409).send({
          error:
            "Application must be archived before it can be permanently deleted.",
        });
      }

      // Name confirmation check (case-insensitive trim)
      if (
        !confirmName ||
        confirmName.trim().toLowerCase() !==
          application.name.trim().toLowerCase()
      ) {
        return reply.status(400).send({
          error: `Name confirmation does not match. Expected: "${application.name}"`,
        });
      }

      await fastify.prisma.$transaction(async (tx) => {
        // Find associated user/driver if APPROVED
        const user = await tx.user.findUnique({
          where: { phone: application.phone },
          include: { driver: true },
        });

        if (user?.driver) {
          const driverId = user.driver.id;

          // Null out driverId on bookings (preserve booking history)
          await tx.booking.updateMany({
            where: { driverId },
            data: { driverId: null },
          });

          // Delete dependent records in correct order
          await tx.driverEarning.deleteMany({ where: { driverId } });
          await tx.driverBreak.deleteMany({ where: { driverId } });
          await tx.driverDocument.deleteMany({ where: { driverId } });
          await tx.teslaIntegration.deleteMany({ where: { driverId } });
          await tx.vehicle.deleteMany({ where: { driverId } });
          await tx.driver.delete({ where: { id: driverId } });

          // Handle user: remove DRIVER role or delete if driver-only
          const updatedRoles = user.roles.filter((r) => r !== "DRIVER");
          if (updatedRoles.length === 0) {
            // Driver-only account — delete the user entirely
            await tx.pushToken.deleteMany({ where: { userId: user.id } });
            await tx.refreshToken.deleteMany({ where: { userId: user.id } });
            await tx.otpCode.deleteMany({ where: { userId: user.id } });
            await tx.user.delete({ where: { id: user.id } });
          } else {
            // Multi-role user — just remove the DRIVER role
            await tx.user.update({
              where: { id: user.id },
              data: { roles: updatedRoles },
            });
          }
        }

        // Finally delete the application
        await tx.driverApplication.delete({ where: { id } });
      });

      return reply.status(200).send({
        message: "Application and all associated data permanently deleted.",
      });
    }
  );
}
