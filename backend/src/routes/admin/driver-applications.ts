// backend/src/routes/admin/driver-applications.ts
// Admin-only routes — protected by fastify.authenticateAdmin.
// GET   /api/v1/admin/driver-applications           — list all (filter by status)
// GET   /api/v1/admin/driver-applications/:id       — single application detail
// PATCH /api/v1/admin/driver-applications/:id/approve — approve + create User/Driver/Vehicle
// PATCH /api/v1/admin/driver-applications/:id/reject  — reject with reason

import { FastifyInstance } from "fastify";

export async function adminDriverApplicationRoutes(fastify: FastifyInstance) {
  // ─── GET /api/v1/admin/driver-applications ─────────────────────────────────
  // List all applications. Optional query: ?status=PENDING|APPROVED|REJECTED
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
          app.docInsurance,
          app.docMot,
          app.docDbs,
          app.docV5c,
        ].filter(Boolean).length,
        documentsTotal: 8,
      }));

      // Counts per status — used for sidebar badge
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
  // Full detail including all document URLs for preview
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
  // Approve application.
  // Multi-role aware:
  //   - If phone has no User at all     → create User with roles: ['DRIVER']
  //   - If phone is existing passenger  → add 'DRIVER' to their roles array
  //   - If phone already has a Driver   → reject (already approved)
  // Always creates Driver + Vehicle records.
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

      // Check for existing user with this phone
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
          error: `TfL vehicle cap reached (${vehicleCount}/20). Remove an existing driver before approving this application.`,
        });
      }

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
          // Brand new user
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

        // Create Driver record
        const driver = await tx.driver.create({
          data: {
            userId,
            pcoBadgeNumber: application.pcoBadgeNumber,
            pcoLicenseExpiry: application.pcoBadgeExpiry,
            drivingLicenseNumber: application.drivingLicenceNumber,
            status: "OFFLINE",
          },
        });

        // Create Vehicle record (reg + make/model/year/colour from application)
        await tx.vehicle.create({
          data: {
            driverId: driver.id,
            make: application.vehicleMake,
            model: application.vehicleModel,
            licensePlate: application.vehicleReg,
            year: application.vehicleYear,
            colour: application.vehicleColour,
            // motExpiry and insuranceExpiry are required fields on Vehicle.
            // Set a placeholder — admin should update these via the driver profile.
            motExpiry: new Date("2099-01-01"),
            insuranceExpiry: new Date("2099-01-01"),
          },
        });

        // ── Migrate application documents → DriverDocument records ──────────
        const docMappings = [
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
            expiryDate: null,
          },
          {
            url: application.docInsurance,
            type: "VEHICLE_INSURANCE",
            expiryDate: null,
          },
          {
            url: application.docMot,
            type: "MOT_CERTIFICATE",
            expiryDate: null,
          },
          { url: application.docDbs, type: "DBS_CHECK", expiryDate: null },
          { url: application.docV5c, type: "V5C_LOGBOOK", expiryDate: null },
        ];
        for (const { url, type, expiryDate } of docMappings) {
          if (url) {
            await tx.driverDocument.create({
              data: {
                driverId: driver.id,
                type: type as any, // cast: type comes from our mapping, not from Prisma enum directly
                fileUrl: url,
                status: "PENDING",
                expiryDate: expiryDate ? new Date(expiryDate) : null,
              },
            });
          }
        }

        // Mark application approved
        await tx.driverApplication.update({
          where: { id },
          data: {
            status: "APPROVED",
            reviewedBy: adminUser.userId,
            reviewedAt: new Date(),
          },
        });
      });

      return reply.status(200).send({
        message: "Application approved. Driver account created.",
      });
    }
  );

  // ─── PATCH /api/v1/admin/driver-applications/:id/reject ────────────────────
  // Reject with a mandatory reason.
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

      return reply.status(200).send({ message: "Application rejected." });
    }
  );
}
