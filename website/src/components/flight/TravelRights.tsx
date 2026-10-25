import {
  CAA_CANCELLATIONS_HREF,
  CAA_DELAYS_HREF,
  duration,
  OGL_CREDIT,
  OGL_HREF,
  PassengerRights,
  TravelAdvice,
} from "@/lib/flightFormat";

// Two flight page cards from UK government sources:
//   RightsCard        "Your rights": UK delay / cancellation rules as the CAA explains them, for a
//                     flight 2+ hours late or cancelled (the backend decides when; always "may").
//   TravelAdviceCard  departures: the FCDO's travel advice for the destination (GOV.UK, Open
//                     Government Licence), with any "advise against travel" warning first.

const care =
  "food and drink, a way to make two calls or send emails, and a hotel with transport if you're stuck overnight";

export function RightsCard({ r, direction }: { r: PassengerRights | null | undefined; direction: "ARRIVAL" | "DEPARTURE" }) {
  if (!r) return null;
  const departure = direction === "DEPARTURE";
  const distance = r.distanceKm != null ? `a ${r.distanceKm.toLocaleString("en-GB")} km flight` : null;
  const late = r.arrivalDelayMin != null ? duration(r.arrivalDelayMin).replace(" min", "m").replace(" h ", "h ") : null;

  const points: { strong: string; rest: string }[] = [];
  if (r.cancelled) {
    points.push({
      strong: "Refund or another flight: your choice.",
      rest: "The airline should also look after you until you travel: " + care + ".",
    });
    points.push({
      strong: "You may be due £110 to £520 per person",
      rest: "if you were told less than 14 days before, unless the cause was outside the airline's control. The amount depends on the distance and the replacement flight's times.",
    });
  } else {
    if (r.compensationGbp != null && late)
      points.push({
        strong: `${r.arrivalDelayFinal ? "Arrived" : "Expected to arrive"} ${late} late: you may be able to claim £${r.compensationGbp} per person.`,
        rest: `UK rules set this for arriving 3 hours or more late${distance ? ` on ${distance}` : ""}.${
          r.arrivalDelayFinal ? "" : " It depends on the final arrival time."
        }`,
      });
    else if (r.compensationIfLateGbp != null)
      points.push({
        strong: `If it arrives 3 hours or more late, you may be able to claim £${r.compensationIfLateGbp} per person.`,
        rest: `${late ? `It's expected about ${late} late at the moment` : "Delays can grow"}${distance ? ` (${distance})` : ""}.`,
      });
    if (departure && r.careFromMin != null)
      points.push(
        r.careDue
          ? { strong: "The airline should be looking after you now:", rest: `${care}. If you have to buy your own, keep the receipts.` }
          : {
              strong: `From ${r.careFromMin / 60} hours late, the airline should look after you:`,
              rest: `${care}.`,
            }
      );
    if (departure && r.refundOption)
      points.push({ strong: "Delayed 5 hours or more:", rest: "you can choose not to travel and get a refund for the unused flights." });
  }
  if (!points.length) return null;

  return (
    <section
      className="flex flex-col gap-[14px] rounded-[22px] border-[1.5px] border-[#f0a73a] bg-[#fffaf0] p-5 sm:p-[26px]"
      aria-labelledby="rights-heading"
    >
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-extrabold tracking-[0.08em] text-accent-dark">
          {r.cancelled ? "FLIGHT CANCELLED" : "BADLY DELAYED?"}
        </span>
        <h2 id="rights-heading" className="m-0 font-heading text-[24px] font-bold tracking-[-0.02em] text-ink sm:text-[26px]">
          Your rights under UK rules
        </h2>
      </div>
      <ul className="m-0 flex list-none flex-col gap-3 p-0 text-[16px] text-soft">
        {points.map((p) => (
          <li key={p.strong} className="grid grid-cols-[22px_1fr] gap-[10px]">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mt-[2px]">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span>
              <strong className="text-ink">{p.strong}</strong> {p.rest}
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 text-[14px] text-[#78350f]">
        {r.covered === "YES"
          ? "These rules cover every flight leaving the UK, on any airline."
          : "These rules cover flights into the UK on a UK or EU airline (and every flight leaving the UK)."}{" "}
        Compensation isn&apos;t automatic: claim from the airline. It isn&apos;t due when the cause was outside the airline&apos;s
        control, such as extreme weather or air traffic control strikes. Our times are estimates until the flight lands.
      </p>
      <p className="m-0 text-[14px]">
        <a href={r.cancelled ? CAA_CANCELLATIONS_HREF : CAA_DELAYS_HREF} className="font-bold" rel="noopener">
          {r.cancelled ? "CAA: your rights when a flight is cancelled" : "CAA: your rights when a flight is delayed"}
        </a>
      </p>
    </section>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function ukDay(iso: string): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${Number(g("day"))} ${MONTHS[Number(g("month")) - 1]} ${g("year")}`;
}

// GOV.UK's short country names that read with "the" in a sentence ("parts of the USA").
const WITH_THE = new Set(["USA", "Netherlands", "Philippines", "Maldives", "Bahamas", "Gambia", "Seychelles", "Comoros", "United Arab Emirates", "Vatican City"]);
export const theName = (n: string) => (WITH_THE.has(n) || /(Islands|Republic)$/.test(n) || /^Democratic Republic/.test(n) ? `the ${n}` : n);

const WARNING: Record<Exclude<TravelAdvice["level"], "NONE">, { text: (n: string) => string; strong: boolean }> = {
  WHOLE_ALL: { text: (n) => `The FCDO advises against all travel to ${n}.`, strong: true },
  WHOLE_ESSENTIAL: { text: (n) => `The FCDO advises against all but essential travel to ${n}.`, strong: true },
  PARTS_ALL: { text: (n) => `The FCDO advises against all travel to parts of ${n}.`, strong: false },
  PARTS_ESSENTIAL: { text: (n) => `The FCDO advises against all but essential travel to parts of ${n}.`, strong: false },
};

export function TravelAdviceCard({ a }: { a: TravelAdvice | null | undefined }) {
  if (!a) return null;
  const w = a.level !== "NONE" ? WARNING[a.level] : null;
  const name = theName(a.name);
  return (
    <section className="flex flex-col gap-[14px] rounded-[22px] border border-line bg-white p-5 sm:p-[26px]" aria-labelledby="advice-heading">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-extrabold tracking-[0.08em] text-accent-dark">BEFORE YOU FLY</span>
        <h2 id="advice-heading" className="m-0 font-heading text-[24px] font-bold tracking-[-0.02em] text-ink sm:text-[26px]">
          UK travel advice for {name}
        </h2>
      </div>
      {w && (
        <p
          className={`m-0 rounded-[16px] border-[1.5px] px-4 py-3 text-[16px] ${
            w.strong ? "border-[#fca5a5] bg-[#fef2f2] text-[#7f1d1d]" : "border-[#f0a73a] bg-[#fdf0d8] text-[#7c2d12]"
          }`}
        >
          <strong>{w.text(name)}</strong> Read which areas and why before you go. Travelling against FCDO advice can affect your travel
          insurance.
        </p>
      )}
      {a.changeDescription && (
        <p className="m-0 text-[16px] text-soft">
          <strong className="text-ink">{a.updatedAt ? `Updated ${ukDay(a.updatedAt)}:` : "Latest update:"}</strong> {a.changeDescription}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <a
          href={a.url}
          rel="noopener"
          className="inline-flex min-h-[44px] items-center rounded-full border-[1.5px] border-[#cbd5e1] bg-white px-4 font-bold text-ink no-underline hover:border-[#94a3b8] hover:text-ink"
        >
          Read the full advice on GOV.UK
        </a>
        {a.entryUrl && (
          <a
            href={a.entryUrl}
            rel="noopener"
            className="inline-flex min-h-[44px] items-center rounded-full border-[1.5px] border-[#cbd5e1] bg-white px-4 font-bold text-ink no-underline hover:border-[#94a3b8] hover:text-ink"
          >
            Entry requirements
          </a>
        )}
      </div>
      <p className="m-0 text-[13px] text-muted">
        From the Foreign, Commonwealth &amp; Development Office on GOV.UK.{" "}
        <a href={OGL_HREF} rel="noopener license" className="font-semibold">
          {OGL_CREDIT}
        </a>
      </p>
    </section>
  );
}
