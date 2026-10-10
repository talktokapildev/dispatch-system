// expo-server-sdk v6+ is ESM-only. Since this backend compiles to CommonJS
// we must use dynamic import() — top-level `import` would be compiled to
// require() by tsc and crash with ERR_REQUIRE_ESM at runtime.
//
// Push tokens are tagged with the app that registered them ("driver" |
// "passenger"). Expo rejects a request that mixes tokens from two apps
// (PUSH_TOO_MANY_EXPERIENCE_IDS), so every send names its target app.
import { PrismaClient } from "@prisma/client";

// Type-only imports are fine — they're erased at compile time
type ExpoType = import("expo-server-sdk").Expo;
type ExpoPushMessageType = import("expo-server-sdk").ExpoPushMessage;
type ExpoPushTicketType = import("expo-server-sdk").ExpoPushTicket;

export type PushApp = "driver" | "passenger";
export const PUSH_APPS: readonly PushApp[] = ["driver", "passenger"];

// Lazy singleton so we only pay the dynamic import cost once
let _expo: ExpoType | null = null;
let _ExpoClass: typeof import("expo-server-sdk").Expo | null = null;

// A REAL dynamic import. tsc (module: commonjs) rewrites a plain `import()`
// into `require()`, which throws ERR_REQUIRE_ESM for ESM-only packages like
// expo-server-sdk v6. Wrapping it in Function stops tsc from touching it.
const importEsm = new Function("specifier", "return import(specifier)") as <
  T = any
>(
  specifier: string
) => Promise<T>;

async function getExpo(): Promise<{
  expo: ExpoType;
  Expo: typeof import("expo-server-sdk").Expo;
}> {
  if (_expo && _ExpoClass) return { expo: _expo, Expo: _ExpoClass };
  const mod = await importEsm<typeof import("expo-server-sdk")>(
    "expo-server-sdk"
  );
  _ExpoClass = mod.Expo;
  _expo = new mod.Expo();
  return { expo: _expo, Expo: _ExpoClass };
}

type Notification = {
  title: string;
  body: string;
  data?: Record<string, any>;
};

export class NotificationService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    // Eagerly warm up the dynamic import so the first notification isn't slow
    getExpo().catch((err) =>
      console.error("[Push] expo-server-sdk failed to load:", err)
    );
  }

  // ── Send to one user's devices for ONE app ─────────────────────────────────
  // Returns how many devices accepted the message (0 = nothing delivered).
  //  - tokens tagged with `app`        → sent together (same Expo project)
  //  - untagged tokens (older builds)  → one request each, so a token from the
  //                                      other app can't make the batch fail
  //  - tokens tagged with the other app → skipped
  // Tokens Expo reports as DeviceNotRegistered (app deleted/reinstalled) are removed.
  async sendToUser(
    userId: string,
    notification: Notification,
    app: PushApp
  ): Promise<number> {
    const tokens: { token: string; app: string | null }[] =
      await this.prisma.pushToken.findMany({
        where: { userId, OR: [{ app }, { app: null }] },
        select: { token: true, app: true },
      });
    if (!tokens.length) return 0;

    const { expo, Expo } = await getExpo();
    const valid = tokens.filter((t) => Expo.isExpoPushToken(t.token));
    if (!valid.length) return 0;

    const toMessage = (to: string): ExpoPushMessageType => ({
      to,
      sound: "default",
      title: notification.title,
      body: notification.body,
      data: notification.data ?? {},
      badge: 1,
      channelId: "default",
      priority: "high",
    });

    const tagged = valid.filter((t) => t.app === app).map((t) => t.token);
    const untagged = valid.filter((t) => !t.app).map((t) => t.token);
    const batches: string[][] = [
      ...expo
        .chunkPushNotifications(tagged.map(toMessage))
        .map((chunk) => chunk.map((m) => m.to as string)),
      ...untagged.map((token) => [token]),
    ];

    let delivered = 0;
    const stale: string[] = [];

    for (const batch of batches) {
      try {
        const tickets: ExpoPushTicketType[] =
          await expo.sendPushNotificationsAsync(batch.map(toMessage));
        tickets.forEach((ticket, i) => {
          if (ticket.status === "ok") {
            delivered++;
            return;
          }
          const details = (ticket as any).details;
          console.error("[Push] Ticket error:", ticket.message, details);
          if (details?.error === "DeviceNotRegistered") stale.push(batch[i]);
        });
      } catch (err) {
        console.error(
          `[Push] Failed to send to ${batch.length} device(s):`,
          err
        );
      }
    }

    if (stale.length) {
      await this.prisma.pushToken
        .deleteMany({ where: { userId, token: { in: stale } } })
        .catch(() => {});
      console.warn(`[Push] Removed ${stale.length} unregistered token(s)`);
    }
    return delivered;
  }

  // ── Convenience methods ────────────────────────────────────────────────────

  async notifyDriverAssigned(
    passengerUserId: string,
    driverFirstName: string,
    vehiclePlate: string
  ) {
    await this.sendToUser(
      passengerUserId,
      {
        title: "🚖 Driver assigned",
        body: `${driverFirstName} is on the way in ${vehiclePlate}`,
        data: { type: "DRIVER_ASSIGNED" },
      },
      "passenger"
    );
  }

  async notifyDriverEnRoute(
    passengerUserId: string,
    driverFirstName: string,
    etaMins?: number
  ) {
    const eta = etaMins ? ` (~${etaMins} min away)` : "";
    await this.sendToUser(
      passengerUserId,
      {
        title: "🚗 Driver on the way",
        body: `${driverFirstName} is heading to your pickup${eta}`,
        data: { type: "DRIVER_EN_ROUTE" },
      },
      "passenger"
    );
  }

  async notifyDriverArrived(passengerUserId: string, driverFirstName: string) {
    await this.sendToUser(
      passengerUserId,
      {
        title: "📍 Driver has arrived!",
        body: `${driverFirstName} is waiting for you`,
        data: { type: "DRIVER_ARRIVED" },
      },
      "passenger"
    );
  }

  async notifyTripStarted(passengerUserId: string) {
    await this.sendToUser(
      passengerUserId,
      {
        title: "🛣️ Trip started",
        body: "You're on your way. Have a safe journey!",
        data: { type: "IN_PROGRESS" },
      },
      "passenger"
    );
  }

  async notifyTripComplete(passengerUserId: string, fare: number) {
    await this.sendToUser(
      passengerUserId,
      {
        title: "🏁 Trip complete",
        body: `You've arrived! Fare: £${fare.toFixed(2)}`,
        data: { type: "COMPLETED" },
      },
      "passenger"
    );
  }

  async notifyDriverCancelled(passengerUserId: string) {
    await this.sendToUser(
      passengerUserId,
      {
        title: "🔄 Finding a new driver",
        body: "Your driver had to cancel. We're finding you another one now.",
        data: { type: "DRIVER_CANCELLED" },
      },
      "passenger"
    );
  }

  async notifyPassengerCancelled(driverUserId: string) {
    await this.sendToUser(
      driverUserId,
      {
        title: "❌ Booking cancelled",
        body: "The passenger has cancelled this booking.",
        data: { type: "PASSENGER_CANCELLED" },
      },
      "driver"
    );
  }

  async notifyNewJobOffer(driverUserId: string, pickup: string, fare: number) {
    await this.sendToUser(
      driverUserId,
      {
        title: "🚖 New job offer",
        body: `Pickup: ${pickup.split(",")[0]} · £${fare.toFixed(2)}`,
        data: { type: "JOB_OFFER" },
      },
      "driver"
    );
  }
}
