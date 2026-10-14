type Card = { tag: string; tagClass: string; title: string; text: string };

const CARDS: Card[] = [
  {
    tag: "SCHEDULED PICKUP",
    tagClass: "border border-[#fde7b0] bg-[#fffbeb] text-accent-dark",
    title: "Planned, not dispatched",
    text: "Every trip is booked at least 24 hours ahead, so it's planned before the day. You won't be refreshing an app hoping a car turns up.",
  },
  {
    tag: "FIXED FARE",
    tagClass: "border border-[#fde7b0] bg-[#fffbeb] text-accent-dark",
    title: "The price doesn't move",
    text: "You see the total before you book. Traffic, roadworks and flight delays won't change it.",
  },
  {
    tag: "CRAWLEY-BASED",
    tagClass: "bg-[#ecf6e4] text-[#2a5e15]",
    title: "Local and accountable",
    text: "We're a TfL-licensed operator ten minutes from Gatwick, with real people you can call or WhatsApp.",
  },
];

export default function WhyOrangeRide() {
  return (
    <section
      aria-labelledby="why-heading"
      className="mx-auto flex max-w-site flex-col gap-10 px-6 py-[104px]"
    >
      <div className="flex max-w-[760px] flex-col gap-3">
        <span className="text-[13.5px] font-extrabold tracking-[0.08em] text-accent-dark">
          WHY ORANGERIDE
        </span>
        <h2
          id="why-heading"
          className="m-0 font-heading text-[clamp(32px,4vw,50px)] font-bold leading-[1.04] tracking-[-0.035em] text-ink"
        >
          Booked ahead, so nobody&apos;s scrambling at 4am, least of all you.
        </h2>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-[18px]">
        {CARDS.map((c) => (
          <div
            key={c.tag}
            className="flex flex-col gap-[14px] rounded-[28px] border border-line bg-white p-[30px]"
          >
            <span
              className={`self-start rounded-[10px] px-3 py-[6px] text-[12.5px] font-extrabold tracking-[0.06em] ${c.tagClass}`}
            >
              {c.tag}
            </span>
            <h3 className="m-0 text-[22px] font-extrabold text-ink">{c.title}</h3>
            <p className="m-0">{c.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
