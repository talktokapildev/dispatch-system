import Stripe from "stripe";
import { config } from "../config";

export class StripeService {
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(config.STRIPE_SECRET_KEY!, {
      apiVersion: "2024-06-20",
    });
  }

  // ── Create a PaymentIntent (pre-auth) ─────────────────────────────────────
  // Called when passenger selects Card payment at booking confirmation.
  // We use manual capture so we can adjust the amount after the actual trip.
  async createPaymentIntent(
    amountPence: number,
    currency: string = "gbp",
    metadata: Record<string, string> = {}
  ): Promise<{ clientSecret: string; paymentIntentId: string }> {
    const intent = await this.stripe.paymentIntents.create({
      amount: amountPence,
      currency,
      capture_method: "manual", // pre-auth only — capture after trip
      automatic_payment_methods: { enabled: true },
      //payment_method_types: ["card"],
      metadata,
    });

    return {
      clientSecret: intent.client_secret!,
      paymentIntentId: intent.id,
    };
  }

  // ── Capture a pre-authorised PaymentIntent ────────────────────────────────
  // Called when trip completes. Can adjust amount if actual fare differs.
  async capturePaymentIntent(
    paymentIntentId: string,
    actualAmountPence?: number
  ): Promise<void> {
    if (actualAmountPence) {
      // Update amount before capture (actual fare may differ from estimate)
      await this.stripe.paymentIntents.update(paymentIntentId, {
        amount: actualAmountPence,
      });
    }
    await this.stripe.paymentIntents.capture(paymentIntentId);
  }

  // ── Cancel / refund a PaymentIntent ──────────────────────────────────────
  // Called on booking cancellation
  async cancelPaymentIntent(paymentIntentId: string): Promise<void> {
    const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.status === "requires_capture") {
      // Pre-auth not yet captured — just cancel
      await this.stripe.paymentIntents.cancel(paymentIntentId);
    } else if (intent.status === "succeeded") {
      // Already captured — issue refund
      await this.stripe.refunds.create({ payment_intent: paymentIntentId });
    }
    // Other statuses (requires_payment_method, etc.) don't need action
  }

  // ── Calculate Stripe fee (for display to passenger) ──────────────────────
  // UK cards: 1.5% + 20p
  static calculateStripeFee(amountPence: number): number {
    return Math.round(amountPence * 0.015 + 20);
  }

  // ── Convert pounds to pence ───────────────────────────────────────────────
  static toPence(pounds: number): number {
    return Math.round(pounds * 100);
  }

  // ── Convert pence to pounds ───────────────────────────────────────────────
  static toPounds(pence: number): number {
    return pence / 100;
  }
}
