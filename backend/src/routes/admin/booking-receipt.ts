// backend/src/routes/admin/booking-receipt.ts
//
// POST /api/v1/admin/bookings/:id/receipt         — create/refresh receipt, returns the PDF
// POST /api/v1/admin/bookings/:id/receipt/email   — create/refresh receipt, emails it to the passenger
//
// Body (both, optional): { billTo?: string | null }  — company name for expense claims
//                        { email?: string }          — email route only: send somewhere else
import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ReceiptError,
  operatorDetails,
  receiptFileName,
  renderReceiptPdf,
  saveReceipt,
} from "../../services/receipt.service";
import { emailConfigured, sendEmail } from "../../services/email.service";

const bodySchema = z
  .object({
    billTo: z.string().max(120).nullable().optional(),
    email: z.string().email().optional(),
  })
  .optional()
  .default({});

export async function adminBookingReceiptRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/admin/bookings/:id/receipt",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = bodySchema.parse(request.body ?? {});
      try {
        const receipt = await saveReceipt(fastify.prisma, id, { billTo: body.billTo });
        const op = await operatorDetails(fastify.prisma);
        const pdf = await renderReceiptPdf(receipt, op);
        return reply
          .header("Content-Type", "application/pdf")
          .header(
            "Content-Disposition",
            `attachment; filename="${receiptFileName(receipt, op)}"`
          )
          .send(pdf);
      } catch (err) {
        if (err instanceof ReceiptError)
          return reply.status(err.statusCode).send({ success: false, error: err.message });
        throw err;
      }
    }
  );

  fastify.post(
    "/admin/bookings/:id/receipt/email",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = bodySchema.parse(request.body ?? {});
      if (!emailConfigured())
        return reply.status(400).send({
          success: false,
          error: "Email isn't set up yet. Download the receipt and send it yourself for now.",
        });

      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
        select: { passenger: { select: { user: { select: { email: true, firstName: true } } } } },
      });
      const to = body.email ?? booking?.passenger?.user?.email ?? null;
      if (!to)
        return reply
          .status(400)
          .send({ success: false, error: "This passenger has no email address on file." });

      try {
        const receipt = await saveReceipt(fastify.prisma, id, { billTo: body.billTo });
        const op = await operatorDetails(fastify.prisma);
        const pdf = await renderReceiptPdf(receipt, op);
        const first = booking?.passenger?.user?.firstName?.trim();
        const text = [
          `Hi${first ? ` ${first}` : ""},`,
          "",
          `Thank you for travelling with ${op.companyName}. Your receipt for booking ${receipt.receiptNumber} is attached.`,
          "",
          `If you have any questions, reply to this email or call us on ${op.contactPhone}.`,
          "",
          op.companyName,
          `TfL private hire operator licence ${op.licenceNumber}`,
        ].join("\n");
        const sent = await sendEmail({
          to,
          subject: `Your ${op.companyName} receipt ${receipt.receiptNumber}`,
          text,
          replyTo: op.contactEmail,
          attachments: [{ filename: receiptFileName(receipt, op), content: pdf }],
        });
        if (!sent.ok) {
          fastify.log.warn(`[Receipt] Email failed for ${receipt.receiptNumber}: ${sent.error}`);
          return reply.status(502).send({ success: false, error: `Email failed: ${sent.error}` });
        }
        return reply.send({ success: true, data: { sentTo: to } });
      } catch (err) {
        if (err instanceof ReceiptError)
          return reply.status(err.statusCode).send({ success: false, error: err.message });
        throw err;
      }
    }
  );
}
