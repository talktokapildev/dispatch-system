import { h2 } from "./ui";

const ARRIVALS = [
  {
    q: "Why are \"lands\" and \"at the gate\" different?",
    a: "After touching down, the plane still has to taxi to its stand. At Gatwick that usually takes about 5 to 10 minutes. Airport screens show the time at the gate.",
  },
  {
    q: "How long until they come out of arrivals?",
    a: "Usually around 30 minutes after the plane reaches the gate with hand luggage, and 45 minutes with a suitcase. Passport queues can add more at busy times.",
  },
];
const DEPARTURES = [
  {
    q: "When is the gate shown?",
    a: "Gatwick usually puts the gate on the departure screens about 40 minutes before take-off. Until then, wait in the departure lounge.",
  },
  {
    q: "How early should I get to the airport?",
    a: "Two hours before a short-haul flight is a safe rule, and three for long-haul. Your airline's bag drop closing time is the real deadline, so check it on your booking.",
  },
];
const BOTH = [
  {
    q: "North or South Terminal?",
    a: "It depends on the airline, so check before you set off. A free shuttle train links the two terminals and takes a few minutes.",
  },
  {
    q: "How up to date is this?",
    a: "We update Gatwick's flights regularly through the day, and the page refreshes itself while it's open. Times can change quickly, so always check with your airline too.",
  },
];

export default function FlightFaq({ only }: { only?: "ARRIVAL" | "DEPARTURE" }) {
  const items = [...(only !== "DEPARTURE" ? ARRIVALS : []), ...(only !== "ARRIVAL" ? DEPARTURES : []), ...BOTH];
  return (
    <section className="flex flex-col gap-3" aria-labelledby="faq-heading">
      <h2 id="faq-heading" className={h2}>
        Good to know
      </h2>
      <div className="grid gap-[10px] md:grid-cols-2">
        {items.map((f) => (
          <details key={f.q} className="rounded-[20px] border border-line bg-white">
            <summary className="flex min-h-[44px] justify-between gap-4 rounded-[20px] px-5 py-[18px] text-[17px] font-extrabold text-ink">
              {f.q}
              <span aria-hidden className="faq-plus text-[24px] leading-none text-[#d97706] transition-transform">
                +
              </span>
            </summary>
            <p className="m-0 -mt-2 px-5 pb-5">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
