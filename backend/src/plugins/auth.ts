// backend/src/plugins/auth.ts

import fp from "fastify-plugin";
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fjwt from "@fastify/jwt";
import { config } from "../config";
import { RedisKeys } from "./redis";

export interface JwtPayload {
  userId: string;
  roles: string[]; // ← was: role: string
  phone: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
    authenticateAdmin: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
    authenticateDriver: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  }
}

const authPlugin: FastifyPluginAsync = fp(async (fastify) => {
  await fastify.register(fjwt, {
    secret: config.JWT_SECRET,
    sign: {
      expiresIn: config.JWT_EXPIRES_IN,
    },
  });

  // Any authenticated user
  fastify.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        reply.status(401).send({ success: false, error: "Unauthorised" });
      }
    }
  );

  // Admin or dispatcher only
  fastify.decorate(
    "authenticateAdmin",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
        const { roles } = request.user;
        if (!roles.includes("ADMIN") && !roles.includes("DISPATCHER")) {
          reply.status(403).send({ success: false, error: "Forbidden" });
        }
      } catch {
        reply.status(401).send({ success: false, error: "Unauthorised" });
      }
    }
  );

  // Driver only
  fastify.decorate(
    "authenticateDriver",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
        if (!request.user.roles.includes("DRIVER")) {
          return reply
            .status(403)
            .send({ success: false, error: "Driver access only" });
        }
        // Archived (left) drivers: refuse tokens issued before they left.
        const archived = await fastify.redis
          .exists(RedisKeys.archivedDriver(request.user.userId))
          .catch(() => 0);
        if (archived) {
          return reply.status(403).send({
            success: false,
            error: "This driver account has been suspended. Please contact your operator.",
          });
        }
      } catch {
        reply.status(401).send({ success: false, error: "Unauthorised" });
      }
    }
  );
});

export default authPlugin;
