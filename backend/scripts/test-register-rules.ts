// backend/scripts/test-register-rules.ts
//
// Pure tests for the TfL driver register rules (no database).
//   node -r ts-node/register scripts/test-register-rules.ts
import {
  RegisterError,
  addMonths,
  ageOn,
  dayKey,
  deletableFrom,
  formatNi,
  licenceCheckDue,
  maskNi,
  normaliseAddress,
  normaliseCallSign,
  normaliseNi,
  normalisePostcode,
  parseDay,
  parseRegisterInput,
  registerDates,
  ukToday,
  validateEngagements,
} from "../src/services/driverRegisterRules";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`);
}
const throws = (fn: () => unknown, re?: RegExp) => {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof RegisterError && (!re || re.test(e.message));
  }
};
const d = (s: string) => parseDay(s)!;
const NOW = new Date("2026-10-18T22:30:00Z"); // 23:30 UK (BST) on 18 Oct

// Days
check("1 parseDay valid", dayKey(d("2026-02-28")) === "2026-02-28");
check("2 parseDay rejects 30 Feb / junk", parseDay("2026-02-30") === null && parseDay("18/10/2026") === null && parseDay(5) === null);
check("3 ukToday uses UK date", dayKey(ukToday(new Date("2026-10-18T23:30:00Z"))) === "2026-10-19", dayKey(ukToday(new Date("2026-10-18T23:30:00Z"))));
check("4 addMonths end of month", dayKey(addMonths(d("2026-01-31"), 1)) === "2026-02-28" && dayKey(addMonths(d("2025-10-18"), 12)) === "2026-10-18");
check("5 ageOn birthday edge", ageOn(d("2005-10-19"), d("2026-10-18")) === 20 && ageOn(d("2005-10-18"), d("2026-10-18")) === 21);

// Fields
check("6 postcode formats", normalisePostcode("rh104ss") === "RH10 4SS" && normalisePostcode(" sw1a 1aa ") === "SW1A 1AA" && normalisePostcode("RH6 0YR") === "RH6 0YR");
check("7 postcode rejects junk", normalisePostcode("12345") === null && normalisePostcode("RH10") === null);
check("8 NI valid", normaliseNi("ab 12 34 56 c") === "AB123456C" && normaliseNi("AB123456D") === "AB123456D" && normaliseNi("QQ123456C") === null);
check("9 NI invalid (prefix/suffix)", normaliseNi("GB123456A") === null && normaliseNi("DA123456A") === null && normaliseNi("AB123456E") === null && normaliseNi("AO123456A") === null);
check("10 NI format + mask", formatNi("AB123456C") === "AB 12 34 56 C" && maskNi("AB123456C") === "AB ** ** ** C" && maskNi(null) === null);
check("11 call sign", normaliseCallSign(" or01 ") === "OR01" && normaliseCallSign("") === null && normaliseCallSign("TOO-LONG-CALL") === false && normaliseCallSign("A B") === false);
check("12 address lines", normaliseAddress("7 Riverside Walk, Crawley\n\n  West Sussex ") === "7 Riverside Walk\nCrawley\nWest Sussex" && normaliseAddress("  ") === null);

// Register input
const ok = parseRegisterInput(
  { postcode: "rh10 4ss", niNumber: "ab123456c", dateOfBirth: "1980-05-01", callSign: "or1", licenceCheckedAt: "2026-10-01", middleNames: "  Kumar " },
  NOW
);
check("13 register input normalised", ok.postcode === "RH10 4SS" && ok.niNumber === "AB123456C" && ok.callSign === "OR1" && ok.middleNames === "Kumar" && dayKey(ok.dateOfBirth!) === "1980-05-01", ok);
check("14 undefined = untouched, '' = cleared", (() => { const r = parseRegisterInput({ postcode: "", niNumber: undefined }, NOW); return r.postcode === null && !("niNumber" in r); })());
check("15 bad NI rejected", throws(() => parseRegisterInput({ niNumber: "123" }, NOW), /National Insurance/));
check("16 future DOB rejected", throws(() => parseRegisterInput({ dateOfBirth: "2026-12-01" }, NOW), /birth/));
check("17 future licence check rejected", throws(() => parseRegisterInput({ licenceCheckedAt: "2026-10-20" }, NOW), /future/));

// Engagements → TfL form
const e = (id: string, s: string, f: string | null) => ({ id, startedAt: d(s), endedAt: f ? d(f) : null });
const rows = [e("b", "2025-01-10", "2025-06-30"), e("a", "2024-03-01", "2024-09-15"), e("c", "2026-02-01", null)];
const r = registerDates(rows);
check(
  "18 first available / leaving / restarts",
  dayKey(r.firstAvailable!) === "2024-03-01" &&
    dayKey(r.dateOfLeaving!) === "2024-09-15" &&
    r.restarts.length === 2 &&
    dayKey(r.restarts[0].restart) === "2025-01-10" &&
    dayKey(r.restarts[0].finish!) === "2025-06-30" &&
    r.restarts[1].finish === null &&
    r.active &&
    r.leftOn === null,
  r
);
const left = [e("a", "2024-03-01", "2025-10-17")];
check("19 left: deletable 12 months after", dayKey(deletableFrom(left)!) === "2026-10-17");
check("20 active: not deletable", deletableFrom(rows) === null);
check("21 overlap rejected", throws(() => validateEngagements([e("a", "2025-01-01", "2025-06-01"), e("b", "2025-05-01", null)], NOW), /overlap/));
check("22 open period not last rejected", throws(() => validateEngagements([e("a", "2025-01-01", null), e("b", "2025-05-01", null)], NOW), /latest/));
check("23 finish before start rejected", throws(() => validateEngagements([e("a", "2025-05-01", "2025-01-01")], NOW), /before/));
check("24 future finish rejected", throws(() => validateEngagements([e("a", "2025-05-01", "2026-12-01")], NOW), /future/));
check("25 restart on leaving day allowed", (() => { validateEngagements([e("a", "2025-01-01", "2025-06-01"), e("b", "2025-06-01", null)], NOW); return true; })());

// DVLA check
check("26 licence check due", licenceCheckDue(null, NOW) && licenceCheckDue(d("2026-04-17"), NOW) && !licenceCheckDue(d("2026-04-18"), NOW));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
