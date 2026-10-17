// backend/src/services/email.service.ts
//
// Transactional email via Resend (receipts). Needs RESEND_API_KEY and a sending domain verified
// in Resend (orangeride.co.uk). EMAIL_FROM overrides the sender (default receipts@orangeride.co.uk).
// EMAIL_DRY_RUN=true logs instead of sending (local development).
import { Resend } from "resend";

export type EmailAttachment = { filename: string; content: Buffer };

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY || process.env.EMAIL_DRY_RUN === "true";
}

export async function sendEmail(msg: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const from = process.env.EMAIL_FROM || "OrangeRide <receipts@orangeride.co.uk>";
  if (process.env.EMAIL_DRY_RUN === "true") {
    console.log(
      `[Email dry run] to=${msg.to} subject="${msg.subject}" attachments=${
        msg.attachments?.map((a) => `${a.filename}(${a.content.length}b)`).join(",") ?? "none"
      }`
    );
    return { ok: true, id: "dry-run" };
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "Email isn't set up yet (RESEND_API_KEY missing)" };
  try {
    const resend = new Resend(key);
    const { data, error } = await resend.emails.send({
      from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      reply_to: msg.replyTo,
      attachments: msg.attachments,
    } as any);
    if (error || !data) return { ok: false, error: error?.message ?? "Email failed" };
    return { ok: true, id: data.id };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Email failed" };
  }
}
