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

// TfL booking record requirement (from 1 July 2024): store the vehicle and its PHV licence number
// on the booking at assignment time, so the record keeps the car that did the trip even after the
// driver changes vehicle.
export type VehicleStamp = { vehicleId: string | null; driverPhvLicenceNumber: string | null };

export async function getDriverVehicleStamp(
  prisma: Pick<PrismaClient, "vehicle">,
  driverId: string
): Promise<VehicleStamp> {
  const vehicle = await prisma.vehicle.findUnique({
    where: { driverId },
    select: { id: true, phvLicenceNumber: true },
  });
  return {
    vehicleId: vehicle?.id ?? null,
    driverPhvLicenceNumber: vehicle?.phvLicenceNumber ?? null,
  };
}

/** Bookings that a vehicle change should follow: assigned to the driver but not yet started. */
export const NOT_STARTED_ASSIGNED = ["DRIVER_ASSIGNED"] as const;

/**
 * After a driver's vehicle changes, move their assigned-but-not-started bookings to the new
 * vehicle. Trips already under way (en route, arrived, in progress) keep the car they started with.
 */
export async function restampDriverBookings(
  prisma: Pick<PrismaClient, "vehicle" | "booking">,
  driverId: string
): Promise<number> {
  const stamp = await getDriverVehicleStamp(prisma, driverId);
  const res = await prisma.booking.updateMany({
    where: { driverId, status: { in: [...NOT_STARTED_ASSIGNED] } },
    data: stamp,
  });
  return res.count;
}

/**
 * API responses show `booking.driver.vehicle`. Replace it with the vehicle recorded on the booking,
 * so past trips keep showing the car that did them after the driver changes vehicle.
 * Needs `vehicle: true` in the booking's include.
 */
export function withTripVehicle<T>(booking: T): T {
  const b = booking as any;
  if (!b || !b.vehicle || !b.driver) return booking;
  return { ...b, driver: { ...b.driver, vehicle: b.vehicle } };
}
