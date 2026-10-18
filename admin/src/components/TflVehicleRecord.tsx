"use client";
// admin/src/components/TflVehicleRecord.tsx
//
// TfL vehicle record in the layout of TfL's "VEHICLE DETAILS" template, then an "OrangeRide
// record" section (PHV vehicle licence, who drove the car and when), then the attached copies
// (MOT, insurance, V5C, PHV licence) on their own pages.
// Data: GET /admin/vehicles/:id/tfl-record. Shares the print styles of TflDriverRecord.
import { TFL_STYLES } from "./TflDriverRecord";

type Enclosure = {
  type: string;
  title: string;
  label: string;
  onTemplate: boolean;
  state: string;
  approvedAt: string | null;
  expiryDate: string | null;
  pages: string[];
};

const isPdf = (url: string) => /\.pdf(\?|$)/i.test(url);
const MIN_PERIOD_ROWS = 2;
const KEEPER_LINES = 6;

function YesNo({ e }: { e?: Enclosure }) {
  const yes = !!e && e.pages.length > 0;
  return (
    <span className="yesno">
      <span className={yes ? "pick" : "nopick"}>YES</span> / <span className={!yes ? "pick bad" : "nopick"}>NO</span>
      {e && yes && e.expiryDate && <span className="small muted"> (expires {e.expiryDate})</span>}
    </span>
  );
}

