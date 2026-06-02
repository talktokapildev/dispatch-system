// backend/src/routes/driver-applications.ts
// Public routes — no auth required.
// POST   /api/v1/driver-applications                          — submit / re-submit application
// POST   /api/v1/driver-applications/:id/documents            — upload a document image (single or multi-page)
// PATCH  /api/v1/driver-applications/:id/documents/:docType/expiry — set expiry date for a document
// GET    /api/v1/driver-applications/:id                      — check own application status

import { FastifyInstance } from "fastify";
import {
  uploadToCloudinary,
  CloudinaryFolder,
} from "../services/cloudinary.service";

const DOC_FOLDER_MAP: Record<string, CloudinaryFolder> = {
  docPcoBadge: "driver-applications/pco-badge",
  docDrivingLicFront: "driver-applications/driving-licence-front",
  docDrivingLicBack: "driver-applications/driving-licence-back",
  docPhvLicence: "driver-applications/phv-licence",
  docInsurance: "driver-applications/insurance",
  docMot: "driver-applications/mot",
  docDbs: "driver-applications/dbs-check",
  docV5c: "driver-applications/v5c-logbook",
};

// Docs that store multiple pages (String[] in Prisma)
const MULTI_PAGE_DOCS = new Set(["docInsurance", "docV5c"]);

// Docs that have an expiry date field on DriverApplication
const EXPIRY_FIELD_MAP: Record<string, string> = {
  docPhvLicence: "docPhvExpiry",
  docInsurance: "docInsuranceExpiry",
  docMot: "docMotExpiry",
  docDbs: "docDbsExpiry",
};

