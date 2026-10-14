import Image from "next/image";
import { CheckIcon } from "../Icons";

/**
 * Hero visual: a phone mirroring the passenger app's flight screen, with two floating cards.
 * It's a picture of the app, so it is exposed to screen readers as one image with a description.
 */
export default function HeroPhone() {
  return (
    <div
      role="img"
      aria-label="The OrangeRide app showing flight EZY8687 from Amsterdam landing at Gatwick North Terminal, with pickup at 22:05 at Car Park 6, Level 4. A notification says the flight is delayed and the pickup has moved to 22:35."
      className="box-content grid min-h-[700px] min-w-0 justify-items-center py-[10px]"
    >
      <div
        aria-hidden
        className="aspect-square w-[min(540px,100%)] self-center rounded-full bg-[#ffecd6] [grid-area:1/1]"
      />
      <div
        aria-hidden
        className="mr-5 mt-[10px] h-[140px] w-[140px] self-start justify-self-end rounded-full bg-[#e6f2dc] [grid-area:1/1]"
      />

      {/* Phone */}
      <div
        aria-hidden
        className="box-content w-[310px] max-w-[calc(100%-20px)] self-center rounded-[48px] bg-white p-[10px] shadow-[0_50px_90px_-40px_rgba(46,50,56,0.5),0_0_0_1px_#e5e7eb] [grid-area:1/1]"
      >
        <div className="relative h-[640px] overflow-hidden rounded-[39px] bg-[#e9eef5]">
          <Image
            src="/images/map-lgw-close.jpg"
            alt=""
            width={760}
            height={941}
            priority
            sizes="310px"
            className="absolute left-0 top-0 block h-[232px] w-full object-cover object-center"
          />
          <div className="absolute inset-x-0 bottom-0 top-[230px] flex flex-col gap-[10px] rounded-t-[26px] bg-white px-[14px] pb-4 pt-[10px] shadow-[0_-10px_30px_-16px_rgba(46,50,56,0.4)]">
            <span className="h-1 w-9 self-center rounded-[2px] bg-line" />
            <div className="flex items-center gap-2 rounded-[14px] border border-line bg-[#f8fafc] px-3 py-[9px] text-[12.5px] text-ink">
              <span className="h-[10px] w-[10px] shrink-0 rounded-[5px] bg-[#22c55e]" />
              Gatwick North Terminal: Car Park 6…
            </div>
            <div className="flex flex-col gap-2 rounded-[16px] border border-[#f8dca6] bg-[#fffaf0] p-3">
              <div className="flex items-baseline justify-between">
                <strong className="text-[14px] text-ink">EZY8687 · easyJet</strong>
                <span className="text-[12px] text-muted">Change</span>
              </div>
              <span className="text-[11.5px] leading-[1.4] text-muted">
                From Amsterdam · Mon 12 Oct · scheduled 21:10 · now expected 21:19 (UK time)
              </span>
              <strong className="text-[12.5px] text-ink">Arriving at</strong>
              <div className="grid grid-cols-2 gap-[6px] text-center text-[12px]">
                <span className="rounded-[10px] border border-[#f0a73a] bg-[#fdf0d8] px-1 py-[7px] font-semibold text-[#92400e]">
                  North Terminal
                </span>
                <span className="rounded-[10px] border border-line bg-[#f8fafc] px-1 py-[7px] font-semibold text-body">
                  South Terminal
                </span>
              </div>
              <span className="text-[12px] text-muted">
                Meet at <strong className="text-ink">Car Park 6, Level 4</strong>
              </span>
              <strong className="text-[12.5px] text-ink">Luggage</strong>
              <div className="grid grid-cols-2 gap-1 rounded-[10px] border border-line bg-[#f8fafc] p-[3px] text-center text-[12px]">
                <span className="px-1 py-[6px] font-semibold text-body">Hand luggage only</span>
                <span className="rounded-[8px] bg-[#e9a23b] px-1 py-[6px] font-bold text-ink">
                  Checked bags
                </span>
              </div>
              <div className="flex flex-col rounded-[12px] bg-[#e7f2e3] px-3 py-[10px] leading-[1.25]">
                <strong className="text-[17px] text-[#2f7d32]">Pickup 22:05</strong>
                <span className="text-[12px] text-[#2b742f]">45 min after landing</span>
              </div>
              <span className="text-[12.5px] font-bold text-accent-dark">Need more time?</span>
            </div>
            <div className="rounded-[14px] bg-amber p-[11px] text-center text-[14px] font-extrabold text-ink">
              Schedule Ride →
            </div>
          </div>
        </div>
      </div>

      {/* Notification card */}
      <div
        aria-hidden
        className="mt-[90px] box-content flex w-[270px] max-w-[calc(100%-30px)] gap-3 self-start justify-self-start rounded-[20px] border border-line bg-white p-[14px] shadow-[0_24px_50px_-28px_rgba(46,50,56,0.5)] [grid-area:1/1]"
      >
        <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[11px] bg-[#fff3e3]">
          <Image src="/images/logo-pin.png" alt="" width={104} height={160} className="h-[28px] w-auto" />
        </span>
        <span className="flex min-w-0 flex-col leading-[1.35]">
          <span className="flex justify-between text-[12px] text-muted">
            <span>OrangeRide</span>
            <span>now</span>
          </span>
          <strong className="text-[14.5px] text-ink">EZY8687 delayed</strong>
          <span className="text-[13.5px]">Pickup moved to 22:35 (+30 min).</span>
        </span>
      </div>

      {/* Fixed-fare badge */}
      <div
        aria-hidden
        className="mb-[90px] flex rotate-[-3deg] items-center gap-[10px] self-end justify-self-end rounded-[18px] bg-ink px-4 py-3 shadow-[0_20px_40px_-24px_rgba(46,50,56,0.6)] [grid-area:1/1]"
      >
        <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-amber">
          <CheckIcon />
        </span>
        <span className="flex flex-col leading-[1.25]">
          <strong className="text-[15px] text-white">Fixed fare</strong>
          <span className="text-[13px] text-[#d1d5db]">Booked ahead. No surprises.</span>
        </span>
      </div>
    </div>
  );
}
