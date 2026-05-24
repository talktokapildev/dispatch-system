import { FastifyInstance } from "fastify";
import axios from "axios";

const TESLA_AUTH_URL = "https://auth.tesla.com/oauth2/v3/token";
const TESLA_API = "https://fleet-api.prd.eu.vn.cloud.tesla.com";
const CLIENT_ID = process.env.TESLA_CLIENT_ID!;
const CLIENT_SECRET = process.env.TESLA_CLIENT_SECRET!;
const BACKEND_URL = process.env.BACKEND_URL!;
const REDIRECT_URI = `${BACKEND_URL}/api/v1/tesla/callback`;

async function refreshTeslaToken(
  fastify: FastifyInstance,
  integration: { refreshToken: string; driverId: string }
) {
  const res = await axios.post(TESLA_AUTH_URL, {
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: integration.refreshToken,
  });
  const { access_token, refresh_token, expires_in } = res.data;
  return fastify.prisma.teslaIntegration.update({
    where: { driverId: integration.driverId },
    data: {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: new Date(Date.now() + expires_in * 1000),
    },
  });
}

async function getValidToken(fastify: FastifyInstance, driverId: string) {
  const integration = await fastify.prisma.teslaIntegration.findUnique({
    where: { driverId },
  });
  if (!integration) throw new Error("No Tesla integration");
  if (!integration.enabled) throw new Error("Tesla integration disabled");
  if (new Date() >= integration.expiresAt) {
    return refreshTeslaToken(fastify, integration);
  }
  return integration;
}

export async function teslaRoutes(fastify: FastifyInstance) {
  // Required by Tesla Fleet API partner authentication
  fastify.get(
    "/.well-known/appspecific/com.tesla.3p.public-key.pem",
    async (request, reply) => {
      const publicKey = process.env.TESLA_PUBLIC_KEY!;
      return reply
        .header("Content-Type", "application/x-pem-file")
        .send(publicKey);
    }
  );
  // Step 1: App requests the auth URL
  fastify.get(
    "/driver/tesla/auth-url",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as any).userId;
      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver) return reply.status(404).send({ error: "Driver not found" });

      const scopes = "openid offline_access vehicle_device_data vehicle_cmds";
      const url =
        `https://auth.tesla.com/oauth2/v3/authorize` +
        `?client_id=${CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&state=${driver.id}`;

      return reply.send({ url });
    }
  );

  // Step 2: Tesla redirects here after driver logs in
  fastify.get("/tesla/callback", async (request, reply) => {
    const {
      code,
      state: driverId,
      error,
    } = request.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (error || !code || !driverId) {
      return reply.redirect(
        `orangeride://tesla-callback?error=${error ?? "missing_params"}`
      );
    }

    try {
      const tokenRes = await axios.post(TESLA_AUTH_URL, {
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
      });

      const { access_token, refresh_token, expires_in } = tokenRes.data;

      // Fetch vehicles — non-fatal if it fails
      let vehicles: any[] = [];
      try {
        const vehiclesRes = await axios.get(`${TESLA_API}/api/1/vehicles`, {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        vehicles = vehiclesRes.data.response ?? [];
      } catch (vehicleErr) {
        fastify.log.warn(
          { err: vehicleErr },
          "Tesla vehicles fetch failed — proceeding without vehicle data"
        );
      }

      await fastify.prisma.teslaIntegration.upsert({
        where: { driverId },
        create: {
          driverId,
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt: new Date(Date.now() + expires_in * 1000),
          vehicleId: vehicles[0]?.id_s ?? "",
          vehicleName: vehicles[0]?.display_name ?? null,
          enabled: true,
        },
        update: {
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt: new Date(Date.now() + expires_in * 1000),
          vehicleId: vehicles[0]?.id_s ?? "",
          vehicleName: vehicles[0]?.display_name ?? null,
          enabled: true,
        },
      });

      return reply.redirect(`orangeride://tesla-callback?success=true`);
    } catch (err: any) {
      fastify.log.error({ err }, "Tesla callback token exchange failed");
      return reply.redirect(
        `orangeride://tesla-callback?error=token_exchange_failed`
      );
    }
  });

  // Get integration status
  fastify.get(
    "/driver/tesla/status",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as any).userId;
      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver) return reply.status(404).send({ error: "Driver not found" });

      const integration = await fastify.prisma.teslaIntegration.findUnique({
        where: { driverId: driver.id },
        select: { enabled: true, vehicleId: true, vehicleName: true },
      });

      return reply.send({ connected: !!integration, integration });
    }
  );

  // Update settings (toggle, change vehicle)
  fastify.patch(
    "/driver/tesla/settings",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as any).userId;
      const { enabled, vehicleId, vehicleName } = request.body as {
        enabled?: boolean;
        vehicleId?: string;
        vehicleName?: string;
      };
      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver) return reply.status(404).send({ error: "Driver not found" });

      const updated = await fastify.prisma.teslaIntegration.update({
        where: { driverId: driver.id },
        data: {
          ...(enabled !== undefined && { enabled }),
          ...(vehicleId && { vehicleId }),
          ...(vehicleName !== undefined && { vehicleName }),
        },
      });
      return reply.send({ integration: updated });
    }
  );

  // List vehicles
  fastify.get(
    "/driver/tesla/vehicles",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as any).userId;
      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver) return reply.status(404).send({ error: "Driver not found" });

      try {
        const integration = await getValidToken(fastify, driver.id);
        const res = await axios.get(`${TESLA_API}/api/1/vehicles`, {
          headers: { Authorization: `Bearer ${integration.accessToken}` },
        });
        return reply.send({ vehicles: res.data.response ?? [] });
      } catch (err: any) {
        fastify.log.error({ err }, "Failed to list Tesla vehicles");
        return reply.status(400).send({ error: "Failed to fetch vehicles" });
      }
    }
  );

  // Send navigation
  fastify.post(
    "/driver/tesla/navigate",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as any).userId;
      const { lat, lon } = request.body as { lat: number; lon: number };
      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver) return reply.status(404).send({ error: "Driver not found" });

      try {
        const integration = await getValidToken(fastify, driver.id);
        await sendTeslaNavigation(
          integration.accessToken,
          integration.vehicleId,
          lat,
          lon
        );
        return reply.send({ success: true });
      } catch (err: any) {
        fastify.log.error({ err }, "Tesla navigate failed");
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  // Disconnect
  fastify.delete(
    "/driver/tesla/disconnect",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as any).userId;
      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver) return reply.status(404).send({ error: "Driver not found" });

      await fastify.prisma.teslaIntegration.deleteMany({
        where: { driverId: driver.id },
      });
      return reply.send({ success: true });
    }
  );
}

export async function sendTeslaNavigation(
  accessToken: string,
  vehicleId: string,
  lat: number,
  lon: number
) {
  try {
    await axios.post(
      `${TESLA_API}/api/1/vehicles/${vehicleId}/wake_up`,
      {},
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    await new Promise((r) => setTimeout(r, 3000));
  } catch {
    // already awake or unreachable — proceed anyway
  }

  await axios.post(
    `${TESLA_API}/api/1/vehicles/${vehicleId}/command/navigation_gps_request`,
    { lat, lon, order: 1 },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}
