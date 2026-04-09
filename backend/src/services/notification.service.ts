import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { PrismaClient } from "@prisma/client";

export class NotificationService {
  private expo: Expo;
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.expo = new Expo();
    this.prisma = prisma;
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

    const messages: ExpoPushMessage[] = tokens
      .filter((t) => Expo.isExpoPushToken(t.token))
      .map((t) => ({
        to: t.token,
        sound: "default" as const,
        title: notification.title,
        body: notification.body,
        data: notification.data ?? {},
        // iOS badge count — set to 1 for any unread notification
        badge: 1,
        // Android channel (configure in app for custom sound/vibration)
        channelId: "default",
      }));

    if (!messages.length) return;

    const chunks = this.expo.chunkPushNotifications(messages);

    for (const chunk of chunks) {
      try {
        const tickets: ExpoPushTicket[] =
          await this.expo.sendPushNotificationsAsync(chunk);
        // Log any errors — in production you'd handle receipts for delivery confirmation
        for (const ticket of tickets) {
          if (ticket.status === "error") {
            console.error(
              "[Push] Ticket error:",
              ticket.message,
              ticket.details
            );
          }
        }
      } catch (err) {
        console.error("[Push] Failed to send chunk:", err);
      }
    }
  }

  // ── Convenience methods for each notification type ─────────────────────────

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

  // Background job offer alert — fires if driver's app is in background
  async notifyNewJobOffer(driverUserId: string, pickup: string, fare: number) {
    await this.sendToUser(driverUserId, {
      title: "🚖 New job offer",
      body: `Pickup: ${pickup.split(",")[0]} · £${fare.toFixed(2)}`,
      data: { type: "JOB_OFFER" },
    });
  }
}
