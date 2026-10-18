// backend/scripts/test-complaint-rules.ts
//
// Pure tests for the complaints / compliments register rules (no database).
//   node -r ts-node/register scripts/test-complaint-rules.ts
import {
  ComplaintError,
  canDelete,
  checkStatusChange,
  deletableFrom,
  formatRef,
  hoursSince,
  isReplyOverdue,
  legacyFeedback,
  legacyOperatorNotes,
  refNumber,
  resolvedPush,
  safetyAlert,
} from "../src/services/complaintRules";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`);
}
function throws(name: string, fn: () => unknown, msg?: RegExp) {
  try {
    fn();
    check(name, false, "did not throw");
  } catch (e) {
    check(name, e instanceof ComplaintError && (!msg || msg.test((e as Error).message)), (e as Error).message);
  }
}

// ── Refs ──
check("formatRef", formatRef(2026, 4) === "CC-2026-004");
check("refNumber", refNumber("CC-2026-012", 2026) === 12 && refNumber("CC-2025-012", 2026) === null && refNumber("LP-2026-012", 2026) === null);

// ── Status changes ──
check("complaint → investigating", checkStatusChange("COMPLAINT", "INVESTIGATING", null, null) === null);
throws("resolve needs an outcome", () => checkStatusChange("COMPLAINT", "RESOLVED", null, "Sorted"), /outcome/);
throws("resolve needs a resolution", () => checkStatusChange("COMPLAINT", "RESOLVED", "UPHELD", null), /resolution/i);
check("resolve with both", checkStatusChange("COMPLAINT", "RESOLVED", "PARTLY_UPHELD", "Refunded £5") === "PARTLY_UPHELD");
throws("complaint can't be 'closed'", () => checkStatusChange("COMPLAINT", "CLOSED", null, null), /received, investigating or resolved/);
throws("compliment can't be 'resolved'", () => checkStatusChange("COMPLIMENT", "RESOLVED", "UPHELD", "x"), /compliment/);
check("compliment closes with nothing else", checkStatusChange("COMPLIMENT", "CLOSED", null, null) === null);
throws("bad outcome", () => checkStatusChange("COMPLAINT", "RESOLVED", "MAYBE", "x"), /outcome/);
throws("bad type", () => checkStatusChange("RANT", "RECEIVED", null, null), /type/);

// ── 48-hour flag ──
const now = new Date("2026-10-18T12:00:00Z");
const h = (n: number) => new Date(now.getTime() - n * 3_600_000);
check("47 h, no reply → fine", !isReplyOverdue({ type: "COMPLAINT", status: "RECEIVED", receivedAt: h(47), contactCount: 0 }, now));
check("49 h, no reply → overdue", isReplyOverdue({ type: "COMPLAINT", status: "RECEIVED", receivedAt: h(49), contactCount: 0 }, now));
check("49 h with a reply → fine", !isReplyOverdue({ type: "COMPLAINT", status: "INVESTIGATING", receivedAt: h(49), contactCount: 1 }, now));
check("resolved never overdue", !isReplyOverdue({ type: "COMPLAINT", status: "RESOLVED", receivedAt: h(200), contactCount: 0 }, now));
check("compliments never overdue", !isReplyOverdue({ type: "COMPLIMENT", status: "RECEIVED", receivedAt: h(200), contactCount: 0 }, now));
check("hoursSince", hoursSince(h(53), now) === 53);

// ── Retention ──
const done = { status: "RESOLVED", resolvedAt: new Date("2025-10-18T15:00:00Z") };
check("deletable 12 months after resolving", deletableFrom(done)?.toISOString().slice(0, 10) === "2026-10-18" && canDelete(done, now));
check("not before", !canDelete(done, new Date("2026-10-17T12:00:00Z")));
check("open → never", deletableFrom({ status: "INVESTIGATING", resolvedAt: null }) === null);

// ── Messages ──
const p = resolvedPush("CC-2026-001", "We spoke to the driver\nand refunded £5.");
check("push title + ref + one line", p.title === "Your complaint has been resolved" && p.body === "CC-2026-001: We spoke to the driver and refunded £5.", p);
check("push body trimmed to 150", resolvedPush("CC-2026-001", "x".repeat(400)).body.length <= 155);
check("safety alert", /SAFETY complaint CC-2026-002 on booking DSM1 from Ann/.test(safetyAlert({ type: "COMPLAINT", category: "Safety concern", refNo: "CC-2026-002", bookingRef: "DSM1", name: "Ann" }) ?? ""));
check("no alert for other categories / compliments", safetyAlert({ type: "COMPLAINT", category: "Late arrival", refNo: "x" }) === null && safetyAlert({ type: "COMPLIMENT", category: "Safety concern", refNo: "x" }) === null);

// ── Old app format (must match what passenger app ≤ 1.0.12 parses) ──
const appParseComplaint = (feedback: string | null) => {
  if (!feedback || !feedback.startsWith("[COMPLAINT]")) return null;
  const lines = feedback.replace("[COMPLAINT] ", "").split("\n");
  return { category: lines[0]?.replace("Category: ", "") ?? "", description: lines.slice(1).join("\n").trim() };
};
const appParseResolution = (n: string | null) => {
  const m = n?.match(/\[ACK\][^\n]*Note: ([^\n]+)/);
  return m ? m[1].trim() : null;
};
const fb = legacyFeedback({ category: "Late arrival", details: "20 minutes late\nmissed my train" });
check("app reads category + details", JSON.stringify(appParseComplaint(fb)) === JSON.stringify({ category: "Late arrival", description: "20 minutes late\nmissed my train" }), appParseComplaint(fb));
check("no category → Other", appParseComplaint(legacyFeedback({ category: null, details: "x" }))?.category === "Other");
const on = legacyOperatorNotes({ status: "RESOLVED", resolutionNote: "Refunded £5\nSorry!", resolvedAt: now });
check("app reads the resolution (one line)", appParseResolution(on) === "Refunded £5 Sorry!", on);
check("open → no resolution text", legacyOperatorNotes({ status: "INVESTIGATING", resolutionNote: "draft", resolvedAt: null }) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
