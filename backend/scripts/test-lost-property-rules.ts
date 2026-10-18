// backend/scripts/test-lost-property-rules.ts
//
// Pure tests for the lost property register rules (no database).
//   node -r ts-node/register scripts/test-lost-property-rules.ts
import {
  LostPropertyError,
  bookingDateTime,
  canDelete,
  checkStatusChange,
  cleanText,
  daysOpen,
  deletableFrom,
  formatRef,
  isOverdue,
  normaliseReg,
  parseUkDateTime,
  pushFor,
  refNumber,
  ukDateTimeLabel,
  ukInputValue,
  ukYear,
} from "../src/services/lostPropertyRules";

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
    check(name, e instanceof LostPropertyError && (!msg || msg.test((e as Error).message)), (e as Error).message);
  }
}
const iso = (d: Date | null) => (d ? d.toISOString() : null);

// ── Refs ──
check("formatRef pads to 3", formatRef(2026, 7) === "LP-2026-007");
check("formatRef past 999", formatRef(2026, 1000) === "LP-2026-1000");
check("refNumber reads its year", refNumber("LP-2026-042", 2026) === 42);
check("refNumber 4 digits", refNumber("LP-2026-1000", 2026) === 1000);
check("refNumber other year → null", refNumber("LP-2025-042", 2026) === null);
check("refNumber junk → null", refNumber("LP-2026-4x", 2026) === null);
check("ukYear: 31 Dec 23:30 UTC (winter) is still that year", ukYear(new Date("2025-12-31T23:30:00Z")) === 2025);
check("ukYear: 1 Jan 00:10 UTC is the new year", ukYear(new Date("2026-01-01T00:10:00Z")) === 2026);

// ── UK date/time input ──
check("summer 11:42 UK = 10:42 UTC", iso(parseUkDateTime("2026-08-25T11:42")) === "2026-08-25T10:42:00.000Z", iso(parseUkDateTime("2026-08-25T11:42")));
check("winter 09:00 UK = 09:00 UTC", iso(parseUkDateTime("2026-12-01T09:00")) === "2026-12-01T09:00:00.000Z");
check("date only = 12:00 UK", iso(parseUkDateTime("2026-08-25")) === "2026-08-25T11:00:00.000Z");
check("ISO with Z kept", iso(parseUkDateTime("2026-08-25T10:42:00.000Z")) === "2026-08-25T10:42:00.000Z");
check("30 Feb → null", parseUkDateTime("2026-02-30T10:00") === null);
check("25:00 → null", parseUkDateTime("2026-02-10T25:00") === null);
check("empty → null", parseUkDateTime("  ") === null);
check("number → null", parseUkDateTime(5) === null);
check("clock change (29 Mar 01:30) still parses", parseUkDateTime("2026-03-29T01:30") !== null);
check("input value round trip (summer)", ukInputValue(parseUkDateTime("2026-08-25T11:42")) === "2026-08-25T11:42");
check("input value round trip (winter)", ukInputValue(parseUkDateTime("2026-12-01T09:05")) === "2026-12-01T09:05");
check("label in UK time", ukDateTimeLabel(new Date("2026-08-25T10:42:00Z")) === "25 Aug 2026, 11:42", ukDateTimeLabel(new Date("2026-08-25T10:42:00Z")));

// ── Booking date/time ──
const t = (s: string) => new Date(s);
check("booking time: scheduled first", bookingDateTime({ scheduledAt: t("2026-01-02T10:00Z"), completedAt: t("2026-01-02T11:00Z") })?.toISOString() === "2026-01-02T10:00:00.000Z");
check("booking time: trip start before completed", bookingDateTime({ tripStartedAt: t("2026-01-02T10:30Z"), completedAt: t("2026-01-02T11:00Z") })?.toISOString() === "2026-01-02T10:30:00.000Z");
check("booking time: falls back to created", bookingDateTime({ createdAt: t("2026-01-01T09:00Z") })?.toISOString() === "2026-01-01T09:00:00.000Z");
check("booking time: nothing → null", bookingDateTime({}) === null);

// ── 28-day flag ──
const now = new Date("2026-10-18T12:00:00Z");
const ago = (n: number) => new Date(now.getTime() - n * 86_400_000);
check("27 days open → not flagged", !isOverdue({ status: "FOUND", reportedAt: ago(27) }, now));
check("28 days open → flagged", isOverdue({ status: "FOUND", reportedAt: ago(28) }, now));
check("closed never flagged", !isOverdue({ status: "CLOSED", reportedAt: ago(90) }, now));
check("counts from received, not reported", daysOpen({ status: "FOUND", reportedAt: ago(40), receivedAt: ago(3) }, now) === 3);

// ── Retention ──
const closed = { status: "CLOSED", resolvedAt: new Date("2025-10-18T15:00:00Z") };
check("deletable from 12 months after closing", deletableFrom(closed)?.toISOString().slice(0, 10) === "2026-10-18");
check("can delete on that day", canDelete(closed, now));
check("not the day before", !canDelete(closed, new Date("2026-10-17T22:00:00Z")));
check("open item → never deletable", deletableFrom({ status: "FOUND", resolvedAt: null }) === null && !canDelete({ status: "FOUND" }, now));

// ── Status changes ──
check("open status → no result", checkStatusChange("FOUND", "DISPOSED") === null);
throws("closing needs a result", () => checkStatusChange("CLOSED", null), /result/i);
throws("unknown status", () => checkStatusChange("LOST", null), /Unknown/);
throws("Returned + disposed → use Closed", () => checkStatusChange("RETURNED", "DISPOSED"), /Closed/);
check("Returned + collected", checkStatusChange("RETURNED", "COLLECTED_BY_OWNER") === "COLLECTED_BY_OWNER");
check("Closed + police", checkStatusChange("CLOSED", "HANDED_TO_POLICE") === "HANDED_TO_POLICE");
throws("bad result value", () => checkStatusChange("CLOSED", "BURNT"), /result/i);

// ── Pushes ──
check("push when found", pushFor("REPORTED", "FOUND", "LP-2026-001")?.title === "We've found your item");
check("push body has ref", /LP-2026-001/.test(pushFor(null, "FOUND", "LP-2026-001")?.body ?? ""));
check("push when returned", pushFor("FOUND", "RETURNED", "LP-2026-001")?.title === "Item returned");
check("no push for no change", pushFor("FOUND", "FOUND", "x") === null);
check("no push when closed", pushFor("FOUND", "CLOSED", "x") === null);

// ── Text ──
check("cleanText trims + collapses", cleanText("  Black   iPhone  ", "x", 50) === "Black iPhone");
check("cleanText keeps lines, drops blanks", cleanText(" 8 Riverside Walk \n\n Crawley ", "x", 50) === "8 Riverside Walk\nCrawley");
check("cleanText empty → null", cleanText("   ", "x", 50) === null && cleanText(null, "x", 5) === null);
throws("cleanText too long", () => cleanText("abcdef", "Name", 5), /Name is too long/);
throws("cleanText not a string", () => cleanText(5, "Name", 5), /not valid/);
check("reg normalised", normaliseReg(" gl72 lxw ") === "GL72LXW" && normaliseReg("") === null && normaliseReg(null) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
