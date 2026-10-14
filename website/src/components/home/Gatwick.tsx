import { PhoneText } from "../Responsive";
import Image from "next/image";
import { WHATSAPP_HREF } from "@/lib/site";

const SPOTS = [
  ["North Terminal", "Car Park 6, Level 4"],
  ["South Terminal", "Orange Car Park, Level 3"],
  ["Meet & greet", "Name board in arrivals"],
  ["Crawley & Horley", "Home to terminal, both ways"],
];

export default function Gatwick() {
  return (
    <section id="gatwick" className="mx-auto max-w-site px-6 pb-[104px]">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(460px,100%),1fr))] overflow-hidden rounded-[36px] border border-line bg-white">
        <div className="flex flex-col gap-5 p-[clamp(24px,5vw,48px)]">
          <span className="text-[13.5px] font-extrabold tracking-[0.08em] text-accent-dark">
            GATWICK SPECIALISTS
          </span>
          <h2 className="m-0 font-heading text-[clamp(30px,3.6vw,46px)] font-bold leading-[1.04] tracking-[-0.035em] text-ink">
            Ten minutes from the runway. We know every kerb.
          </h2>
          <p className="m-0 text-[18px]">
            <PhoneText
              full="Gatwick is our home airport, and we cover London and Heathrow too. Each terminal has its own meeting point, and the app shows it as soon as you choose your terminal."
              short="Each terminal has its own meeting point, shown in the app."
            />
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-[10px]">
            {SPOTS.map(([title, text]) => (
              <div
                key={title}
                className="flex flex-col gap-[2px] rounded-[18px] border border-line bg-[#f8fafc] p-4"
              >
                <strong className="text-ink">{title}</strong>
                <span className="text-[14.5px]">{text}</span>
              </div>
            ))}
          </div>
          <a
            href={WHATSAPP_HREF}
            className="inline-flex min-h-[54px] items-center self-start rounded-[16px] bg-amber px-[26px] py-[15px] font-extrabold text-ink no-underline hover:text-ink"
          >
            Ask about a Gatwick transfer
          </a>
        </div>
        <div className="relative min-h-[420px] bg-[#e8f3ea]">
          <Image
            src="/images/map-lgw-wide.jpg"
            alt="Map centred on London Gatwick Airport, with Horley to the north and Crawley to the south"
            fill
            sizes="(min-width: 1240px) 600px, (min-width: 940px) 50vw, 100vw"
            className="object-cover object-center"
          />
          <span className="absolute bottom-5 left-5 rounded-[14px] bg-ink px-[14px] py-[10px] font-bold text-white shadow-[0_12px_30px_-16px_rgba(46,50,56,0.6)]">
            Based in Crawley · 10 min to LGW
          </span>
        </div>
      </div>
    </section>
  );
}
