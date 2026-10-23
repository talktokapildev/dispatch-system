import QuoteCalculator from "../quote/QuoteCalculator";

/**
 * "Get a price": the quote calculator, straight after the hero.
 * A cream rounded panel holds the calculator (two rows on wide screens). On phones the panel's
 * padding is small, so the inputs keep their width. The card's header is the section heading.
 */
export default function QuoteSection() {
  return (
    <section id="quote" aria-labelledby="quote-heading" className="scroll-mt-16 px-4 pb-12 sm:px-6 sm:pb-16">
      <div className="mx-auto max-w-[1240px] rounded-[28px] border border-[#fde7b0] bg-[#fff6e5] p-3 sm:rounded-[36px] sm:px-[clamp(20px,3vw,40px)] sm:py-10">
        <div className="mx-auto max-w-[1080px]">
          <QuoteCalculator />
        </div>
      </div>
    </section>
  );
}
