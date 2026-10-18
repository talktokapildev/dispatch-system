"use client";
// admin/src/components/TflComplaintRecord.tsx
//
// TfL complaint / compliment record in the layout of TfL's "COMPLAINT/COMPLIMENT" template, and
// the register (all records in a date range) for an inspection.
// Data: GET /admin/complaints/:id/tfl-record and GET /admin/tfl-records/complaints.
// Shares the print styles of TflDriverRecord and TflLostPropertyRecord.
import { TFL_STYLES } from "./TflDriverRecord";
import { LP_STYLES } from "./TflLostPropertyRecord";

const ADDRESS_LINES = 4;
const DETAIL_LINES = 4;
const ENQUIRY_LINES = 6;
const RESULT_LINES = 4;

const pad = (lines: string[], n: number) => [...lines, ...Array(Math.max(0, n - lines.length)).fill("")];
const linesOf = (s: string | null | undefined) => String(s ?? "").split("\n").filter(Boolean);
const printedText = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="lpField">
      <b className="u">{label}</b>
      <div className="lpValue">{children}</div>
    </div>
  );
}

export function TflComplaintRecord({ data }: { data: any }) {
  const c = data.item;
  const about = [c.driverName && `Driver: ${c.driverName}`, c.vehicleReg && `Vehicle: ${c.vehicleReg}`].filter(Boolean).join(" · ");
  const details = pad(
    [...(c.category ? [`${c.category}:`] : []), ...linesOf(c.details), ...(about ? [about] : [])],
    DETAIL_LINES
  );
  const enquiries = pad(
    (c.enquiries as { at: string; staffName: string; note: string }[]).map((e) => `${e.at} — ${e.staffName}: ${e.note.replace(/\n/g, " ")}`),
    ENQUIRY_LINES
  );
  const result = pad(
    c.result
      ? [
          [c.result.outcome, c.result.at].filter(Boolean).join(" — "),
          ...linesOf(c.result.note),
        ].filter(Boolean)
      : [],
    RESULT_LINES
  );

  return (
    <div className="tfl">
      <style>{TFL_STYLES + LP_STYLES}</style>
      <section className="sheet flow">
        <h1>COMPLAINT/COMPLIMENT</h1>
        <p className="center small">
          <b>{c.typeLabel}</b> · received by {c.channelLabel.toLowerCase()}
        </p>

        <div className="lpRow">
          <Field label="Ref No:">
            <span className="mono">{c.refNo}</span>
          </Field>
          <Field label="Handled By:">{c.handledBy ?? ""}</Field>
        </div>
        <Field label={`Date ${c.typeLabel} received:`}>{c.receivedAt}</Field>
        <Field label="Date and Time of related booking:">
          {c.bookingDateTime ?? ""}
          {c.bookingReference && <span className="muted"> (booking {c.bookingReference})</span>}
        </Field>

        <div className="lpCustomer">
          <b className="u lpCustLabel">Details of {c.type === "COMPLIMENT" ? "Sender" : "Complainant"}:</b>
          <div className="lpCustFields">
            <div className="lpLine">
              <b className="u">NAME:</b> <span>{c.complainant.name ?? ""}</span>
            </div>
            <b className="u">ADDRESS:</b>
            {pad(c.complainant.address, ADDRESS_LINES).map((l: string, n: number) => (
              <div key={n} className="lpRule">{l}</div>
            ))}
            <div className="lpLine">
              <b className="u">PHONE No:</b> <span>{c.complainant.phone ?? ""}</span>
            </div>
          </div>
        </div>

        <p className="lpHead u">Details of {c.typeLabel}:</p>
        {details.map((l, n) => (
          <div key={n} className="lpRule">{l}</div>
        ))}

        <p className="lpHead u">Method/Enquiry to resolve {c.type === "COMPLIMENT" ? "compliment" : "complaint"}:</p>
        {enquiries.map((l, n) => (
          <div key={n} className="lpRule small">{l}</div>
        ))}

        <p className="lpHead u">Result:</p>
        {result.map((l, n) => (
          <div key={n} className="lpRule">{l}</div>
        ))}

        <div className="lpSign">
          <div className="lpLine">
            <b>Company Representative Name:</b> <span>{c.representativeName ?? ""}</span>
          </div>
          <div className="lpLine">
            <b>Company Representative Signature:</b> <span />
          </div>
        </div>

        <p className="footer">
          {data.operator.name} · PHV operator licence {data.operator.licenceNumber} · {c.statusLabel} · Printed{" "}
          {printedText(data.printedAt)}
          {data.printedBy ? ` by ${data.printedBy}` : ""}
        </p>
      </section>
    </div>
  );
}

export function TflComplaintRegister({ data }: { data: any }) {
  const rows: any[] = data.rows;
  const s = data.summary;
  const period =
    data.from && data.to ? `${data.from} to ${data.to}` : data.from ? `from ${data.from}` : data.to ? `to ${data.to}` : "all records";
  return (
    <div className="tfl">
      <style>{TFL_STYLES + LP_STYLES}</style>
      <section className="sheet flow">
        <h1>COMPLAINTS / COMPLIMENTS REGISTER</h1>
        <p className="center small">
          {data.operator.name} · PHV operator licence {data.operator.licenceNumber} · {period}
        </p>
        <p className="center small">
          {s.complaints} complaint{s.complaints === 1 ? "" : "s"} ({s.open} open, {s.upheld} upheld or partly upheld) · {s.compliments}{" "}
          compliment{s.compliments === 1 ? "" : "s"}
        </p>
        <table className="lpTable">
          <thead>
            <tr>
              <th>Ref No</th>
              <th>Received</th>
              <th>Type</th>
              <th>Details</th>
              <th>From</th>
              <th>Driver / vehicle</th>
              <th>Handled by</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">Nothing recorded in this period.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono nowrap">{r.refNo}</td>
                <td className="nowrap">
                  {r.received}
                  <div className="muted">{r.channelLabel.toLowerCase()}</div>
                </td>
                <td>{r.typeLabel}</td>
                <td>
                  {r.category && <b>{r.category}: </b>}
                  {r.details}
                  {r.bookingReference && <div className="muted">booking {r.bookingReference}</div>}
                </td>
                <td>{r.complainantName ?? ""}</td>
                <td>
                  {r.driverName ?? ""}
                  {r.vehicleReg && <div className="mono">{r.vehicleReg}</div>}
                </td>
                <td>{r.handledBy ?? ""}</td>
                <td>
                  {r.status === "RESOLVED" || r.status === "CLOSED" ? (
                    <>
                      {r.outcome ?? r.statusLabel}
                      {r.resolvedAt && <div className="muted">{r.resolvedAt}</div>}
                      {r.resolutionNote && <div>{r.resolutionNote}</div>}
                    </>
                  ) : (
                    <span className={r.replyOverdue ? "bad" : ""}>
                      Open — {r.statusLabel.toLowerCase()}
                      {r.replyOverdue ? " (reply overdue)" : ""}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="footer">
          Printed {printedText(data.printedAt)}
          {data.printedBy ? ` by ${data.printedBy}` : ""}. Each record&apos;s full form (history, result, signature) prints
          from TfL Records → Complaints.
        </p>
      </section>
    </div>
  );
}
