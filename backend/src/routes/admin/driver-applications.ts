// backend/src/routes/admin/driver-applications.ts
// Admin-only routes — protected by fastify.authenticateAdmin.
// GET   /api/v1/admin/driver-applications           — list (filter by status, or archived)
// GET   /api/v1/admin/driver-applications/:id       — single detail
// PATCH /api/v1/admin/driver-applications/:id/approve
// PATCH /api/v1/admin/driver-applications/:id/reject
// DELETE /api/v1/admin/driver-applications/:id              — soft delete (archive)
// DELETE /api/v1/admin/driver-applications/:id/permanent    — hard delete (requires name confirmation)

import { FastifyInstance } from "fastify";
import { fileLinker } from "../../services/fileLinks";
import { APP_DOC_MULTI, APP_DOC_SINGLE, linkApplicationDocs } from "../../services/applicationDocs";
import {
  archiveDriver,
  hardDeleteDriver,
  startEngagement,
} from "../../services/driverRegister.service";
import { RegisterError, dayKey, ukToday } from "../../services/driverRegisterRules";
import { deleteStoredFile } from "../../services/fileStorage";
import {
  VehicleError,
  assertUnderCap,
  findPlateClash,
  normalisePlate,
  setDriverVehicle,
} from "../../services/vehicle.service";
import {
  sendSms as sendSmsShared,
  maskPhone,
  normaliseUkPhone,
} from "../../services/sms.service";

// Shared sms.service (recorded + delivery status). Same sender as before
// (our number); best-effort — a failed text never fails approve/reject.
async function sendSms(fastify: FastifyInstance, to: string, body: string) {
  const r = await sendSmsShared(normaliseUkPhone(to), body, {
    purpose: "DRIVER_APPLICATION",
    preferNumber: true,
  });
  if (!r.ok)
    fastify.log.error(
      `Failed to send SMS notification to ${maskPhone(to)}: ${r.error}`
    );
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

      // Documents are private: send short-lived links. suggestedPhotoUrl is no longer produced.
      const files = fileLinker(request, { kind: "admin", id: request.user.userId });
      return reply.status(200).send({
        application: linkApplicationDocs(files, application.id, application),
        suggestedPhotoUrl: null,
      });
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

      // The applicant's car: reuse it if it's already on the fleet and free, else add it.
      // TfL cap applies to cars joining (or rejoining) the fleet.
      const plateClash = await findPlateClash(fastify.prisma, application.vehicleReg);
      const existingVehicle = plateClash
        ? await fastify.prisma.vehicle.findUnique({ where: { id: plateClash.id } })
        : null;
      if (existingVehicle?.driverId) {
        return reply.status(409).send({
          error: `${existingVehicle.licensePlate} is already assigned to another driver. Unassign it on the Vehicles page first.`,
        });
      }
      if (!existingVehicle || existingVehicle.archivedAt) {
        try {
          await assertUnderCap(fastify.prisma);
        } catch (err) {
          if (err instanceof VehicleError)
            return reply.status(err.statusCode).send({ error: err.message });
          throw err;
        }
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
        // TfL register: "Date first available" = the day the application is approved
        await startEngagement(tx, driver.id, ukToday(), (request as any).user?.userId ?? null);

        const vehicleId = existingVehicle
          ? (
              await tx.vehicle.update({
                where: { id: existingVehicle.id },
                data: { archivedAt: null, isActive: true },
              })
            ).id
          : (
              await tx.vehicle.create({
                data: {
                  make: application.vehicleMake,
                  model: application.vehicleModel,
                  licensePlate: normalisePlate(application.vehicleReg),
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
              })
            ).id;
        await setDriverVehicle(tx, driver.id, vehicleId);

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

        // Driver documents belong to the driver; vehicle documents to the car.
        // Multi-page insurance / V5C become one document with extra pages.
        const VEHICLE_DOCS = ["PHV_LICENCE", "MOT_CERTIFICATE", "VEHICLE_INSURANCE", "V5C_LOGBOOK"];
        const owner = (type: string) =>
          VEHICLE_DOCS.includes(type)
            ? { driverId: driver.id, vehicleId }
            : { driverId: driver.id };
        for (const { url, type, expiryDate } of singleDocs) {
          if (url) {
            await tx.driverDocument.create({
              data: {
                ...owner(type),
                type: type as any,
                fileUrl: url,
                status: "PENDING",
                expiryDate,
              },
            });
          }
        }

        if (insuranceUrls.length) {
          await tx.driverDocument.create({
            data: {
              ...owner("VEHICLE_INSURANCE"),
              type: "VEHICLE_INSURANCE" as any,
              fileUrl: insuranceUrls[0],
              pageUrls: insuranceUrls.slice(1),
              status: "PENDING",
              expiryDate: application.docInsuranceExpiry ?? null,
            },
          });
        }

        if (v5cUrls.length) {
          await tx.driverDocument.create({
            data: {
              ...owner("V5C_LOGBOOK"),
              type: "V5C_LOGBOOK" as any,
              fileUrl: v5cUrls[0],
              pageUrls: v5cUrls.slice(1),
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

      // If APPROVED, the driver leaves (TfL register: leaving date today) — same as Archive on
      // the Drivers page: offline, jobs back on the board, car unassigned, signed out.
      if (application.status === "APPROVED") {
        const user = await fastify.prisma.user.findUnique({
          where: { phone: application.phone },
          include: { driver: true },
        });
        if (user?.driver && !user.driver.archivedAt) {
          try {
            await archiveDriver(
              { prisma: fastify.prisma, redis: fastify.redis, io: fastify.io as any, log: fastify.log },
              {
                driverId: user.driver.id,
                leftOn: dayKey(ukToday()),
                reason: "Driver application archived",
                adminUserId: adminUser.userId,
              }
            );
          } catch (err) {
            if (err instanceof RegisterError)
              return reply.status(err.statusCode).send({ error: err.message });
            throw err;
          }
        }
      }

      await fastify.prisma.driverApplication.update({
        where: { id },
        data: { deletedAt: new Date(), deletedBy: adminUser.userId },
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

      const user = await fastify.prisma.user.findUnique({
        where: { phone: application.phone },
        include: { driver: true },
      });

      if (user?.driver) {
        // A driver record: TfL requires it to be kept for 12 months after the driver left.
        // hardDeleteDriver checks that, and deletes their applications and files too.
        try {
          await hardDeleteDriver(
            { prisma: fastify.prisma, redis: fastify.redis, log: fastify.log },
            {
              driverId: user.driver.id,
              confirmName: `${user.firstName} ${user.lastName ?? ""}`.trim(),
            }
          );
        } catch (err) {
          if (err instanceof RegisterError)
            return reply.status(err.statusCode).send({ error: err.message });
          throw err;
        }
      } else {
        // Never became a driver: delete the application and its files.
        const files = [
          ...APP_DOC_SINGLE.map((f) => application[f]).filter((v): v is string => !!v),
          ...APP_DOC_MULTI.flatMap((f) => application[f]),
        ];
        await fastify.prisma.driverApplication.delete({ where: { id } });
        for (const f of files) await deleteStoredFile(f);
      }

      return reply.status(200).send({
        message: "Application and all associated data permanently deleted.",
      });
    }
  );
}
