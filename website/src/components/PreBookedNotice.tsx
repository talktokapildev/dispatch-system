import { CalendarIcon } from "./Icons";

export default function PreBookedNotice() {
  return (
    <div className="bg-ink text-[14.5px] font-semibold text-[#e5e7eb]">
      <div className="mx-auto flex max-w-site flex-wrap items-center justify-center gap-2 px-6 py-[10px] text-center">
        <CalendarIcon />
        <span>We take pre-booked journeys only. Please book at least 24 hours ahead.</span>
      </div>
    </div>
  );
}