export async function driverApplicationRoutes(fastify: FastifyInstance) {
  // ─── POST /api/v1/driver-applications ──────────────────────────────────────
  // Submit a new application or re-submit a rejected one.
  fastify.post("/driver-applications", async (request, reply) => {
    const {
      name,
      phone,
      email,
      dateOfBirth,
      pcoBadgeNumber,
      pcoBadgeExpiry,
      drivingLicenceNumber,
      vehicleMake,
      vehicleModel,
      vehicleReg,
      vehicleYear,
      vehicleColour,
    } = request.body as any;

    const required = {
      name,
      phone,
      pcoBadgeNumber,
      pcoBadgeExpiry,
      drivingLicenceNumber,
      vehicleMake,
      vehicleModel,
      vehicleReg,
      vehicleYear,
      vehicleColour,
    };
    const missing = Object.entries(required)
      .filter(([, v]) => v === undefined || v === null || v === "")
      .map(([k]) => k);

    if (missing.length > 0) {
      return reply
        .status(400)
        .send({ error: `Missing required fields: ${missing.join(", ")}` });
    }

    // Check for existing application for this phone
    const existing = await fastify.prisma.driverApplication.findFirst({
      where: { phone },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      if (existing.status === "PENDING") {
        return reply.status(200).send({
          message: "Application already pending",
          applicationId: existing.id,
          status: existing.status,
        });
      }

      if (existing.status === "APPROVED") {
        return reply.status(409).send({
          error:
            "An approved driver account already exists for this phone number.",
        });
      }

      // REJECTED — update in place (same ID so AsyncStorage still works)
      const updated = await fastify.prisma.driverApplication.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          rejectionReason: null,
          reviewedBy: null,
          reviewedAt: null,
          name,
          email: email ?? existing.email,
          dateOfBirth: dateOfBirth
            ? new Date(dateOfBirth)
            : existing.dateOfBirth,
          pcoBadgeNumber,
          pcoBadgeExpiry: new Date(pcoBadgeExpiry),
          drivingLicenceNumber,
          vehicleMake,
          vehicleModel,
          vehicleReg: vehicleReg.toUpperCase().replace(/\s/g, ""),
          vehicleYear: parseInt(vehicleYear),
          vehicleColour,
        },
      });

      return reply.status(200).send({
        message: "Application resubmitted",
        applicationId: updated.id,
        status: updated.status,
      });
    }

    // Fresh application
    const application = await fastify.prisma.driverApplication.create({
      data: {
        name,
        phone,
        email: email ?? null,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        pcoBadgeNumber,
        pcoBadgeExpiry: new Date(pcoBadgeExpiry),
        drivingLicenceNumber,
        vehicleMake,
        vehicleModel,
        vehicleReg: vehicleReg.toUpperCase().replace(/\s/g, ""),
        vehicleYear: parseInt(vehicleYear),
        vehicleColour,
      },
    });

    return reply.status(201).send({
      message: "Application submitted",
      applicationId: application.id,
      status: application.status,
    });
  });

  // ─── POST /api/v1/driver-applications/:id/documents ────────────────────────
  // Upload a single document image.
  // - Single-file docs: stores URL string on the application field.
  // - Multi-page docs (docInsurance, docV5c): appends URL to the array.
  // Body: { docType: string, image: string (base64 data URI) }
  fastify.post("/driver-applications/:id/documents", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { docType, image } = request.body as {
      docType: string;
      image: string;
    };

    if (!docType || !image) {
      return reply
        .status(400)
        .send({ error: "docType and image are required" });
    }

    const folder = DOC_FOLDER_MAP[docType];
    if (!folder) {
      return reply.status(400).send({
        error: `Invalid docType. Must be one of: ${Object.keys(
          DOC_FOLDER_MAP
        ).join(", ")}`,
      });
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
        .send({ error: "Cannot update documents on an approved application" });
    }

    let uploadResult;
    try {
      uploadResult = await uploadToCloudinary(image, folder, id);
    } catch (err: any) {
      fastify.log.error({ err }, "Cloudinary upload failed");
      return reply
        .status(500)
        .send({ error: "Document upload failed. Please try again." });
    }

    // Multi-page: push to array. Single: set string.
    const updateData = MULTI_PAGE_DOCS.has(docType)
      ? { [docType]: { push: uploadResult.url } }
      : { [docType]: uploadResult.url };

    const updated = await fastify.prisma.driverApplication.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
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

    return reply.status(200).send({
      message: "Document uploaded",
      docType,
      url: uploadResult.url,
      documents: updated,
    });
  });

  // ─── PATCH /api/v1/driver-applications/:id/documents/:docType/expiry ───────
  // Set or update the expiry date for a document type.
  // Body: { expiryDate: string (ISO) }
  fastify.patch(
    "/driver-applications/:id/documents/:docType/expiry",
    async (request, reply) => {
      const { id, docType } = request.params as { id: string; docType: string };
      const { expiryDate } = request.body as { expiryDate?: string };

      if (!expiryDate) {
        return reply.status(400).send({ error: "expiryDate is required" });
      }

      const expiryField = EXPIRY_FIELD_MAP[docType];
      if (!expiryField) {
        return reply.status(400).send({
          error: `Expiry not applicable for docType: ${docType}. Valid types: ${Object.keys(
            EXPIRY_FIELD_MAP
          ).join(", ")}`,
        });
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
          .send({ error: "Cannot update an approved application" });
      }

      let parsedDate: Date;
      try {
        parsedDate = new Date(expiryDate);
        if (isNaN(parsedDate.getTime())) throw new Error("Invalid date");
      } catch {
        return reply
          .status(400)
          .send({ error: "Invalid expiryDate format. Use ISO 8601." });
      }

      await fastify.prisma.driverApplication.update({
        where: { id },
        data: { [expiryField]: parsedDate },
      });

      return reply.status(200).send({
        message: "Expiry date saved",
        docType,
        expiryField,
        expiryDate: parsedDate.toISOString(),
      });
    }
  );

  // ─── GET /api/v1/driver-applications/:id ───────────────────────────────────
  // Check own application status. Used by ApplicationPendingScreen polling.
  fastify.get("/driver-applications/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const application = await fastify.prisma.driverApplication.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        rejectionReason: true,
        name: true,
        phone: true,
        email: true,
        pcoBadgeNumber: true,
        pcoBadgeExpiry: true,
        drivingLicenceNumber: true,
        vehicleMake: true,
        vehicleModel: true,
        vehicleReg: true,
        vehicleYear: true,
        vehicleColour: true,
        createdAt: true,
        updatedAt: true,
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

    if (!application) {
      return reply.status(404).send({ error: "Application not found" });
    }

    return reply.status(200).send({
      id: application.id,
      status: application.status,
      rejectionReason: application.rejectionReason ?? null,
      name: application.name,
      phone: application.phone,
      email: application.email ?? null,
      pcoBadgeNumber: application.pcoBadgeNumber,
      pcoBadgeExpiry: application.pcoBadgeExpiry,
      drivingLicenceNumber: application.drivingLicenceNumber,
      vehicleMake: application.vehicleMake,
      vehicleModel: application.vehicleModel,
      vehicleReg: application.vehicleReg,
      vehicleYear: application.vehicleYear,
      vehicleColour: application.vehicleColour,
      documents: {
        docPcoBadge: !!application.docPcoBadge,
        docDrivingLicFront: !!application.docDrivingLicFront,
        docDrivingLicBack: !!application.docDrivingLicBack,
        docPhvLicence: !!application.docPhvLicence,
        docInsurance: (application.docInsurance as string[]).length > 0,
        docMot: !!application.docMot,
        docDbs: !!application.docDbs,
        docV5c: (application.docV5c as string[]).length > 0,
      },
      rawDocuments: {
        docPcoBadge: application.docPcoBadge ?? null,
        docDrivingLicFront: application.docDrivingLicFront ?? null,
        docDrivingLicBack: application.docDrivingLicBack ?? null,
        docPhvLicence: application.docPhvLicence ?? null,
        docInsurance: application.docInsurance as string[],
        docMot: application.docMot ?? null,
        docDbs: application.docDbs ?? null,
        docV5c: application.docV5c as string[],
      },
      submittedAt: application.createdAt,
      updatedAt: application.updatedAt,
    });
  });
}
