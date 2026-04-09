// expo-server-sdk v6+ is ESM-only. Since this backend compiles to CommonJS
// we must use dynamic import() — top-level `import` would be compiled to
// require() by tsc and crash with ERR_REQUIRE_ESM at runtime.
import { PrismaClient } from "@prisma/client";

// Type-only imports are fine — they're erased at compile time
type ExpoType = import("expo-server-sdk").Expo;
type ExpoPushMessageType = import("expo-server-sdk").ExpoPushMessage;
type ExpoPushTicketType = import("expo-server-sdk").ExpoPushTicket;

// Lazy singleton so we only pay the dynamic import cost once
let _expo: ExpoType | null = null;
let _ExpoClass: typeof import("expo-server-sdk").Expo | null = null;

async function getExpo(): Promise<{
  expo: ExpoType;
  Expo: typeof import("expo-server-sdk").Expo;
}> {
  if (_expo && _ExpoClass) return { expo: _expo, Expo: _ExpoClass };
  const mod = await import("expo-server-sdk");
  _ExpoClass = mod.Expo;
  _expo = new mod.Expo();
  return { expo: _expo, Expo: _ExpoClass };
}

export class NotificationService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    // Eagerly warm up the dynamic import so the first notification isn't slow
    getExpo().catch(() => {});
  }

  // ── Send to a specific user (looks up all their registered tokens) ─────────
  async sendToUser(
    userId: string,
    notification: { title: string; body: string; data?: Record<string, any> }
  ): Promise<void> {
    const tokens = await this.prisma.pushToken.findMany({
      where: { userId },
    });

    if (!tokens.length) return;

    const { expo, Expo } = await getExpo();

    const messages: ExpoPushMessageType[] = tokens
      .filter((t) => Expo.isExpoPushToken(t.token))
      .map((t) => ({
        to: t.token,
        sound: "default" as const,
        title: notification.title,
        body: notification.body,
        data: notification.data ?? {},
        badge: 1,
        channelId: "default",
      }));

    if (!messages.length) return;

    const chunks = expo.chunkPushNotifications(messages);

    for (const chunk of chunks) {
      try {
        const tickets: ExpoPushTicketType[] =
          await expo.sendPushNotificationsAsync(chunk);
        for (const ticket of tickets) {
          if (ticket.status === "error") {
            console.error(
              "[Push] Ticket error:",
              ticket.message,
              (ticket as any).details
            );
          }
        }
      } catch (err) {
        console.error("[Push] Failed to send chunk:", err);
      }
    }
  }

  // ── Convenience methods ────────────────────────────────────────────────────

  async notifyDriverAssigned(
    passengerUserId: string,
    driverFirstName: string,
    vehiclePlate: string
  ) {
    await this.sendToUser(passengerUserId, {
      title: "🚖 Driver assigned",
      body: `${driverFirstName} is on the way in ${vehiclePlate}`,
      data: { type: "DRIVER_ASSIGNED" },
    });
  }

  async notifyDriverEnRoute(
    passengerUserId: string,
    driverFirstName: string,
    etaMins?: number
  ) {
    const eta = etaMins ? ` (~${etaMins} min away)` : "";
    await this.sendToUser(passengerUserId, {
      title: "🚗 Driver on the way",
      body: `${driverFirstName} is heading to your pickup${eta}`,
      data: { type: "DRIVER_EN_ROUTE" },
    });
  }

  async notifyDriverArrived(passengerUserId: string, driverFirstName: string) {
    await this.sendToUser(passengerUserId, {
      title: "📍 Driver has arrived!",
      body: `${driverFirstName} is waiting for you`,
      data: { type: "DRIVER_ARRIVED" },
    });
  }

  async notifyTripStarted(passengerUserId: string) {
    await this.sendToUser(passengerUserId, {
      title: "🛣️ Trip started",
      body: "You're on your way. Have a safe journey!",
      data: { type: "IN_PROGRESS" },
    });
  }

  async notifyTripComplete(passengerUserId: string, fare: number) {
    await this.sendToUser(passengerUserId, {
      title: "🏁 Trip complete",
      body: `You've arrived! Fare: £${fare.toFixed(2)}`,
      data: { type: "COMPLETED" },
    });
  }

  async notifyDriverCancelled(passengerUserId: string) {
    await this.sendToUser(passengerUserId, {
      title: "🔄 Finding a new driver",
      body: "Your driver had to cancel. We're finding you another one now.",
      data: { type: "DRIVER_CANCELLED" },
    });
  }

  async notifyPassengerCancelled(driverUserId: string) {
    await this.sendToUser(driverUserId, {
      title: "❌ Booking cancelled",
      body: "The passenger has cancelled this booking.",
      data: { type: "PASSENGER_CANCELLED" },
    });
  }

  async notifyNewJobOffer(driverUserId: string, pickup: string, fare: number) {
    await this.sendToUser(driverUserId, {
      title: "🚖 New job offer",
      body: `Pickup: ${pickup.split(",")[0]} · £${fare.toFixed(2)}`,
      data: { type: "JOB_OFFER" },
    });
  }
}
