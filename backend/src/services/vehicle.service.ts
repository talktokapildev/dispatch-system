// backend/src/services/vehicle.service.ts
//
// Fleet rules shared by the admin Vehicles page and the Drivers page.
//
// - A vehicle exists on its own. A driver has at most one current vehicle (Vehicle.driverId).
// - Retired = archivedAt set, isActive false, no driver. Retired cars stay on the bookings they did.
// - TfL Licence Condition 11: at most 20 PHVs available to carry out bookings. Counted as
//   vehicles on the fleet (not retired), whether or not a driver is assigned.
// - Changing a driver's vehicle moves their assigned-but-not-started bookings to the new car.
//   Trips under way keep the car they started with.
import { Prisma, PrismaClient } from "@prisma/client";
import { restampDriverBookings } from "../utils/bookingRecord";

export const TFL_VEHICLE_CAP = 20;

/** Statuses where a vehicle is out on a trip. */
export const ON_TRIP_STATUSES = ["DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "IN_PROGRESS"] as const;

export class VehicleError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

type Tx = Prisma.TransactionClient | PrismaClient;

/** "gl72lxw " → "GL72LXW"; spacing is kept as typed but compared without spaces. */
export const normalisePlate = (plate: string) => plate.trim().toUpperCase().replace(/\s+/g, " ");
const plateKey = (plate: string) => plate.replace(/\s+/g, "").toUpperCase();

/** Another vehicle with the same registration (ignoring spaces), if any. */
export async function findPlateClash(tx: Tx, plate: string, exceptId?: string) {
  const rows = await tx.$queryRaw<{ id: string; licensePlate: string; archivedAt: Date | null }[]>`
    SELECT "id", "licensePlate", "archivedAt" FROM "Vehicle"
    WHERE upper(replace("licensePlate", ' ', '')) = ${plateKey(plate)}
      AND "id" <> ${exceptId ?? ""}
    LIMIT 1`;
  return rows[0] ?? null;
}

export async function fleetCount(tx: Tx): Promise<number> {
  return tx.vehicle.count({ where: { archivedAt: null } });
}

export async function assertUnderCap(tx: Tx) {
  const count = await fleetCount(tx);
  if (count >= TFL_VEHICLE_CAP)
    throw new VehicleError(
      `TfL vehicle cap reached (${count}/${TFL_VEHICLE_CAP}). Your licence permits a maximum of ${TFL_VEHICLE_CAP} vehicles. Retire a vehicle before adding another.`,
      409
    );
}

/** Is this vehicle out on a trip right now (with someone other than `exceptDriverId`)? */
async function onTripWithOtherDriver(tx: Tx, vehicleId: string, exceptDriverId?: string) {
  return tx.booking.findFirst({
    where: {
      vehicleId,
      status: { in: [...ON_TRIP_STATUSES] },
      ...(exceptDriverId && { driverId: { not: exceptDriverId } }),
    },
    select: { reference: true },
  });
}

/**
 * Give a driver a vehicle, or take theirs away (vehicleId null).
 * - The driver's previous vehicle is unassigned (stays on the fleet, ready to reassign or retire).
 * - If the vehicle belonged to another driver, it moves; that driver is left without a car.
 * - Not-started bookings of both drivers follow the change.
 * Returns the driver the vehicle was taken from, if any.
 */
export async function setDriverVehicle(
  tx: Prisma.TransactionClient,
  driverId: string,
  vehicleId: string | null
): Promise<{ movedFromDriverId: string | null }> {
  const driver = await tx.driver.findUnique({
    where: { id: driverId },
    include: { vehicle: { select: { id: true } } },
  });
  if (!driver) throw new VehicleError("Driver not found", 404);
  if (driver.archivedAt && vehicleId)
    throw new VehicleError("This driver is archived. Restore them before assigning a vehicle.");
  const currentId = driver.vehicle?.id ?? null;
  if (currentId === vehicleId) return { movedFromDriverId: null };

  let movedFromDriverId: string | null = null;
  if (vehicleId) {
    const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new VehicleError("Vehicle not found", 404);
    if (vehicle.archivedAt)
      throw new VehicleError(
        `${vehicle.licensePlate} is retired. Restore it on the Vehicles page before assigning it.`
      );
    const busy = await onTripWithOtherDriver(tx, vehicleId, driverId);
    if (busy)
      throw new VehicleError(
        `${vehicle.licensePlate} is on a trip right now (${busy.reference}). Try again when it finishes.`,
        409
      );
    movedFromDriverId = vehicle.driverId && vehicle.driverId !== driverId ? vehicle.driverId : null;
  }

  // driverId is unique, so free the driver's slot before giving them the new car
  if (currentId) await tx.vehicle.update({ where: { id: currentId }, data: { driverId: null } });
  if (vehicleId) await tx.vehicle.update({ where: { id: vehicleId }, data: { driverId } });

  await restampDriverBookings(tx, driverId);
  if (movedFromDriverId) await restampDriverBookings(tx, movedFromDriverId);
  return { movedFromDriverId };
}

/** Retire a vehicle: unassign it, take it off the fleet count. It stays on its past bookings. */
export async function retireVehicle(tx: Prisma.TransactionClient, vehicleId: string) {
  const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) throw new VehicleError("Vehicle not found", 404);
  if (vehicle.archivedAt) return vehicle;
  const busy = await onTripWithOtherDriver(tx, vehicleId);
  if (busy)
    throw new VehicleError(
      `${vehicle.licensePlate} is on a trip right now (${busy.reference}). Retire it after the trip.`,
      409
    );
  const updated = await tx.vehicle.update({
    where: { id: vehicleId },
    data: { archivedAt: new Date(), isActive: false, driverId: null },
  });
  if (vehicle.driverId) await restampDriverBookings(tx, vehicle.driverId);
  return updated;
}
