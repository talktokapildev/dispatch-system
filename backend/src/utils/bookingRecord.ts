// backend/src/utils/bookingRecord.ts
//
// TfL booking-record helpers shared by every path that assigns a driver.
// Mirrors the logic in DispatchService.acceptBooking so the job-board
// (scheduled) flow records the same fields as the ASAP flow.
import { PrismaClient } from "@prisma/client";

// TfL Condition 23: the booking respondent must be recorded.
// If no human dispatcher is set, stamp the primary operator admin —
// the system dispatches on behalf of the operator.
export async function resolveDispatcher(
  prisma: PrismaClient,
  existing: string | null
): Promise<string | null> {
  if (existing) return existing;
  const primaryAdmin = await prisma.user.findFirst({
    where: { roles: { has: "ADMIN" }, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return primaryAdmin?.id ?? null;
}

// TfL booking record requirement (from 1 July 2024): store the PHV
// licence number on the booking at assignment time.
export async function getDriverPhvLicenceNumber(
  prisma: PrismaClient,
  driverId: string
): Promise<string | null> {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: { vehicle: true },
  });
  return driver?.vehicle?.phvLicenceNumber ?? null;
}
