// backend/src/services/receipt.service.ts
//
// Passenger receipts for completed bookings (admin "Receipt" / "Email receipt").
//
// - saveReceipt(): snapshots the booking into the Receipt table (one per booking; receipt number =
//   booking reference). Generating again refreshes the snapshot from the booking (e.g. after a fare
//   correction or a new "Bill to"), but keeps the receipt number and first issue date.
// - renderReceiptPdf(): draws the PDF from a Receipt row, so the same receipt always looks the same.
//
// Times are shown in UK time. Operator details come from Settings (SystemSetting), with defaults.
import path from "path";
import fs from "fs";
import PDFDocument from "pdfkit";
import type { PrismaClient, Receipt } from "@prisma/client";

const LOGO_PATH = path.join(__dirname, "../../assets/receipt-logo.png");

const DEFAULTS: Record<string, string> = {
  companyName: "OrangeRide",
  operatorLegalName: "Kapil Dev",
  licenceNumber: "11786",
  contactPhone: "07398 341839",
  contactEmail: "admin@orangeride.co.uk",
  businessAddress: "Unit 2, 12 Deer Park Road, South Wimbledon, London SW19 3TL",
  website: "orangeride.co.uk",
};

export type OperatorDetails = typeof DEFAULTS;

export async function operatorDetails(prisma: PrismaClient): Promise<OperatorDetails> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: Object.keys(DEFAULTS) } },
  });
  const out: Record<string, string> = { ...DEFAULTS };
  for (const r of rows) if (r.value?.trim()) out[r.key] = r.value.trim();
  return out as OperatorDetails;
}

export class ReceiptError extends Error {
  statusCode = 400;
}

const PAYMENT_LABEL: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  APPLE_PAY: "Apple Pay",
  GOOGLE_PAY: "Google Pay",
  ACCOUNT: "Account",
};

/** Create or refresh the receipt snapshot for a completed booking. */
export async function saveReceipt(
  prisma: PrismaClient,
  bookingId: string,
  opts: { billTo?: string | null } = {}
): Promise<Receipt> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      passenger: { include: { user: true } },
      driver: { include: { user: true, vehicle: true } },
      receipt: true,
    },
  });
  if (!booking) throw new ReceiptError("Booking not found");
  if (booking.status !== "COMPLETED")
    throw new ReceiptError("Receipts are only available for completed trips");

  const op = await operatorDetails(prisma);
  const fare = booking.actualFare ?? booking.fixedPriceOverride ?? booking.estimatedFare;
  const tip = booking.tipAmount ?? 0;
  const cash = booking.paymentMethod === "CASH" ? booking.actualCashCollected : null;
  const walletCredit = cash !== null && cash !== undefined ? Math.max(0, fare - cash) : 0;
  const v = booking.driver?.vehicle;
  const passengerName = [booking.passenger?.user?.firstName, booking.passenger?.user?.lastName]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const billTo =
    opts.billTo === undefined ? booking.receipt?.billTo ?? null : opts.billTo?.trim() || null;

  const data = {
    receiptNumber: booking.reference,
    operatorName: `${op.operatorLegalName} t/a ${op.companyName}`,
    operatorLicenseNumber: op.licenceNumber,
    operatorAddress: op.businessAddress,
    driverName: booking.driver
      ? `${booking.driver.user.firstName} ${booking.driver.user.lastName ?? ""}`.trim()
      : "",
    driverPcoBadge: booking.driver?.pcoBadgeNumber ?? "",
    vehiclePlate: v?.licensePlate ?? "",
    vehicleDescription: v ? `${v.make} ${v.model}`.trim() : "",
    pickupAddress: booking.pickupAddress,
    dropoffAddress: booking.dropoffAddress,
    pickupAt: booking.tripStartedAt ?? booking.scheduledAt ?? booking.createdAt,
    dropoffAt: booking.completedAt,
    tripDistance: booking.actualDistance,
    tripDuration: booking.actualDuration,
    fareBreakdown: {
      fare,
      tip,
      walletCredit,
      pricingType: booking.pricingType,
    },
    totalAmount: Math.round((fare + tip) * 100) / 100,
    paymentMethod: booking.paymentMethod,
    passengerName: passengerName || null,
    billTo,
  };

  return prisma.receipt.upsert({
    where: { bookingId },
    create: { bookingId, ...data },
    update: data,
  });
}

// ── PDF ──────────────────────────────────────────────────────────────────────

const INK = "#2e3238";
const BODY = "#4b5563";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const ACCENT = "#b45309";
const SOFT = "#f1f5f9";

const ukDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
const ukTime = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
const ukDay = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
const money = (n: number) => `£${n.toFixed(2)}`;

