"use client";
// admin/src/components/TflDriverRecord.tsx
//
// TfL driver record in the layout of TfL's "PRIVATE HIRE DRIVER" template (A4 sheet), followed by
// copies of the driving licence and private hire licence ("enclosed") on their own pages.
// Data: GET /admin/drivers/:id/tfl-record. Used by the TfL Records page; printing hides the admin
// chrome (sidebar, top bar, anything with class "no-print").
// Document links are signed and expire after 10 minutes: reload before printing much later.

type Part = { type: string; label: string; state: string; approvedAt: string | null; expiryDate: string | null; pages: string[] };
type Enclosure = { title: string; onFile: boolean; parts: Part[] };

const isPdf = (url: string) => /\.pdf(\?|$)/i.test(url);
const MIN_RESTART_ROWS = 6;

export function TflDriverRecord({ data }: { data: any }) {
  const d = data.driver;
  const restarts: { restart: string | null; finish: string | null }[] = data.dates.restarts;
  const rows = [...restarts, ...Array(Math.max(0, MIN_RESTART_ROWS - restarts.length)).fill({ restart: null, finish: null })];
  const printed = new Date(data.printedAt).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const ins = data.checks.insurance;
  const insOk = ins && ins.state === "valid";
  const pageCopies = (data.enclosures as Enclosure[]).flatMap((e) =>
    e.parts.flatMap((p) => p.pages.map((url, i) => ({ url, caption: `${p.label}${p.pages.length > 1 ? ` — page ${i + 1}` : ""}` })))
  );

  return (
    <div className="tfl">
      <style>{TFL_STYLES}</style>
      <section className="sheet">
        <h1>PRIVATE HIRE DRIVER</h1>
        <p className="note">
          Have you checked the Hire &amp; Reward Insurance correctly? Has the driver handed you the receipt.
        </p>
        <p className="note">All legitimate Insurance brokers issue receipts. Remember you have a duty of care!</p>
        <p className="note">Ensure driver address details are the same on all documents!</p>
        <p className={`fact ${insOk ? "" : "bad"}`}>
          {ins
            ? `Hire & reward insurance (${ins.vehicleReg}): ${
                ins.state === "valid" ? "approved copy on file" : ins.state.replace("_", " ")
              }${ins.expiryDate ? `, expires ${ins.expiryDate}` : ""}`
            : "Hire & reward insurance: no current vehicle assigned"}
        </p>

        <div className="top">
          <div className="fields">
            <h2>Driver Information</h2>
            <Line label="Surname:" value={d.surname} tall />
            <Line label="First & Middle Names:" value={d.firstAndMiddleNames} tall />
          </div>
          <div className="photo">
            <div className="photoBox">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {d.photoUrl ? <img src={d.photoUrl} alt="Driver" /> : <span className="muted">Photo</span>}
            </div>
            <div className="callSign">
              <b>Call Sign</b> <span>{d.callSign ?? ""}</span>
            </div>
          </div>
        </div>

        <div className="address">
          <span className="label">Address:</span>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="addrLine">{d.address[i] ?? ""}</div>
          ))}
          {d.address.length > 4 && <div className="addrLine">{d.address.slice(4).join(", ")}</div>}
        </div>
        <Line label="Post Code:" value={d.postcode} />
        <Line label="Date of Birth:" value={d.dateOfBirth} />
        <Line label="National Insurance No:" value={d.niNumber} />
        <Line label="Private Hire Licence No:" value={d.privateHireLicenceNo ? `${d.privateHireLicenceNo}  (expires ${d.privateHireLicenceExpiry})` : null} />
        <Line label="Date first Available:" value={data.dates.firstAvailable} />
        <Line label="Date of Leaving:" value={data.dates.dateOfLeaving} />

        {(data.enclosures as Enclosure[]).map((e) => (
          <p key={e.title} className="enclosed">
            <b>Must have a Copy of {e.title} Enclosed:</b>{" "}
            {e.parts.map((p, i) => (
              <span key={p.type} className={p.pages.length ? "ok" : "bad"}>
                {i > 0 ? " · " : ""}
                {e.parts.length > 1 ? `${p.label.replace(/^.*\((.*)\)$/, "$1")}: ` : ""}
                {p.pages.length
                  ? `✓ on file${p.approvedAt ? `, approved ${p.approvedAt}` : ""}${p.expiryDate ? `, expires ${p.expiryDate}` : ""}`
                  : "✗ missing"}
              </span>
            ))}
          </p>
        ))}

        <h2 className="center">Driver Restart Details</h2>
        <p className="center small">Subject to above details remaining unchanged</p>
        <p className="center red">Remember to check driver licence details at regular intervals</p>
        <p className={`center small ${data.checks.licenceCheckDue ? "bad" : ""}`}>
          DVLA licence last checked: {data.checks.licenceCheckedAt ?? "not recorded"}
          {data.checks.licenceCheckDue ? " — check due" : ""}
        </p>

        <table className="restarts">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <b>Restart Date</b> <span className="dots">{r.restart ?? ""}</span>
                </td>
                <td>
                  <b>Finish Date</b> <span className="dots">{r.finish ?? ""}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="footer">
          {data.operator.name} · PHV operator licence {data.operator.licenceNumber} · Printed {printed}
          {data.printedBy ? ` by ${data.printedBy}` : ""}
        </p>
      </section>

      {pageCopies.map((c, i) => (
        <section key={i} className="sheet copy">
          <p className="copyTitle">
            {d.firstAndMiddleNames} {d.surname} — {c.caption}
          </p>
          {isPdf(c.url) ? (
            <p className="muted">
              PDF copy on file — open it from the driver&apos;s Documents and print it with this record.{" "}
              <a href={c.url} target="_blank" rel="noreferrer" className="no-print">Open PDF</a>
            </p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.url} alt={c.caption} />
          )}
        </section>
      ))}
    </div>
  );
}

