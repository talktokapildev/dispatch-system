import QuoteCalculator from "../quote/QuoteCalculator";

/**
 * "Get a price": the quote calculator, straight after the hero.
 * Wide screens: a cream rounded panel with the calculator laid out in two rows. Phones: just the
 * card (no panel), so the inputs keep their full width. The card's header is the section heading.
 */
export default function QuoteSection() {
  return (
    <section id="quote" aria-labelledby="quote-heading" className="scroll-mt-16 px-6 pb-12 sm:pb-16">
      <div className="mx-auto max-w-[1240px] sm:rounded-[36px] sm:border sm:border-[#fde7b0] sm:bg-[#fff6e5] sm:px-[clamp(20px,3vw,40px)] sm:py-10">
        <div className="mx-auto max-w-[1080px]">
          <QuoteCalculator />
        </div>
      </div>
    </section>
  );
}
