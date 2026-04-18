import { FastifyInstance } from "fastify";
import { config } from "../config";

export async function placesRoutes(fastify: FastifyInstance) {
  // ── GET /places/autocomplete ─────────────────────────────────────────────
  fastify.get("/places/autocomplete", async (request, reply) => {
    const { input, sessionToken } = request.query as {
      input: string;
      sessionToken?: string;
    };

    if (!input || input.length < 3) {
      return reply.send({ success: true, data: [] });
    }

    const params = new URLSearchParams({
      input,
      key: config.GOOGLE_MAPS_API_KEY!,
      components: "country:gb",
      language: "en",
      ...(sessionToken && { sessiontoken: sessionToken }),
    });

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`
    );
    const json = (await res.json()) as any;

    const suggestions = (json.predictions ?? []).map((p: any) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting?.main_text ?? p.description,
      secondaryText: p.structured_formatting?.secondary_text ?? "",
    }));

    return reply.send({ success: true, data: suggestions });
  });

  // ── GET /places/details ──────────────────────────────────────────────────
  fastify.get("/places/details", async (request, reply) => {
    const { placeId } = request.query as { placeId: string };

    if (!placeId) {
      return reply
        .status(400)
        .send({ success: false, error: "Missing placeId" });
    }

    const params = new URLSearchParams({
      place_id: placeId,
      fields: "geometry",
      key: config.GOOGLE_MAPS_API_KEY!,
    });

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params}`
    );
    const json = (await res.json()) as any;

    const location = json.result?.geometry?.location;
    if (!location) {
      return reply
        .status(404)
        .send({ success: false, error: "Place not found" });
    }

    return reply.send({
      success: true,
      data: { latitude: location.lat, longitude: location.lng },
    });
  });
}