function Line({ label, value, tall }: { label: string; value: string | null | undefined; tall?: boolean }) {
  return (
    <div className={`line ${tall ? "tall" : ""}`}>
      <span className="label">{label}</span>
      <span className="value">{value ?? ""}</span>
    </div>
  );
}

const TFL_STYLES = `
        .tfl { font-family: Arial, Helvetica, sans-serif; color: #000; background: #e5e5e5; padding: 16px 0 24px; border-radius: 12px; overflow-x: auto; }
        .tfl .sheet { background: #fff; width: 210mm; min-height: 297mm; margin: 0 auto 16px; padding: 12mm 16mm 10mm; box-sizing: border-box; box-shadow: 0 1px 6px rgba(0,0,0,.15); }
        .tfl h1 { text-align: center; font-size: 20px; font-weight: bold; text-decoration: underline; margin: 0 0 8px; }
        .tfl h2 { font-size: 15px; font-weight: bold; margin: 8px 0 4px; }
        .tfl .note { font-size: 12.5px; margin: 3px 0; }
        .tfl .fact { font-size: 11.5px; margin: 6px 0 0; color: #166534; }
        .tfl .bad { color: #b91c1c !important; }
        .tfl .ok { color: #166534; }
        .tfl .muted { color: #666; font-size: 12px; }
        .tfl .top { display: flex; gap: 16px; align-items: flex-start; }
        .tfl .fields { flex: 1; }
        .tfl .photo { width: 46mm; border: 1px solid #000; }
        .tfl .photoBox { height: 46mm; display: flex; align-items: center; justify-content: center; overflow: hidden; border-bottom: 1px solid #000; }
        .tfl .photoBox img { width: 100%; height: 100%; object-fit: cover; }
        .tfl .callSign { padding: 6px 8px; font-size: 13px; display: flex; justify-content: space-between; }
        .tfl .line { display: flex; align-items: flex-end; gap: 12px; margin: 7px 0; font-size: 13px; }
        .tfl .line.tall { flex-direction: column; align-items: stretch; gap: 2px; }
        .tfl .label { font-weight: bold; min-width: 52mm; }
        .tfl .value { flex: 1; border-bottom: 1px solid #000; min-height: 18px; padding: 0 4px 2px; font-size: 13.5px; }
        .tfl .address { margin: 6px 0; font-size: 13px; }
        .tfl .addrLine { border-bottom: 1px solid #000; min-height: 18px; padding: 1px 4px; font-size: 13.5px; }
        .tfl .enclosed { font-size: 12.5px; margin: 6px 0; }
        .tfl .center { text-align: center; }
        .tfl .small { font-size: 12px; margin: 2px 0; }
        .tfl .red { color: #dc2626; font-weight: bold; font-size: 13px; margin: 6px 0 2px; }
        .tfl .restarts { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 13px; }
        .tfl .restarts td { padding: 5px 4px; width: 50%; }
        .tfl .dots { display: inline-block; min-width: 40mm; border-bottom: 1px dotted #000; padding: 0 4px; }
        .tfl .footer { margin-top: 12px; font-size: 10.5px; color: #555; border-top: 1px solid #ccc; padding-top: 6px; }
        .tfl .copy img { max-width: 100%; max-height: 250mm; display: block; margin: 8px auto 0; }
        .tfl .copyTitle { font-weight: bold; font-size: 13px; margin: 0 0 6px; }
        @page { size: A4; margin: 0; }
        @media print {
          /* print only the record: hide the admin sidebar, top bar and page controls */
          html, body, body * { background: transparent !important; }
          aside, header, .no-print { display: none !important; }
          main { padding: 0 !important; }
          .tfl { padding: 0; margin: 0 !important; border-radius: 0; overflow: visible; }
          .tfl .sheet { background: #fff !important; }
          .tfl .no-print { display: none !important; }
          .tfl .sheet { box-shadow: none; margin: 0; height: 297mm; min-height: 0; overflow: hidden; page-break-after: always; break-after: page; }
          .tfl .sheet:last-child { page-break-after: auto; break-after: auto; }
        }
      `;
