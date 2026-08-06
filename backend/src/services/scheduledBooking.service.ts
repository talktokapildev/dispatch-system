// backend/src/services/scheduledBooking.service.ts
//
// Handles the "job board" flow for advance/scheduled bookings:
// listing open jobs, claiming, releasing, and ETA-based claim gating.
//
// Mirrors DispatchService's shape (same constructor signature) so it wires
// into routes the same way. Does not modify DispatchService — a claimed
// scheduled booking becomes DRIVER_ASSIGNED, indistinguishable from a
// normally-dispatched one, so all downstream trip-progress logic in
// DispatchService continues to apply untouched.
import { PrismaClient, Booking, BookingStatus } from "@prisma/client";
import Redis from "ioredis";
import { Server as SocketServer } from "socket.io";
import { MapsService } from "./maps.service";
import {
  acquireClaimLock,
  releaseClaimLock,
} from "../utils/scheduledBookingLock";
import { SocketEvent } from "../types";

// TODO: move these two into ../config alongside DRIVER_ACCEPT_TIMEOUT_MS etc.
const SCHEDULED_BOOKING_MIN_LEAD_HOURS = 2;
const SCHEDULED_BOOKING_ADMIN_ALERT_HOURS = 24;

const TRAFFIC_MULTIPLIER = 1.18; // within your agreed 1.15–1.2x range
const SAFETY_BUFFER_MINUTES = 10;

// ── Named result types (kept out of inline method signatures on purpose —
// multi-line inline union return types are fragile to copy/paste) ─────────

type EtaCheckResult = {
  feasible: boolean;
  etaMinutesWithBuffer: number;
  reason?: string;
};

type ClaimSuccess = { success: true; booking: Booking };
type ClaimFailure = { success: false; reason: string; etaMinutes?: number };
type ClaimResult = ClaimSuccess | ClaimFailure;

type ReleaseSuccess = { success: true; adminAlertRequired: boolean };
type ReleaseFailure = { success: false; reason: string };
type ReleaseResult = ReleaseSuccess | ReleaseFailure;

