// backend/src/routes/admin/driver-applications.ts
// Admin-only routes — protected by fastify.authenticateAdmin.
// GET   /api/v1/admin/driver-applications           — list all (filter by status)
// GET   /api/v1/admin/driver-applications/:id       — single application detail
// PATCH /api/v1/admin/driver-applications/:id/approve — approve + create User/Driver/Vehicle/Documents
// PATCH /api/v1/admin/driver-applications/:id/reject  — reject with reason + SMS

import { FastifyInstance } from "fastify";

// Helper: send SMS via Twilio (non-blocking — failure is logged but never throws)
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
      const where = status
        ? { status: status as "PENDING" | "APPROVED" | "REJECTED" }
        : {};

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

      const counts = await fastify.prisma.driverApplication.groupBy({
        by: ["status"],
        _count: { id: true },
      });
      const summary = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
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
      if (!application) {
        return reply.status(404).send({ error: "Application not found" });
      }

      return reply.status(200).send({ application });
    }
  );

  // ─── PATCH /api/v1/admin/driver-applications/:id/approve ───────────────────
  // Approve application:
  // - Creates User + Driver + Vehicle
  // - Migrates all application documents → DriverDocument (status: PENDING, admin still reviews)
  // - Expiry dates from application are pre-populated on DriverDocument and Vehicle
  // - Sends approval SMS to driver
  fastify.patch(
    "/admin/driver-applications/:id/approve",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const adminUser = (request as any).user;

      const application = await fastify.prisma.driverApplication.findUnique({
        where: { id },
      });
      if (!application) {
        return reply.status(404).send({ error: "Application not found" });
      }
      if (application.status === "APPROVED") {
        return reply
          .status(409)
          .send({ error: "Application already approved" });
      }

      // Check for existing user/driver
      const existingUser = await fastify.prisma.user.findUnique({
        where: { phone: application.phone },
        include: { driver: true },
      });
      if (existingUser?.driver) {
        return reply.status(409).send({
          error: "A driver account already exists for this phone number.",
        });
      }

      // TfL Condition 11: 20-vehicle cap
      const vehicleCount = await fastify.prisma.driver.count();
      if (vehicleCount >= 20) {
        return reply.status(409).send({
          error: `TfL vehicle cap reached (${vehicleCount}/20). Remove an existing driver before approving.`,
        });
      }

      // Cast typed arrays from Prisma
      const v5cUrls = application.docV5c as string[];
      const insuranceUrls = application.docInsurance as string[];

      await fastify.prisma.$transaction(async (tx) => {
        // ── Create or update User ──────────────────────────────────────────
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

        // ── Create Driver ──────────────────────────────────────────────────
        const driver = await tx.driver.create({
          data: {
            userId,
            pcoBadgeNumber: application.pcoBadgeNumber,
            pcoLicenseExpiry: application.pcoBadgeExpiry,
            drivingLicenseNumber: application.drivingLicenceNumber,
            status: "OFFLINE",
          },
        });

        // ── Create Vehicle — use expiry dates from application ─────────────
        await tx.vehicle.create({
          data: {
            driverId: driver.id,
            make: application.vehicleMake,
            model: application.vehicleModel,
            licensePlate: application.vehicleReg,
            year: application.vehicleYear,
            colour: application.vehicleColour,
            // Use driver-supplied expiry dates if available; fallback to placeholder
            // Admin should verify these when reviewing the DriverDocument records.
            motExpiry: application.docMotExpiry ?? new Date("2099-01-01"),
            insuranceExpiry:
              application.docInsuranceExpiry ?? new Date("2099-01-01"),
          },
        });

        // ── Migrate documents → DriverDocument (status: PENDING) ──────────
        // Admin reviews each doc individually in the Documents page.
        // Expiry dates are pre-filled from what the driver entered.
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
                expiryDate: expiryDate ?? null,
              },
            });
          }
        }

        // Insurance — multi-page: create one DriverDocument per page
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

        // V5C — multi-page: create one DriverDocument per page
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

        // ── Mark application approved ──────────────────────────────────────
        await tx.driverApplication.update({
          where: { id },
          data: {
            status: "APPROVED",
            reviewedBy: adminUser.userId,
            reviewedAt: new Date(),
          },
        });
      });

      // ── SMS notification (non-blocking) ───────────────────────────────────
      await sendSms(
        fastify,
        application.phone,
        `Hi ${
          application.name.split(" ")[0]
        }, your OrangeRide driver application has been approved! ` +
          `Open the OrangeRide Driver app and log in with your mobile number to get started. ` +
          `Our team will now review your documents — you'll be notified once dispatch is enabled.`
      );

      return reply.status(200).send({
        message: "Application approved. Driver account created.",
      });
    }
  );

  // ─── PATCH /api/v1/admin/driver-applications/:id/reject ────────────────────
  // Reject with a mandatory reason + SMS to driver.
  // Body: { reason: string }
  fastify.patch(
    "/admin/driver-applications/:id/reject",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { reason } = request.body as { reason?: string };
      const adminUser = (request as any).user;

      if (!reason || reason.trim() === "") {
        return reply
          .status(400)
          .send({ error: "A rejection reason is required" });
      }

      const application = await fastify.prisma.driverApplication.findUnique({
        where: { id },
      });
      if (!application) {
        return reply.status(404).send({ error: "Application not found" });
      }
      if (application.status === "APPROVED") {
        return reply
          .status(409)
          .send({ error: "Cannot reject an already approved application" });
      }

      await fastify.prisma.driverApplication.update({
        where: { id },
        data: {
          status: "REJECTED",
          rejectionReason: reason.trim(),
          reviewedBy: adminUser.userId,
          reviewedAt: new Date(),
        },
      });

      // ── SMS notification (non-blocking) ───────────────────────────────────
      await sendSms(
        fastify,
        application.phone,
        `Hi ${
          application.name.split(" ")[0]
        }, unfortunately your OrangeRide driver application was not approved. ` +
          `Reason: ${reason.trim()}. ` +
          `Please open the OrangeRide Driver app to review the reason and resubmit your application.`
      );

      return reply.status(200).send({ message: "Application rejected." });
    }
  );
}
