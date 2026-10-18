"use client";
// admin/src/components/TflLostPropertyRecord.tsx
//
// TfL lost property record in the layout of TfL's "LOST/FOUND PROPERTY" template, and the
// register (all items in a date range) for an inspection.
// Data: GET /admin/lost-property/:id/tfl-record and GET /admin/tfl-records/lost-property.
// Shares the print styles of TflDriverRecord.
import { TFL_STYLES } from "./TflDriverRecord";

const ADDRESS_LINES = 4;
const DETAIL_LINES = 3;
const ENQUIRY_LINES = 6;
const RESULT_LINES = 3;

const pad = (lines: string[], n: number) => [...lines, ...Array(Math.max(0, n - lines.length)).fill("")];

const printedText = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`lpField${wide ? " wide" : ""}`}>
      <b className="u">{label}</b>
      <div className="lpValue">{children}</div>
    </div>
  );
}

export function TflLostPropertyRecord({ data }: { data: any }) {
  const i = data.item;
  const details = pad(String(i.description ?? "").split("\n").filter(Boolean), DETAIL_LINES);
  const enquiries = pad(
    (i.enquiries as { at: string; staffName: string; note: string }[]).map((e) => `${e.at} — ${e.staffName}: ${e.note}`),
    ENQUIRY_LINES
  );
  const result = pad(
    i.result
      ? [
          `${i.result.label}${i.result.at ? ` — ${i.result.at}` : ""}`,
          ...String(i.result.details ?? "").split("\n").filter(Boolean),
        ]
      : [],
    RESULT_LINES
  );

  return (
    <div className="tfl">
      <style>{TFL_STYLES + LP_STYLES}</style>
      <section className="sheet flow">
        <h1>LOST/FOUND PROPERTY</h1>

        <div className="lpRow">
          <Field label="Ref No:">
            <span className="mono">{i.refNo}</span>
          </Field>
          <Field label="Handed in By:">{i.handedInBy ?? ""}</Field>
        </div>
        <Field label="Vehicle registration (where property found):" wide>
          <span className="mono">{i.vehicleReg ?? ""}</span>
        </Field>
        <Field label="Date Property received:" wide>
          {i.receivedAt ?? (i.status === "REPORTED" ? <span className="muted">Not received — reported missing {i.reportedAt}</span> : "")}
        </Field>
        <Field label="Date and Time of related booking:" wide>
          {i.bookingDateTime ?? ""}
          {i.bookingReference && <span className="muted"> (booking {i.bookingReference})</span>}
        </Field>

        <div className="lpCustomer">
          <b className="u lpCustLabel">Customer Details:</b>
          <div className="lpCustFields">
            <div className="lpLine">
              <b className="u">NAME:</b> <span>{i.customer.name ?? ""}</span>
            </div>
            <b className="u">ADDRESS:</b>
            {pad(i.customer.address, ADDRESS_LINES).map((l, n) => (
              <div key={n} className="lpRule">{l}</div>
            ))}
            <div className="lpLine">
              <b className="u">PHONE No:</b> <span>{i.customer.phone ?? ""}</span>
            </div>
          </div>
        </div>

        <p className="lpHead u">Details of Property:</p>
        {details.map((l, n) => (
          <div key={n} className="lpRule">{l}</div>
        ))}

        <p className="lpHead u">Method/Enquiry to return property:</p>
        {enquiries.map((l, n) => (
          <div key={n} className="lpRule small">{l}</div>
        ))}

        <p className="lpHead u">Result/if disposed of how was it disposed of?</p>
        {result.map((l, n) => (
          <div key={n} className="lpRule">{l}</div>
        ))}

        <div className="lpSign">
          <div className="lpLine">
            <b>Company Representative Name:</b> <span>{i.representativeName ?? ""}</span>
          </div>
          <div className="lpLine">
            <b>Company Representative Signature:</b> <span />
          </div>
        </div>

        <p className="footer">
          {data.operator.name} · PHV operator licence {data.operator.licenceNumber} · {i.statusLabel}
          {i.source === "PASSENGER_REPORT" ? " · reported by the passenger in the app" : ""} · Printed{" "}
          {printedText(data.printedAt)}
          {data.printedBy ? ` by ${data.printedBy}` : ""}
        </p>
      </section>
    </div>
  );
}