/** Draw the receipt PDF. Resolves with the PDF bytes. */
export function renderReceiptPdf(r: Receipt, op: OperatorDetails): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 56,
      info: { Title: `${op.companyName} receipt ${r.receiptNumber}`, Author: op.companyName },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width;
    const M = 56;
    const right = W - M;
    let y = M;

    // Header: logo + title
    if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, M, y, { width: 170 });
    else doc.font("Helvetica-Bold").fontSize(22).fillColor(INK).text(op.companyName, M, y);
    doc.font("Helvetica-Bold").fontSize(24).fillColor(INK).text("Receipt", M, y, {
      width: right - M,
      align: "right",
    });
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(MUTED)
      .text(`No. ${r.receiptNumber}  ·  Issued ${ukDay(r.issuedAt)}`, M, y + 30, {
        width: right - M,
        align: "right",
      });

    // Operator block
    y += 70;
    doc.font("Helvetica").fontSize(9.5).fillColor(BODY);
    const opLines = [
      `${op.companyName} is a trading name of ${op.operatorLegalName}`,
      `TfL private hire operator licence ${r.operatorLicenseNumber}`,
      `Operating centre: ${r.operatorAddress ?? op.businessAddress}`,
      `${op.contactEmail}  ·  ${op.contactPhone}  ·  ${op.website}`,
    ];
    for (const l of opLines) {
      doc.text(l, M, y);
      y += 14;
    }
    y += 10;
    doc.moveTo(M, y).lineTo(right, y).lineWidth(1).strokeColor(LINE).stroke();

    // Details
    const row = (label: string, value: string, bold = false) => {
      y += 22;
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(label.toUpperCase(), M, y + 2);
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(11.5)
        .fillColor(INK)
        .text(value, M + 140, y, { width: right - M - 140 });
    };
    y += 8;
    if (r.passengerName) row("Passenger", r.passengerName, true);
    if (r.billTo) row("Bill to", r.billTo, !r.passengerName);
    const pickupAt = r.pickupAt ?? r.issuedAt;
    row("Journey date", ukDate(pickupAt));
    if (r.driverName)
      row("Driver", r.driverPcoBadge ? `${r.driverName} (PCO ${r.driverPcoBadge})` : r.driverName);
    if (r.vehiclePlate || r.vehicleDescription)
      row(
        "Vehicle",
        [r.vehicleDescription, r.vehiclePlate].filter(Boolean).join("  ·  ")
      );

    // Journey box
    y += 34;
    const boxH = 92;
    doc.roundedRect(M, y, right - M, boxH, 10).fillColor(SOFT).fill();
    const stop = (dy: number, label: string, time: string, addr: string) => {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(ACCENT).text(label, M + 18, y + dy + 2);
      doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(time, M + 100, y + dy);
      doc
        .font("Helvetica")
        .fontSize(12)
        .fillColor(INK)
        .text(addr, M + 150, y + dy, { width: right - M - 168, height: 30, ellipsis: true });
    };
    stop(18, "PICKUP", ukTime(pickupAt), r.pickupAddress);
    stop(58, "DROP-OFF", r.dropoffAt ? ukTime(r.dropoffAt) : "", r.dropoffAddress);
    y += boxH;

    // Fare table
    const fb = (r.fareBreakdown ?? {}) as {
      fare?: number;
      tip?: number;
      walletCredit?: number;
      pricingType?: string;
    };
    const fare = fb.fare ?? r.totalAmount;
    y += 34;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("DESCRIPTION", M, y);
    doc.text("AMOUNT", M, y, { width: right - M, align: "right" });
    y += 14;
    doc.moveTo(M, y).lineTo(right, y).strokeColor(LINE).stroke();
    const line = (label: string, amount: string) => {
      y += 12;
      doc.font("Helvetica").fontSize(11.5).fillColor(INK).text(label, M, y);
      doc.text(amount, M, y, { width: right - M, align: "right" });
      y += 14;
    };
    line(
      fb.pricingType === "METERED" ? "Private hire journey" : "Private hire journey, fixed fare",
      money(fare)
    );
    if (fb.tip) line("Tip", money(fb.tip));
    if (fb.walletCredit) line("Paid from OrangeRide wallet credit", `-${money(fb.walletCredit)}`);
    y += 6;
    doc.moveTo(M, y).lineTo(right, y).strokeColor(LINE).stroke();

    const paidNow = Math.max(0, r.totalAmount - (fb.walletCredit ?? 0));
    y += 16;
    const isAccount = r.paymentMethod === "ACCOUNT";
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor(INK)
      .text(isAccount ? "Total" : "Total paid", M, y);
    doc.text(money(paidNow), M, y, { width: right - M, align: "right" });
    y += 24;
    const method = PAYMENT_LABEL[r.paymentMethod] ?? r.paymentMethod;
    doc
      .font("Helvetica")
      .fontSize(10.5)
      .fillColor(BODY)
      .text(
        isAccount
          ? "Payment: charged to account (invoiced separately)"
          : `Payment method: ${method}  ·  Paid in full`,
        M,
        y
      );
    y += 16;
    doc.text("Not VAT registered. No VAT charged.", M, y);

    // Footer
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(MUTED)
      .text(
        `Thank you for travelling with ${op.companyName}. Questions about this receipt? ${op.contactEmail}`,
        M,
        doc.page.height - M - 12,
        { width: right - M, align: "center", lineBreak: false }
      );

    doc.end();
  });
}

export function receiptFileName(r: Receipt, op: OperatorDetails): string {
  return `${op.companyName}-receipt-${r.receiptNumber}.pdf`.replace(/[^A-Za-z0-9._-]/g, "-");
}
