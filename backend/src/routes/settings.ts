// backend/src/routes/settings.ts
//
// GET  /api/v1/settings          — public, returns operator-facing settings
// PUT  /api/v1/admin/settings    — admin only, upserts key-value pairs
//
// Uses a key-value SystemSetting table so new settings can be added
// without schema migrations.

import { FastifyInstance } from "fastify";

// Keys that are safe to expose publicly (readable by passenger app, etc.)
const PUBLIC_KEYS = [
  "companyName",
  "licenceNumber",
  "contactPhone",
  "contactEmail",
  "businessAddress",
] as const;

export async function settingsRoutes(fastify: FastifyInstance) {
  // ── GET /api/v1/settings ──────────────────────────────────────────────────
  // Public endpoint — no auth required.
  // Returns a map of the safe public keys and their current values.
  // Falls back to hardcoded defaults if a key hasn't been seeded yet.
  fastify.get("/settings", async (_request, reply) => {
    const rows = await fastify.prisma.systemSetting.findMany({
      where: { key: { in: [...PUBLIC_KEYS] } },
    });

    // Build map from DB rows
    const map: Record<string, string> = {};
    rows.forEach((r) => {
      map[r.key] = r.value;
    });

    // Apply defaults for any keys not yet in the DB
    const defaults: Record<string, string> = {
      companyName: "OrangeRide",
      licenceNumber: "II786",
      contactPhone: "+447398341839",
      contactEmail: "admin@orangeride.co.uk",
      businessAddress: "Regus, One Elmfield Park, Bromley, BR1 1LU",
    };
    for (const key of PUBLIC_KEYS) {
      if (!map[key]) map[key] = defaults[key] ?? "";
    }

    return reply.send({ success: true, data: map });
  });

  // ── PUT /api/v1/admin/settings ────────────────────────────────────────────
  // Admin only. Accepts a flat object of { key: value } pairs and upserts each.
  // Unknown keys are accepted — allows future settings without code changes.
  fastify.put(
    "/admin/settings",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const body = request.body as Record<string, string>;

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return reply
          .status(400)
          .send({ error: "Body must be a flat key-value object" });
      }

      const entries = Object.entries(body).filter(
        ([, v]) => typeof v === "string"
      );

      if (entries.length === 0) {
        return reply
          .status(400)
          .send({ error: "No valid string values provided" });
      }

      // Upsert all in parallel
      await Promise.all(
        entries.map(([key, value]) =>
          fastify.prisma.systemSetting.upsert({
            where: { key },
            update: { value },
            create: { key, value },
          })
        )
      );

      return reply.send({ success: true, message: "Settings saved" });
    }
  );
}
