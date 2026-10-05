// backend/src/services/flightMessages.ts
//
// All flight-milestone wording in one place. Plain ASCII (no emoji/accents)
// so each SMS stays a single 160-character segment where possible.
// Times are always UK time. Neutral wording about waiting (no promises),
// so introducing a waiting fee later doesn't make old texts wrong.
import { FlightEventType } from "./flightRules";

export type MessageContext = {
  flight: string; // e.g. "EZY8004"
  meetingPoint: string; // e.g. "Car Park 6, Level 4"
  pickupAt: Date; // new/current pickup time
  oldPickupAt: Date;
  idealPickupAt: Date; // when the passenger could be ready (may be earlier than allowed)
  landedAt: Date | null;
  contactPhone: string; // OrangeRide number for passengers
};

export type FlightMessages = {
  passengerSms: string | null;
  driverPush: { title: string; body: string } | null;
  driverSmsBackup: string | null; // only for ARRIVED / CANCELLED / DIVERTED
};

export function ukTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

const mins = (a: Date, b: Date) =>
  Math.round(Math.abs(a.getTime() - b.getTime()) / 60_000);

export function buildFlightMessages(
  type: FlightEventType,
  c: MessageContext
): FlightMessages {
  const pickup = ukTime(c.pickupAt);

  switch (type) {
    case "RUNNING_LATE": {
      const later = mins(c.pickupAt, c.oldPickupAt);
      return {
        passengerSms: `OrangeRide: ${
          c.flight
        } is running late. We've moved your pickup to ${pickup}${
          later ? ` (${later} min later)` : ""
        } and will keep tracking it. Call ${c.contactPhone}`,
        driverPush: {
          title: `${c.flight} delayed`,
          body: `Pickup moved to ${pickup}${later ? ` (+${later} min)` : ""}. ${
            c.meetingPoint
          }.`,
        },
        driverSmsBackup: null,
      };
    }
    case "RUNNING_EARLY": {
      const ready = ukTime(c.idealPickupAt);
      const canBeEarlier = c.idealPickupAt < c.pickupAt;
      return {
        passengerSms: `OrangeRide: ${
          c.flight
        } is expected early. Your pickup is now ${pickup}.${
          canBeEarlier ? " We'll text you if your driver can come sooner." : ""
        } Call ${c.contactPhone}`,
        driverPush: {
          title: `${c.flight} expected early`,
          body: canBeEarlier
            ? `Pickup now ${pickup}. Passenger ready ~${ready}. Can you make ${ready}? Tell OrangeRide.`
            : `Pickup now ${pickup}.`,
        },
        driverSmsBackup: null,
      };
    }
    case "EARLIER_CONFIRMED":
      return {
        passengerSms: `OrangeRide: Good news - your driver will meet you at ${c.meetingPoint} at ${pickup}. Call ${c.contactPhone}`,
        driverPush: null,
        driverSmsBackup: null,
      };
    case "ARRIVED": {
      const landed = c.landedAt
        ? ` landed ${ukTime(c.landedAt)}`
        : " has landed";
      return {
        passengerSms: `OrangeRide: Welcome to Gatwick! ${c.flight}${landed}. Meet your driver at ${c.meetingPoint} at ${pickup}. Call ${c.contactPhone}`,
        driverPush: {
          title: `${c.flight} has landed`,
          body: `Pickup ${pickup} at ${c.meetingPoint}.`,
        },
        driverSmsBackup: `OrangeRide: ${c.flight}${landed}. Pickup ${pickup} at ${c.meetingPoint}.`,
      };
    }
    case "CANCELLED":
    case "DIVERTED": {
      const what = type === "CANCELLED" ? "cancelled" : "diverted";
      return {
        passengerSms: `OrangeRide: We've seen that ${c.flight} has been ${what}. Please call us on ${c.contactPhone} to rearrange your pickup.`,
        driverPush: {
          title: `${c.flight} ${what}`,
          body: "Don't travel to the airport. OrangeRide will be in touch.",
        },
        driverSmsBackup: `OrangeRide: ${c.flight} has been ${what}. Don't travel to the airport - we'll be in touch.`,
      };
    }
    default:
      return { passengerSms: null, driverPush: null, driverSmsBackup: null };
  }
}
