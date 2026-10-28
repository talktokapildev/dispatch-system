// Pure checks for utils/testBookings (no DB).
// node -r ts-node/register scripts/test-test-bookings.ts
import {
  NOT_TEST_BOOKING,
  TEST_BOOKING,
  NOT_TEST_BOOKING_SQL,
  bookingSearchWhere,
  phoneSearchVariants,
  queryFlag,
} from "../src/utils/testBookings";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}`, detail ?? "");
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Filters
check(
  "NOT_TEST_BOOKING keeps bookings with no passenger",
  same(NOT_TEST_BOOKING, {
    OR: [{ passengerId: null }, { passenger: { is: { isTestAccount: false } } }],
  })
);
check("TEST_BOOKING = test passenger", same(TEST_BOOKING, { passenger: { is: { isTestAccount: true } } }));
check("SQL fragment uses quoted columns", NOT_TEST_BOOKING_SQL.sql.includes(`"isTestAccount" = true`));

// Flags
check("flag true", queryFlag("true") && queryFlag("1") && queryFlag("YES"));
check("flag false", !queryFlag("false") && !queryFlag("") && !queryFlag(undefined) && !queryFlag(["true"]));

// Phone forms
check("07… → +44…", same(phoneSearchVariants("07587 545986"), ["07587545986", "+447587545986"]));
check("44… → +44…", same(phoneSearchVariants("447700000001"), ["447700000001", "+447700000001"]));
check("+44 kept", same(phoneSearchVariants("+44 7700 000001"), ["+447700000001"]));
check("partial digits", same(phoneSearchVariants("5986"), ["5986"]));
check("not a phone", phoneSearchVariants("Gatwick").length === 0 && phoneSearchVariants("123").length === 0);

// Search
check("empty search → null", bookingSearchWhere("   ") === null);
const ref = bookingSearchWhere("dsmvl5rm07t63") as any;
check("search covers ref + addresses + name + email (6)", ref.OR.length === 6);
check("search is case-insensitive", ref.OR[0].reference.mode === "insensitive");
const name = bookingSearchWhere("Bradley Mack") as any;
check("two words adds first+last name", name.OR.length === 7);
const phone = bookingSearchWhere("07587545986") as any;
check(
  "phone search adds both forms",
  phone.OR.filter((o: any) => o.passenger?.is?.user?.phone).length === 2
);
check("search text capped at 100 chars", (bookingSearchWhere("x".repeat(300)) as any).OR[0].reference.contains.length === 100);

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