export class ScheduledBookingService {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
    private io: SocketServer,
    private maps: MapsService
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // listOpenJobs — the job board feed
  // ───────────────────────────────────────────────────────────────────────
  async listOpenJobs(): Promise<Booking[]> {
    return this.prisma.booking.findMany({
      where: { status: BookingStatus.SCHEDULED_OPEN },
      orderBy: { scheduledAt: "asc" },
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // checkClaimEta — claim-time gating
  // ───────────────────────────────────────────────────────────────────────
  async checkClaimEta(
    booking: Booking,
    driverLat: number,
    driverLng: number
  ): Promise<EtaCheckResult> {
    if (!booking.scheduledAt) {
      return { feasible: true, etaMinutesWithBuffer: 0 };
    }

    try {
      const toPickup = await this.maps.getDirections(
        { lat: driverLat, lng: driverLng },
        { lat: booking.pickupLatitude, lng: booking.pickupLongitude }
      );

      const etaMinutesWithBuffer =
        Math.ceil(toPickup.durationMinutes * TRAFFIC_MULTIPLIER) +
        SAFETY_BUFFER_MINUTES;

      const minutesUntilPickup =
        (booking.scheduledAt.getTime() - Date.now()) / 60000;
      const feasible = etaMinutesWithBuffer <= minutesUntilPickup;

      return {
        feasible,
        etaMinutesWithBuffer,
        reason: feasible ? undefined : "insufficient_lead_time",
      };
    } catch (err) {
      return {
        feasible: true,
        etaMinutesWithBuffer: 0,
        reason: "eta_lookup_failed",
      };
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // claimJob
  // ───────────────────────────────────────────────────────────────────────
  async claimJob(
    bookingId: string,
    driverId: string,
    driverUserId: string,
    driverLat: number,
    driverLng: number
  ): Promise<ClaimResult> {
    const lockToken = await acquireClaimLock(this.redis, bookingId);
    if (!lockToken) {
      return { success: false, reason: "lock_contended" };
    }

    try {
      const booking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
      });
      if (!booking) return { success: false, reason: "not_found" };
      if (booking.status !== BookingStatus.SCHEDULED_OPEN) {
        return { success: false, reason: "already_claimed" };
      }

      const etaCheck = await this.checkClaimEta(booking, driverLat, driverLng);
      if (!etaCheck.feasible) {
        return {
          success: false,
          reason: "eta_infeasible",
          etaMinutes: etaCheck.etaMinutesWithBuffer,
        };
      }

      const updateResult = await this.prisma.booking.updateMany({
        where: { id: bookingId, status: BookingStatus.SCHEDULED_OPEN },
        data: {
          driverId,
          status: BookingStatus.DRIVER_ASSIGNED,
          claimedAt: new Date(),
          dispatchedAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        return { success: false, reason: "already_claimed" };
      }

      await this.prisma.bookingStatusHistory.create({
        data: {
          bookingId,
          status: BookingStatus.DRIVER_ASSIGNED,
          note: "Claimed from scheduled job board",
        },
      });

      const updatedBooking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
      });

      this.io
        .to(`booking:${bookingId}`)
        .emit(SocketEvent.BOOKING_STATUS_UPDATE, {
          bookingId,
          status: BookingStatus.DRIVER_ASSIGNED,
          timestamp: Date.now(),
        });
      this.io.to("admin").emit(SocketEvent.ADMIN_BOOKING_UPDATED, {
        bookingId,
        status: BookingStatus.DRIVER_ASSIGNED,
        source: "scheduled_claim",
        driverId,
      });

      return { success: true, booking: updatedBooking! };
    } finally {
      await releaseClaimLock(this.redis, bookingId, lockToken);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // releaseJob (un-claim)
  // ───────────────────────────────────────────────────────────────────────
  async releaseJob(
    bookingId: string,
    driverId: string
  ): Promise<ReleaseResult> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) return { success: false, reason: "not_found" };
    if (booking.driverId !== driverId)
      return { success: false, reason: "not_your_booking" };
    if (
      booking.status !== BookingStatus.DRIVER_ASSIGNED ||
      !booking.claimedAt
    ) {
      return { success: false, reason: "not_claimable_state" };
    }

    const hoursUntilPickup = booking.scheduledAt
      ? (booking.scheduledAt.getTime() - Date.now()) / 3_600_000
      : 0;
    const adminAlertRequired =
      hoursUntilPickup <= SCHEDULED_BOOKING_ADMIN_ALERT_HOURS;

    await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          driverId: null,
          status: BookingStatus.SCHEDULED_OPEN,
          claimedAt: null,
          dispatchedAt: null,
        },
      }),
      this.prisma.bookingStatusHistory.create({
        data: {
          bookingId,
          status: BookingStatus.SCHEDULED_OPEN,
          note: "Released back to job board by driver",
        },
      }),
    ]);

    this.io.to("admin").emit(SocketEvent.ADMIN_BOOKING_UPDATED, {
      bookingId,
      status: BookingStatus.SCHEDULED_OPEN,
      source: "scheduled_release",
      adminAlertRequired,
    });

    return { success: true, adminAlertRequired };
  }

  // ───────────────────────────────────────────────────────────────────────
  // findUnclaimedNearingDeadline — used by the 24hr admin alert cron job
  // ───────────────────────────────────────────────────────────────────────
  async findUnclaimedNearingDeadline(
    hoursThreshold: number = SCHEDULED_BOOKING_ADMIN_ALERT_HOURS
  ): Promise<Booking[]> {
    const cutoff = new Date(Date.now() + hoursThreshold * 3_600_000);
    return this.prisma.booking.findMany({
      where: {
        status: BookingStatus.SCHEDULED_OPEN,
        scheduledAt: { lte: cutoff },
      },
      orderBy: { scheduledAt: "asc" },
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // listClaimedByDriver — jobs this driver claimed from the job board that
  // haven't started yet. Needed because a claimed job disappears from the
  // open pool immediately — this is the only way back to it afterward.
  // ───────────────────────────────────────────────────────────────────────
  async listClaimedByDriver(driverId: string): Promise<Booking[]> {
    return this.prisma.booking.findMany({
      where: {
        driverId,
        claimedAt: { not: null },
        status: BookingStatus.DRIVER_ASSIGNED,
      },
      orderBy: { scheduledAt: "asc" },
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Validates minimum lead time — called from the booking-creation route
  // ───────────────────────────────────────────────────────────────────────
  static hasMinimumLeadTime(scheduledAt: Date): boolean {
    const hoursUntil = (scheduledAt.getTime() - Date.now()) / 3_600_000;
    return hoursUntil >= SCHEDULED_BOOKING_MIN_LEAD_HOURS;
  }
}
