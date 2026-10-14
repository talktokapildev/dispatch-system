import { PinIcon, PlaneIcon } from "../Icons";

/**
 * "Flying into Gatwick": static showcase of the app's flight tracking.
 * The example card (<figure>) can later be swapped for a live flight-lookup component.
 */

type Step = { n: number; title: string; text: string; badge: string; active?: boolean };

const STEPS: Step[] = [
  {
    n: 1,
    title: "Enter your flight number and date",
    text: 'Choose a Gatwick terminal as your pickup and the app asks "Arriving on a flight?"',
    badge: "bg-amber text-ink",
    active: true,
  },
  {
    n: 2,
    title: "We find it straight away",
    text: "You'll see the airline, where it's flying from, and the scheduled and expected arrival times.",
    badge: "bg-[#4a3a1c] text-[#fbbf24]",
  },
  {
    n: 3,
    title: "Choose your terminal and luggage",
    text: 'We\'ll show you the exact meeting point and set your pickup time after landing. Allow longer if you\'re collecting checked bags. Need longer still? Tap "Need more time?"',
    badge: "bg-[#4a3a1c] text-[#fbbf24]",
  },
  {
    n: 4,
    title: "We keep tracking until you land",
    text: "If you're delayed, your pickup moves later automatically. If you're early, it moves up to 15 minutes earlier, and we check with you before going further. You'll get a text when you land.",
    badge: "bg-[#24402a] text-[#86efac]",
  },
];

const card = "flex flex-col gap-[10px] rounded-[22px] border border-[#4a5058] bg-ink-2 p-5";
const bubble =
  "rounded-[16px_16px_16px_4px] bg-[#4a5058] px-[14px] py-3 text-[14.5px] text-[#f3f4f6]";

export function ExampleFlightCard() {
  return (
    <figure className="m-0 flex flex-col gap-3 rounded-[32px] bg-page p-[22px] shadow-[0_40px_80px_-40px_rgba(0,0,0,0.6)]">
      <figcaption className="px-1 text-[13px] font-extrabold tracking-[0.08em] text-[#636a76]">
        IN THE ORANGERIDE APP · EXAMPLE FLIGHT
      </figcaption>
      <div className="flex items-center gap-[10px] rounded-t-[16px] border border-line bg-white px-4 py-[14px] text-[16px] text-ink">
        <span className="h-[14px] w-[14px] shrink-0 rounded-[7px] bg-[#22c55e]" aria-hidden />
        Gatwick North Terminal: Car Park 6, Level 4
      </div>
      <div className="-mt-[13px] flex flex-col gap-[14px] rounded-b-[20px] border border-[#f8dca6] bg-[#fffaf0] p-5">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <strong className="flex items-center gap-2 text-[18px] text-ink">
              <PlaneIcon />
              EZY8687 · easyJet
            </strong>
            <span className="text-[15px] text-muted">Change</span>
          </div>
          <span className="text-[14.5px] text-muted">
            From Amsterdam · Mon 12 Oct · scheduled 21:10 · now expected 21:19 (UK time)
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <strong className="text-ink">Arriving at</strong>
          <div className="grid grid-cols-2 gap-[10px] text-center text-[16px] font-semibold">
            <span className="rounded-[14px] border-[1.5px] border-[#f0a73a] bg-[#fdf0d8] px-2 py-3 text-[#92400e]">
              North Terminal
            </span>
            <span className="rounded-[14px] border-[1.5px] border-line bg-white px-2 py-3 text-body">
              South Terminal
            </span>
          </div>
          <span className="flex items-center gap-[6px] text-[15px] text-muted">
            <PinIcon />
            Meet at <strong className="text-ink">Car Park 6, Level 4</strong>
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <strong className="text-ink">Luggage</strong>
          <div className="grid grid-cols-2 gap-1 rounded-[16px] border border-line bg-[#f8fafc] p-1 text-center text-[15px]">
            <span className="px-2 py-[10px] font-semibold text-body">Hand luggage only</span>
            <span className="rounded-[12px] bg-[#e9a23b] px-2 py-[10px] font-bold text-ink">
              Checked bags
            </span>
          </div>
        </div>
        <div className="flex flex-col rounded-[18px] bg-[#e7f2e3] px-5 py-4 leading-[1.3]">
          <strong className="text-[26px] font-extrabold text-[#2f7d32]">Pickup 22:05</strong>
          <span className="text-[#2b742f]">45 min after landing</span>
        </div>
        <span className="font-bold text-accent-dark">Need more time?</span>
      </div>
    </figure>
  );
}

export default function Arrivals() {
  return (
    <section id="arrivals" className="bg-ink text-[#d1d5db]">
      <div className="mx-auto flex max-w-site flex-col gap-14 px-6 py-[104px]">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(460px,100%),1fr))] items-end gap-8">
          <div className="flex flex-col gap-[14px]">
            <span className="text-[13.5px] font-extrabold tracking-[0.08em] text-[#fbbf24]">
              FLYING INTO GATWICK
            </span>
            <h2 className="m-0 font-heading text-[clamp(32px,4vw,52px)] font-bold leading-[1.02] tracking-[-0.035em] text-white">
              Tell us your flight. We&apos;ll work out your pickup.
            </h2>
          </div>
          <p className="m-0 text-[18px] text-[#d1d5db]">
            When you book a Gatwick pickup in the OrangeRide app, just add your flight number.
            Here&apos;s what you&apos;ll see, and what happens next.
          </p>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(440px,100%),1fr))] items-start gap-12">
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {STEPS.map((s) => (
              <li
                key={s.n}
                className={`grid grid-cols-[44px_1fr] gap-4 rounded-[20px] p-[18px] ${
                  s.active ? "bg-ink-2" : ""
                }`}
              >
                <span
                  className={`grid h-9 w-9 place-items-center rounded-full font-extrabold ${s.badge}`}
                >
                  {s.n}
                </span>
                <span className="flex flex-col gap-[2px]">
                  <strong className="text-[18px] text-white">{s.title}</strong>
                  <span>{s.text}</span>
                </span>
              </li>
            ))}
          </ol>

          <ExampleFlightCard />
        </div>

        <div className="flex flex-col gap-[18px]">
          <h3 className="m-0 font-heading text-[26px] font-bold tracking-[-0.02em] text-white">
            Then, on the day
          </h3>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-4">
            <div className={card}>
              <span className="flex justify-between">
                <strong className="text-[#fbbf24]">Running late</strong>
                <span className="text-[14px] text-[#b4b9c0]">18:40</span>
              </span>
              <span className={bubble}>
                OrangeRide: EZY8687 is running late. We&apos;ve moved your pickup to 22:35 (30 min
                later) and will keep tracking it.
              </span>
            </div>
            <div className={card}>
              <span className="flex justify-between">
                <strong className="text-[#86efac]">Landed</strong>
                <span className="text-[14px] text-[#b4b9c0]">21:50</span>
              </span>
              <span className={bubble}>
                OrangeRide: Welcome to Gatwick! EZY8687 landed 21:50. Meet your driver at Car Park
                6, Level 4 at 22:35.
              </span>
            </div>
            <div className={card}>
              <strong className="text-white">Cancelled or diverted</strong>
              <span className="text-[15px]">
                We&apos;ll text you straight away and help rearrange. You won&apos;t be left waiting at a
                car park.
              </span>
              <span className="text-[14px] text-[#b4b9c0]">
                Flying out instead? Just choose a pickup time. Flight tracking is for arrivals.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