export function TflVehicleRecord({ data }: { data: any }) {
  const v = data.vehicle;
  const enc: Record<string, Enclosure> = Object.fromEntries((data.enclosures as Enclosure[]).map((e) => [e.type, e]));
  const periods: { start: string | null; ceased: string | null }[] = [
    ...data.periods,
    ...Array(Math.max(0, MIN_PERIOD_ROWS - data.periods.length)).fill({ start: null, ceased: null }),
  ];
  const keeper: string[] = [...v.keeper, ...Array(Math.max(0, KEEPER_LINES - v.keeper.length)).fill("")];
  const printed = new Date(data.printedAt).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const phv = enc.PHV_LICENCE;
  const copies = (data.enclosures as Enclosure[]).flatMap((e) =>
    e.pages.map((url, i) => ({ url, caption: `${e.label}${e.pages.length > 1 ? ` — page ${i + 1}` : ""}` }))
  );

  return (
    <div className="tfl">
      <style>{TFL_STYLES + VEHICLE_STYLES}</style>
      <section className="sheet flow">
        <h1>VEHICLE DETAILS</h1>
        <p className="vlabel">Vehicle Records</p>
        <table className="vgrid">
          <tbody>
            <tr>
              <td><b className="u">Make of Car:</b><div className="cell">{v.make}</div></td>
              <td><b className="u">Model:</b><div className="cell">{v.model}</div></td>
            </tr>
            <tr>
              <td><b className="u">Registration No:</b><div className="cell mono">{v.registration}</div></td>
              <td><b className="u">Colour:</b><div className="cell">{v.colour}</div></td>
            </tr>
          </tbody>
        </table>

        <p className="vlabel u">Name &amp; Address of Keeper:</p>
        {keeper.map((line, i) => (
          <div key={i} className="kline">{line}</div>
        ))}

        <table className="vgrid periods">
          <tbody>
            {periods.map((p, i) => (
              <tr key={i}>
                <td><b className="u">Start Date</b> <span className="dots">{p.start ?? ""}</span></td>
                <td><b className="u">Vehicle Ceased</b> <span className="dots">{p.ceased ?? ""}</span></td>
              </tr>
            ))}
            <tr>
              <td><b className="u">Copy of MOT enclosed</b> <YesNo e={enc.MOT_CERTIFICATE} /></td>
              <td><b className="u">Copy of Insurance enclosed</b> <YesNo e={enc.VEHICLE_INSURANCE} /></td>
            </tr>
            <tr>
              <td colSpan={2}><b className="u">Copy of Vehicle Registration Document Enclosed</b> <YesNo e={enc.V5C_LOGBOOK} /></td>
            </tr>
          </tbody>
        </table>

        <p className="vlabel u attached">ATTACHED DOCUMENTS</p>
        <p className="att"><b className="u">MOT CERTIFICATE</b> <span className="red">Renewable 6 months after PCO inspection</span></p>
        <p className="att"><b className="u">INSURANCE DOCUMENT</b> <span className="red">Insurance Cover notes should be kept for 6 months whilst vehicle is in service.</span></p>
        <p className="green">All driver and vehicle records must be kept for a minimum of 12 months after a driver has left your Employment.</p>

        <div className="orx">
          <p className="orxTitle">OrangeRide record</p>
          <p className="small">
            <b>PHV vehicle licence:</b> {v.phvLicenceNumber ?? "—"}
            {v.phvLicenceExpiry ? ` (expires ${v.phvLicenceExpiry})` : ""} · <b>Disc:</b> {v.phvDiscNumber ?? "—"} ·{" "}
            <b>Copy on file:</b> <YesNo e={phv} />
          </p>
          <table className="drivers">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Call sign</th>
                <th>From</th>
                <th>To</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {data.drivers.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">No driver has been assigned this vehicle.</td>
                </tr>
              )}
              {data.drivers.map((d: any, i: number) => (
                <tr key={i}>
                  <td>{d.name}</td>
                  <td>{d.callSign ?? ""}</td>
                  <td>{d.from}</td>
                  <td>{d.to ?? "current"}</td>
                  <td>{d.reason ?? d.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="footer">
          {data.operator.name} · PHV operator licence {data.operator.licenceNumber} · Printed {printed}
          {data.printedBy ? ` by ${data.printedBy}` : ""}
        </p>
      </section>

      {copies.map((c, i) => (
        <section key={i} className="sheet copy">
          <p className="copyTitle">
            {v.registration} — {c.caption}
          </p>
          {isPdf(c.url) ? (
            <p className="muted">
              PDF copy on file — open it from the vehicle&apos;s Documents and print it with this record.{" "}
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

const VEHICLE_STYLES = `
  .tfl .vlabel { font-size: 12.5px; font-weight: bold; margin: 10px 0 2px 12px; }
  .tfl .u { text-decoration: underline; }
  .tfl .mono { font-family: "Courier New", monospace; letter-spacing: 1px; }
  .tfl .vgrid { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .tfl .vgrid td { border: 1px solid #000; padding: 6px 10px; vertical-align: top; width: 50%; }
  .tfl .vgrid .cell { min-height: 26px; padding-top: 4px; font-size: 14px; }
  .tfl .kline { border-bottom: 1px solid #000; min-height: 22px; padding: 4px 4px 1px; font-size: 13.5px; }
  .tfl .periods { margin-top: 14px; }
  .tfl .periods td { padding: 9px 10px; }
  .tfl .yesno { font-size: 12.5px; margin-left: 6px; }
  .tfl .pick { font-weight: bold; border: 1.5px solid currentColor; border-radius: 10px; padding: 0 5px; }
  .tfl .nopick { color: #999; }
  .tfl .attached { margin-top: 16px; }
  .tfl .att { font-size: 12.5px; margin: 8px 0 0 24px; display: flex; gap: 40px; }
  .tfl .att .red { margin: 0; font-size: 12.5px; }
  .tfl .green { color: #15803d; font-weight: bold; font-size: 12.5px; margin: 10px 0 0 24px; }
  .tfl .orx { margin-top: 18px; border-top: 2px solid #000; padding-top: 6px; }
  .tfl .orxTitle { font-weight: bold; font-size: 13px; margin: 0 0 4px; }
  .tfl .drivers { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-top: 6px; }
  .tfl .drivers th, .tfl .drivers td { border: 1px solid #999; padding: 3px 6px; text-align: left; }
  .tfl .drivers th { background: #f1f1f1; }
  @media print {
    .tfl .sheet.flow { height: auto; min-height: 0; overflow: visible; }
  }
`;