export function TflLostPropertyRegister({ data }: { data: any }) {
  const rows: any[] = data.rows;
  const period =
    data.from && data.to ? `${data.from} to ${data.to}` : data.from ? `from ${data.from}` : data.to ? `to ${data.to}` : "all records";
  return (
    <div className="tfl">
      <style>{TFL_STYLES + LP_STYLES}</style>
      <section className="sheet flow">
        <h1>LOST/FOUND PROPERTY REGISTER</h1>
        <p className="center small">
          {data.operator.name} · PHV operator licence {data.operator.licenceNumber} · {period} · {rows.length} item
          {rows.length === 1 ? "" : "s"}
        </p>
        <table className="lpTable">
          <thead>
            <tr>
              <th>Ref No</th>
              <th>Date received</th>
              <th>Vehicle</th>
              <th>Details of property</th>
              <th>Customer</th>
              <th>Handed in by</th>
              <th>Result</th>
              <th>Representative</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">No lost property recorded in this period.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono nowrap">{r.refNo}</td>
                <td className="nowrap">
                  {r.date}
                  {!r.received && <div className="muted">reported missing</div>}
                </td>
                <td className="mono">{r.vehicleReg ?? ""}</td>
                <td>{r.description}</td>
                <td>{r.customerName ?? ""}</td>
                <td>{r.handedInBy ?? ""}</td>
                <td>
                  {r.result ? (
                    <>
                      {r.result}
                      {r.resultAt && <div className="muted">{r.resultAt}</div>}
                    </>
                  ) : (
                    <span className={r.overdue ? "bad" : ""}>Open — {r.statusLabel.toLowerCase()}</span>
                  )}
                </td>
                <td>{r.representativeName ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="footer">
          Printed {printedText(data.printedAt)}
          {data.printedBy ? ` by ${data.printedBy}` : ""}. Each item&apos;s full record (enquiries, result,
          signature) prints from TfL Records → Lost property.
        </p>
      </section>
    </div>
  );
}

const LP_STYLES = `
  .tfl .u { text-decoration: underline; }
  .tfl .mono { font-family: "Courier New", monospace; letter-spacing: 1px; }
  .tfl .nowrap { white-space: nowrap; }
  .tfl .lpRow { display: flex; gap: 24px; }
  .tfl .lpRow .lpField { flex: 1; }
  .tfl .lpField { display: flex; align-items: flex-end; gap: 10px; margin: 12px 0 0; font-size: 13px; }
  .tfl .lpField > b { white-space: nowrap; }
  .tfl .lpValue { flex: 1; border-bottom: 1px solid #000; min-height: 18px; padding: 0 4px 2px; font-size: 13.5px; }
  .tfl .lpCustomer { display: flex; gap: 16px; margin-top: 16px; font-size: 13px; }
  .tfl .lpCustLabel { min-width: 40mm; }
  .tfl .lpCustFields { flex: 1; }
  .tfl .lpLine { display: flex; align-items: flex-end; gap: 10px; margin: 8px 0; font-size: 13px; }
  .tfl .lpLine > span { flex: 1; border-bottom: 1px solid #000; min-height: 18px; padding: 0 4px 2px; font-size: 13.5px; }
  .tfl .lpRule { border-bottom: 1px solid #000; min-height: 20px; padding: 3px 4px 1px; font-size: 13px; }
  .tfl .lpRule.small { font-size: 12px; }
  .tfl .lpHead { font-weight: bold; font-size: 13px; margin: 16px 0 2px; }
  .tfl .lpSign { margin-top: 18px; }
  .tfl .lpSign .lpLine { margin: 14px 0; }
  .tfl .lpSign .lpLine > span { min-height: 26px; }
  .tfl .lpTable { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 10px; }
  .tfl .lpTable th, .tfl .lpTable td { border: 1px solid #999; padding: 4px 5px; text-align: left; vertical-align: top; }
  .tfl .lpTable th { background: #f1f1f1; }
  .tfl .lpTable .muted { font-size: 10px; }
  @media print {
    .tfl .sheet.flow { height: auto; min-height: 0; overflow: visible; }
    .tfl .lpTable tr { break-inside: avoid; }
  }
`;
