import { CalendarIcon } from "./Icons";

/** Dark strip at the top of every page. Phones get a one-line short version. */
export default function PreBookedNotice() {
  return (
    <div className="bg-ink text-[14.5px] font-semibold text-[#e5e7eb]">
      <div className="mx-auto flex max-w-site flex-wrap items-center justify-center gap-2 px-6 py-[10px] text-center">
        <CalendarIcon />
        <span className="hidden sm:inline">
          We take pre-booked journeys only. Please book at least 24 hours ahead.
        </span>
        <span className="whitespace-nowrap sm:hidden">Pre-booked only · book 24h ahead</span>
      </div>
    </div>
  );
}
