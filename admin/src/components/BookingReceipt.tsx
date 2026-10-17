"use client";
// Receipt panel on a completed booking: optional "Bill to", download PDF, email to passenger.
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { FileDown, Mail } from "lucide-react";
import { api } from "@/lib/api";

/** Axios error from a blob request → readable message. */
async function blobError(err: any, fallback: string): Promise<string> {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text()).error ?? fallback;
    } catch {
      return fallback;
    }
  }
  return data?.error ?? fallback;
}

export function BookingReceipt({ booking }: { booking: any }) {
  const [billTo, setBillTo] = useState<string>(booking.receipt?.billTo ?? "");
  useEffect(() => setBillTo(booking.receipt?.billTo ?? ""), [booking.id, booking.receipt?.billTo]);
  const email: string | undefined = booking.passenger?.user?.email || undefined;
  const body = { billTo: billTo.trim() || null };

  const download = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/admin/bookings/${booking.id}/receipt`, body, {
        responseType: "blob",
      });
      const name =
        /filename="([^"]+)"/.exec(res.headers["content-disposition"] ?? "")?.[1] ??
        `receipt-${booking.reference}.pdf`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    onError: async (err) => toast.error(await blobError(err, "Could not create the receipt")),
  });

  const send = useMutation({
    mutationFn: () => api.post(`/admin/bookings/${booking.id}/receipt/email`, body),
    onSuccess: (res) => toast.success(`Receipt emailed to ${res.data.data.sentTo}`),
    onError: (err: any) => toast.error(err.response?.data?.error ?? "Could not email the receipt"),
  });

  return (
    <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)] text-xs space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-slate-500">Receipt</p>
      <div>
        <label className="text-slate-500 block mb-1" htmlFor="receipt-bill-to">
          Bill to (optional, e.g. company name for expenses)
        </label>
        <input
          id="receipt-bill-to"
          className="input"
          maxLength={120}
          placeholder="Company name"
          value={billTo}
          onChange={(e) => setBillTo(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => download.mutate()}
          disabled={download.isPending}
          className="btn-primary flex-1 flex items-center justify-center gap-1.5"
        >
          <FileDown size={13} /> {download.isPending ? "Preparing…" : "Download receipt"}
        </button>
        <button
          type="button"
          onClick={() => send.mutate()}
          disabled={send.isPending || !email}
          title={email ? `Send to ${email}` : "No email address on this passenger"}
          className="btn-ghost flex-1 flex items-center justify-center gap-1.5 border border-[var(--border)]"
        >
          <Mail size={13} /> {send.isPending ? "Sending…" : "Email receipt"}
        </button>
      </div>
      <p className="text-slate-500">
        {booking.receipt
          ? `Receipt ${booking.receipt.receiptNumber} first issued ${new Date(
              booking.receipt.issuedAt
            ).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}. `
          : ""}
        {email ? `Email goes to ${email}.` : "Add an email to the passenger to send it from here."}
      </p>
    </div>
  );
}
