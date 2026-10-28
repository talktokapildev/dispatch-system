import { Prisma } from "@prisma/client";

/**
 * Test bookings = bookings made by a passenger account marked "Test account"
 * (Kapil's own numbers, the demo passenger). They stay in the database and on
 * TfL records; only the admin Bookings list, Dashboard and Reports hide them
 * by default.
 *
 * Bookings without a passenger (care home) are never test bookings. Written as
 * an OR rather than NOT { passenger: { isTestAccount: true } } because a NOT on
 * an optional relation would also drop rows whose passengerId is null.
 */
export const NOT_TEST_BOOKING: Prisma.BookingWhereInput = {
  OR: [{ passengerId: null }, { passenger: { is: { isTestAccount: false } } }],
};

export const TEST_BOOKING: Prisma.BookingWhereInput = {
  passenger: { is: { isTestAccount: true } },
};

/** Raw SQL condition on "Booking" rows (table must not be aliased). */
export const NOT_TEST_BOOKING_SQL = Prisma.sql`NOT EXISTS (
  SELECT 1 FROM "Passenger" tp
  WHERE tp."id" = "Booking"."passengerId" AND tp."isTestAccount" = true
)`;

/** "true" / "1" / "yes" → true. */
export function queryFlag(v: unknown): boolean {
  return typeof v === "string" && ["1", "true", "yes"].includes(v.toLowerCase());
}

/**
 * Phone forms to try for a search: "07587 545986" also matches "+447587545986",
 * "447587…" matches "+447587…". Returns [] when the text isn't phone-like.
 */
export function phoneSearchVariants(q: string): string[] {
  const digits = q.replace(/[\s()-]/g, "");
  if (!/^\+?\d{4,}$/.test(digits)) return [];
  const out = new Set<string>([digits]);
  if (digits.startsWith("0")) out.add("+44" + digits.slice(1));
  if (/^44\d/.test(digits)) out.add("+" + digits);
  return [...out];
}

/** Server-side search: reference, addresses, passenger name / phone / email. */
export function bookingSearchWhere(raw: string): Prisma.BookingWhereInput | null {
  const q = raw.trim().slice(0, 100);
  if (!q) return null;
  const ci = { contains: q, mode: "insensitive" as const };
  const or: Prisma.BookingWhereInput[] = [
    { reference: ci },
    { pickupAddress: ci },
    { dropoffAddress: ci },
    { passenger: { is: { user: { firstName: ci } } } },
    { passenger: { is: { user: { lastName: ci } } } },
    { passenger: { is: { user: { email: ci } } } },
  ];
  // "Bradley Mack": first + last name
  const parts = q.split(/\s+/);
  if (parts.length >= 2) {
    or.push({
      passenger: {
        is: {
          user: {
            firstName: { contains: parts[0], mode: "insensitive" },
            lastName: { contains: parts.slice(1).join(" "), mode: "insensitive" },
          },
        },
      },
    });
  }
  for (const p of phoneSearchVariants(q))
    or.push({ passenger: { is: { user: { phone: { contains: p } } } } });
  return { OR: or };
}
