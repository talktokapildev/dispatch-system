"use client";

import { useState, type ReactNode } from "react";
import { trackQuoteShown } from "@/lib/analytics";
import {
  durationText,
  newSessionToken,
  requestQuote,
  ukToday,
  whatsappQuoteHref,
  type PlaceChoice,
  type QuoteResult,
} from "@/lib/quote";
import { PHONE_HREF, WHATSAPP_HREF } from "@/lib/site";
import { ChatIcon, CheckIcon } from "../Icons";
import { PhoneText } from "../Responsive";
import AddressField from "./AddressField";

const PASSENGER_OPTIONS = [1, 2, 3, 4];
const BAG_OPTIONS = [0, 1, 2, 3, 4, 5, 6];

const PROMISES = ["No surge pricing", "10 min free wait", "Free cancellation"];

const fieldClass =
  "min-h-[52px] w-full rounded-[14px] border-[1.5px] border-[#d1d5db] bg-[#f8fafc] px-[14px] text-[16px] text-ink outline-none transition-colors focus:border-amber focus:bg-white";

const ctaClass =
  "inline-flex min-h-[58px] items-center justify-center gap-[10px] whitespace-nowrap rounded-[16px] bg-amber px-6 py-[15px] text-[17px] font-extrabold text-ink no-underline shadow-[0_10px_24px_-12px_rgba(245,158,11,0.9)] transition hover:-translate-y-[1px] hover:text-ink hover:shadow-[0_14px_28px_-12px_rgba(245,158,11,0.95)] active:translate-y-0 disabled:translate-y-0 disabled:opacity-60";

/** The card: dark header strip + white body, lifted off the page so it stands out. */
function Card({
  title,
  aside,
  children,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    // No overflow-hidden: the address suggestions must be able to drop below the card.
    <div className="relative rounded-[28px] border border-line bg-white shadow-[0_30px_60px_-32px_rgba(46,50,56,0.45)]">
      <div className="flex items-center justify-between gap-3 rounded-t-[27px] bg-ink px-[22px] py-[14px] sm:px-8">
        {/* The section heading (the home page shows no other heading for the quote). */}
        <h2
          id="quote-heading"
          className="m-0 flex items-center gap-2 whitespace-nowrap text-[15px] font-extrabold text-white sm:text-[17px]"
        >
          <span
            className="h-2 w-2 flex-none rounded-full bg-amber shadow-[0_0_0_4px_rgba(245,158,11,0.25)]"
            aria-hidden
          />
          {title}
        </h2>
        {aside}
      </div>
      <div className="p-[22px] sm:p-8">{children}</div>
    </div>
  );
}

function Promises() {
  return (
    <ul className="m-0 flex list-none flex-wrap justify-center gap-x-4 gap-y-1 p-0 text-[13px] font-semibold text-soft">
      {PROMISES.map((p) => (
        <li key={p} className="flex items-center gap-[6px]">
          <CheckIcon size={13} color="#16a34a" />
          {p}
        </li>
      ))}
    </ul>
  );
}

/** Pickup → drop-off with a dotted line between the two dots. */
function Route({ from, to }: { from: string; to: string }) {
  return (
    <div className="grid grid-cols-[14px_1fr] gap-x-3 text-[15.5px] leading-snug">
      <span
        className="mt-[6px] h-[10px] w-[10px] rounded-full border-[2.5px] border-[#16a34a]"
        aria-hidden
      />
      <p className="m-0 pb-3">
        <span className="sr-only">From: </span>
        {from}
      </p>
      <span className="relative" aria-hidden>
        <span className="absolute -top-3 left-[4px] h-3 border-l-2 border-dotted border-[#cbd5e1]" />
        <span className="mt-[6px] block h-[10px] w-[10px] rounded-full bg-[#ef4444]" />
      </span>
      <p className="m-0">
        <span className="sr-only">To: </span>
        {to}
      </p>
    </div>
  );
}

/**
 * Quote calculator: pickup + drop-off (+ optional date/time, passengers, bags) → "From £X".
 * Reusable: area pages pass `initialPickup` (e.g. Horsham station).
 */
