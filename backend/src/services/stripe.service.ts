import Stripe from "stripe";

// ── Dual-mode Stripe ──────────────────────────────────────────────────────────
// Live keys are used for all real customers.
// Test keys are used for phones listed in STRIPE_TEST_PHONES (comma-separated).
// This allows demo/test bookings without real charges, even in production.

function getTestPhones(): string[] {
  return (process.env.STRIPE_TEST_PHONES ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

function isTestPhone(phone: string): boolean {
  return getTestPhones().includes(phone);
}

function buildStripeClient(secret: string): Stripe {
  return new Stripe(secret, { apiVersion: "2024-06-20" });
}

// Lazily initialised singletons — avoids creating clients on every request
let _live: Stripe | null = null;
let _test: Stripe | null = null;

function getLiveClient(): Stripe {
  if (!_live) _live = buildStripeClient(process.env.STRIPE_LIVE_SECRET_KEY!);
  return _live;
}

function getTestClient(): Stripe {
  if (!_test) _test = buildStripeClient(process.env.STRIPE_TEST_SECRET_KEY!);
  return _test;
}

export function getStripeClient(phone: string): Stripe {
  return isTestPhone(phone) ? getTestClient() : getLiveClient();
}

// ── StripeService ─────────────────────────────────────────────────────────────
export class StripeService {
  private stripe: Stripe;
  private isTest: boolean;

  constructor(passengerPhone: string) {
    this.isTest = isTestPhone(passengerPhone);
    this.stripe = this.isTest ? getTestClient() : getLiveClient();
  }

  get mode(): "live" | "test" {
    return this.isTest ? "test" : "live";
  }

  // ── Create a PaymentIntent (pre-auth) ───────────────────────────────────────
  async createPaymentIntent(
    amountPence: number,
    currency: string = "gbp",
    metadata: Record<string, string> = {}
  ): Promise<{
    clientSecret: string;
    paymentIntentId: string;
    stripeMode: "live" | "test";
  }> {
    const intent = await this.stripe.paymentIntents.create({
      amount: amountPence,
      currency,
      capture_method: "manual",
      automatic_payment_methods: { enabled: true },
      metadata: { ...metadata, stripeMode: this.mode },
    });

    return {
      clientSecret: intent.client_secret!,
      paymentIntentId: intent.id,
      stripeMode: this.mode,
    };
  }

  // ── Capture a pre-authorised PaymentIntent ──────────────────────────────────
  async capturePaymentIntent(
    paymentIntentId: string,
    actualAmountPence?: number
  ): Promise<void> {
    if (actualAmountPence) {
      await this.stripe.paymentIntents.update(paymentIntentId, {
        amount: actualAmountPence,
      });
    }
    await this.stripe.paymentIntents.capture(paymentIntentId);
  }

  // ── Cancel / refund a PaymentIntent ────────────────────────────────────────
  async cancelPaymentIntent(paymentIntentId: string): Promise<void> {
    const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status === "requires_capture") {
      await this.stripe.paymentIntents.cancel(paymentIntentId);
    } else if (intent.status === "succeeded") {
      await this.stripe.refunds.create({ payment_intent: paymentIntentId });
    }
  }

  // ── Static helpers ──────────────────────────────────────────────────────────
  static calculateStripeFee(amountPence: number): number {
    return Math.round(amountPence * 0.015 + 20);
  }

  static toPence(pounds: number): number {
    return Math.round(pounds * 100);
  }

  static toPounds(pence: number): number {
    return pence / 100;
  }
}

// ── Phone-free capture/cancel (used by dispatch.service) ─────────────────────
// We don't have the passenger phone in dispatch context, so we check the
// paymentIntent's own metadata to determine which Stripe account it belongs to.
export async function capturePaymentIntentByMode(
  paymentIntentId: string,
  actualAmountPence?: number
): Promise<void> {
  const stripe = await resolveClientForIntent(paymentIntentId);
  if (actualAmountPence) {
    await stripe.paymentIntents.update(paymentIntentId, {
      amount: actualAmountPence,
    });
  }
  await stripe.paymentIntents.capture(paymentIntentId);
}

export async function cancelPaymentIntentByMode(
  paymentIntentId: string
): Promise<void> {
  const stripe = await resolveClientForIntent(paymentIntentId);
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (intent.status === "requires_capture") {
    await stripe.paymentIntents.cancel(paymentIntentId);
  } else if (intent.status === "succeeded") {
    await stripe.refunds.create({ payment_intent: paymentIntentId });
  }
}

// Reads the stripeMode from the intent's metadata to pick the right client.
// Falls back to trying live first, then test.
async function resolveClientForIntent(
  paymentIntentId: string
): Promise<Stripe> {
  try {
    const intent = await getLiveClient().paymentIntents.retrieve(
      paymentIntentId
    );
    const mode = intent.metadata?.stripeMode;
    return mode === "test" ? getTestClient() : getLiveClient();
  } catch {
    // Intent not found on live account — must be a test intent
    return getTestClient();
  }
}
