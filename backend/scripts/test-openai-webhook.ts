// The Araa webhook route: signature check, not-configured, and the scoped raw-body parser.
// DATABASE_URL=postgres://x JWT_SECRET=x SMS_DRY_RUN=true TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register scripts/test-openai-webhook.ts
import crypto from "node:crypto";
import Fastify from "fastify";
import { openaiWebhookRoutes, OPENAI_REALTIME_WEBHOOK_PATH } from "../src/routes/openaiWebhooks";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${n}`, ok ? "" : JSON.stringify(d ?? "")); };

const secret = "whsec_" + crypto.randomBytes(24).toString("base64");
function signed(body: string, sec = secret) {
  const id = "msg_1", ts = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(sec.replace(/^whsec_/, ""), "base64");
  const sig = crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` };
}

async function main() {
  const app = Fastify();
  app.decorate("prisma", {} as any); app.decorate("redis", {} as any); app.decorate("io", {} as any);
  app.register(openaiWebhookRoutes);
  // Another route registered alongside: must still get parsed JSON.
  app.register(async (f) => { f.post("/api/v1/echo", async (req) => ({ type: typeof req.body, body: req.body })); });
  await app.ready();

  const body = JSON.stringify({ id: "evt_1", object: "event", created_at: Math.floor(Date.now() / 1000), type: "batch.completed", data: { id: "b" } });
  delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_WEBHOOK_SECRET;
  let r = await app.inject({ method: "POST", url: OPENAI_REALTIME_WEBHOOK_PATH, headers: signed(body), payload: body });
  check("not configured → 503", r.statusCode === 503, r.statusCode);

  process.env.OPENAI_API_KEY = "sk-test"; process.env.OPENAI_WEBHOOK_SECRET = secret;
  r = await app.inject({ method: "POST", url: OPENAI_REALTIME_WEBHOOK_PATH, headers: signed(body), payload: body });
  check("valid signature → 200", r.statusCode === 200, r.statusCode);
  r = await app.inject({ method: "POST", url: OPENAI_REALTIME_WEBHOOK_PATH, headers: signed(body, "whsec_" + crypto.randomBytes(24).toString("base64")), payload: body });
  check("forged signature → 400", r.statusCode === 400, r.statusCode);
  r = await app.inject({ method: "POST", url: OPENAI_REALTIME_WEBHOOK_PATH, headers: signed(body), payload: body.replace("batch", "botch") });
  check("tampered body → 400", r.statusCode === 400, r.statusCode);
  r = await app.inject({ method: "POST", url: OPENAI_REALTIME_WEBHOOK_PATH, headers: { "content-type": "application/json" }, payload: body });
  check("no signature → 400", r.statusCode === 400, r.statusCode);
  r = await app.inject({ method: "POST", url: "/api/v1/echo", headers: { "content-type": "application/json" }, payload: { a: 1 } });
  check("other routes still get parsed JSON", r.json().type === "object" && r.json().body.a === 1, r.json());

  await app.close();
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}
main();