export default function QuoteCalculator({
  initialPickup,
}: {
  initialPickup?: PlaceChoice;
}) {
  const [session, setSession] = useState(newSessionToken);
  const [pickup, setPickup] = useState<PlaceChoice | null>(
    initialPickup ?? null,
  );
  const [dropoff, setDropoff] = useState<PlaceChoice | null>(null);
  const [fieldsKey, setFieldsKey] = useState(0);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [passengers, setPassengers] = useState(1);
  const [bags, setBags] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuoteResult | null>(null);

  const tooMany = passengers > 4;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!pickup || !dropoff) {
      setError("Choose both addresses from the suggestions.");
      return;
    }
    if (Boolean(date) !== Boolean(time)) {
      setError("Add both a date and a time, or leave both empty.");
      return;
    }
    setBusy(true);
    const r = await requestQuote({
      pickupPlaceId: pickup.placeId,
      dropoffPlaceId: dropoff.placeId,
      date: date || undefined,
      time: time || undefined,
      passengers,
      bags,
      session,
    });
    setBusy(false);
    setSession(newSessionToken()); // the next search is a new Google session
    if (!r.ok) {
      setError(r.error);
      trackQuoteShown("ERROR");
      return;
    }
    setResult(r.data);
    trackQuoteShown(
      r.data.status,
      r.data.status === "QUOTED" ? r.data.fromPrice : undefined,
    );
  };

  const swap = () => {
    setPickup(dropoff);
    setDropoff(pickup);
    setFieldsKey((k) => k + 1);
  };

  const trip = {
    from: pickup?.label ?? "",
    to: dropoff?.label ?? "",
    date,
    time,
    passengers,
    bags,
  };

  const changeButton = (
    <button
      type="button"
      onClick={() => setResult(null)}
      className="whitespace-nowrap rounded-full border border-white/25 px-3 py-[5px] text-[13px] font-bold text-white hover:bg-white/10"
    >
      Change trip
    </button>
  );

  if (result) {
    return (
      <div aria-live="polite">
        {result.status === "QUOTED" ? (
          <Card title="Your fixed fare" aside={changeButton}>
            <div className="flex flex-col gap-5 min-[900px]:grid min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] min-[900px]:items-center min-[900px]:gap-7">
              <div className="flex flex-wrap items-end justify-between gap-3 rounded-[20px] border border-[#fde7b0] bg-[#fffbeb] px-5 py-4">
                <p className="m-0 flex items-baseline gap-[10px] font-heading font-bold leading-none text-ink">
                  <span className="text-[22px] font-semibold tracking-normal text-accent-dark">
                    From
                  </span>
                  <span className="text-[clamp(52px,7vw,68px)] tracking-[-0.04em]">
                    £{result.fromPrice}
                  </span>
                </p>
                <span className="mb-1 rounded-full bg-white px-3 py-[6px] text-[13.5px] font-bold text-soft">
                  {result.miles} mi ·{" "}
                  {durationText(result.minutes).replace("about ", "~")}
                </span>
              </div>

              <div className="flex flex-col gap-4">
                <Route from={trip.from} to={trip.to} />

                {result.premiumLabel && (
                  <p className="m-0 text-[14px] text-soft">
                    Includes the{" "}
                    {result.premiumLabel
                      .replace(/\s*\(.*\)$/, "")
                      .toLowerCase()}
                    .
                  </p>
                )}
                {!result.pickupAt && (
                  <p className="m-0 text-[14px] text-muted">
                    <PhoneText
                      full="Daytime price. Pickups 23:00–06:00 and on bank holidays cost a little more."
                      short="Daytime price. Nights and bank holidays cost more."
                    />
                  </p>
                )}
                {result.tooSoon && (
                  <p className="m-0 rounded-[14px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[14px] text-[#991b1b]">
                    Less than 24 hours away. Message us and we&apos;ll see if we
                    can help.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <a
                  href={whatsappQuoteHref({
                    ...trip,
                    price: result.fromPrice,
                    ref: result.ref,
                  })}
                  data-tap="quote_whatsapp"
                  target="_blank"
                  rel="noopener"
                  className={ctaClass}
                >
                  <ChatIcon />
                  Book on WhatsApp
                </a>
                <p className="m-0 text-center text-[13px] text-muted">
                  <PhoneText
                    full={
                      <>
                        We confirm the exact fare on WhatsApp before you book ·{" "}
                        <span className="whitespace-nowrap">
                          Ref {result.ref}
                        </span>
                      </>
                    }
                    short={
                      <>
                        Exact fare confirmed on WhatsApp ·{" "}
                        <span className="whitespace-nowrap">
                          Ref {result.ref}
                        </span>
                      </>
                    }
                  />
                </p>
              </div>
            </div>
          </Card>
        ) : (
          <Card
            title={
              result.status === "OUT_OF_AREA"
                ? "Let's quote it for you"
                : "Ask us for a price"
            }
            aside={changeButton}
          >
            <div className="flex flex-col gap-4 min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between min-[900px]:gap-8">
              <p className="m-0 max-w-[620px] text-[16px]">
                {result.status === "OUT_OF_AREA"
                  ? "This trip is outside our usual area, but we may still help. Send it to us and we'll reply with a price."
                  : "We can't price this online right now. Send it to us and we'll reply with a price."}
              </p>
              <a
                href={whatsappQuoteHref(
                  result.status === "OUT_OF_AREA"
                    ? { ...trip, ref: result.ref }
                    : trip,
                )}
                data-tap="quote_whatsapp"
                target="_blank"
                rel="noopener"
                className={ctaClass}
              >
                <ChatIcon />
                Ask on WhatsApp
              </a>
            </div>
          </Card>
        )}
      </div>
    );
  }

  const swapButton = (
    <button
      type="button"
      onClick={swap}
      disabled={!pickup && !dropoff}
      className="rounded-full px-2 py-[2px] text-[13px] font-bold text-accent-dark hover:bg-[#fffbeb] disabled:opacity-40"
      aria-label="Swap pickup and drop-off"
    >
      ⇅ Swap
    </button>
  );

  return (
    <Card
      title={<PhoneText full="What will my trip cost?" short="Instant quote" />}
      aside={
        <span className="whitespace-nowrap rounded-full bg-amber/15 px-[10px] py-[4px] text-[12px] font-extrabold tracking-[0.04em] text-amber">
          <PhoneText full="TAKES 10 SECONDS" short="10 SEC" />
        </span>
      }
    >
      <form
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4 min-[900px]:grid min-[900px]:grid-cols-12 min-[900px]:items-end"
      >
        <div className="min-[900px]:col-span-6">
          <AddressField
            key={`p${fieldsKey}`}
            label="Pickup"
            placeholder="Address, postcode or place"
            value={pickup}
            onChange={setPickup}
            session={session}
            pinColor="#16a34a"
          />
        </div>
        <div className="min-[900px]:col-span-6">
          <AddressField
            key={`d${fieldsKey}`}
            label="Drop-off"
            placeholder="e.g. Gatwick South Terminal"
            value={dropoff}
            onChange={setDropoff}
            session={session}
            pinColor="#ef4444"
            labelAside={swapButton}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 min-[900px]:col-span-9 min-[900px]:grid-cols-4">
          <label className="flex flex-col gap-[6px] text-[14px] font-bold text-soft">
            <span>
              Date <span className="font-semibold text-muted">· optional</span>
            </span>
            <input
              type="date"
              min={ukToday()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-[6px] text-[14px] font-bold text-soft">
            <span>
              Time <span className="font-semibold text-muted">· UK</span>
            </span>
            <input
              type="time"
              step={300}
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-[6px] text-[14px] font-bold text-soft">
            Passengers
            <select
              value={passengers}
              onChange={(e) => setPassengers(Number(e.target.value))}
              className={fieldClass}
            >
              {PASSENGER_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              <option value={5}>5 or more</option>
            </select>
          </label>
          <label className="flex flex-col gap-[6px] text-[14px] font-bold text-soft">
            Large bags
            <select
              value={bags}
              onChange={(e) => setBags(Number(e.target.value))}
              className={fieldClass}
            >
              {BAG_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>

        {tooMany ? (
          <div className="flex flex-col gap-3 rounded-[16px] border border-[#fde7b0] bg-[#fffbeb] p-4 min-[900px]:col-span-12">
            <p className="m-0 text-[15px]">
              Our cars seat up to 4. Message us for a bigger group.
            </p>
            <div className="flex flex-wrap gap-4">
              <a
                href={WHATSAPP_HREF}
                className="font-extrabold text-accent-dark"
              >
                WhatsApp us
              </a>
              <a href={PHONE_HREF} className="font-extrabold text-accent-dark">
                Call us
              </a>
            </div>
          </div>
        ) : (
          <button
            type="submit"
            disabled={busy}
            className={`${ctaClass} mt-1 min-[900px]:col-span-3 min-[900px]:mt-0 min-[900px]:min-h-[52px] min-[900px]:px-4`}
          >
            {busy ? (
              <>
                <span
                  className="h-5 w-5 animate-spin rounded-full border-[2.5px] border-ink/25 border-t-ink"
                  aria-hidden
                />
                <PhoneText
                  full="Working out your price…"
                  short="Working it out…"
                />
              </>
            ) : (
              <>Get my price →</>
            )}
          </button>
        )}

        {error && (
          <p
            role="alert"
            className="m-0 rounded-[14px] min-[900px]:col-span-12 border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[14.5px] text-[#991b1b]"
          >
            {error}
          </p>
        )}

        <div className="min-[900px]:col-span-12">
          <Promises />
        </div>
      </form>
    </Card>
  );
}
