import Link from "next/link";
import type { LegalSection } from "@/components/legal/LegalLayout";
import { EMAIL, EMAIL_HREF, OPERATING_CENTRE, PHONE_DISPLAY, PHONE_HREF } from "@/lib/site";

// Word for word from the approved Terms artboard (Terms.dc.html). Do not reword.

export const TERMS_UPDATED = "12 October 2026";

export const TERMS_INTRO =
  "The terms for booking and travelling with OrangeRide, including fares, flight tracking, lost property and how to make a complaint.";

export const TERMS_SUMMARY = [
  {
    title: "Operator",
    text: "Kapil Dev, trading as OrangeRide. TfL private hire operator licence 11786.",
  },
  {
    title: "Bookings",
    text: "Pre-booked only, at least 24 hours ahead, by app, WhatsApp, phone or email.",
  },
  {
    title: "Fares",
    text: "Fixed and agreed before you travel. Charges may apply for waiting over 10 minutes or late cancellation.",
  },
  {
    title: "Complaints",
    text: "Tell us first. You can also contact Transport for London.",
  },
];

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: "about",
    title: "About us and these terms",
    body: (
      <>
        <p>
          These terms apply when you book a journey with <strong>OrangeRide</strong>, a trading
          name of <strong>Kapil Dev</strong>. We are licensed by Transport for London (TfL) to
          operate private hire vehicles under the Private Hire Vehicles (London) Act 1998,{" "}
          <strong>operator licence 11786</strong>.
        </p>
        <p>
          Operating centre: {OPERATING_CENTRE}
          <br />
          Email: <a href={EMAIL_HREF}>{EMAIL}</a> · Phone and WhatsApp:{" "}
          <a href={PHONE_HREF}>{PHONE_DISPLAY}</a>
        </p>
        <p>
          By making a booking, you agree to these terms. Please read them alongside our{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </>
    ),
  },
  {
    id: "booking",
    title: "Making a booking",
    body: (
      <ul>
        <li>
          <strong>Pre-booked journeys only.</strong> At the moment we accept bookings made at least{" "}
          <strong>24 hours</strong> before the pickup time. We can&apos;t take on-street hails or
          immediate bookings.
        </li>
        <li>
          <strong>How to book:</strong> in the OrangeRide app, or by WhatsApp, phone or email.
          Every booking is accepted and recorded by us as your licensed operator, as TfL requires.
        </li>
        <li>
          <strong>Confirmation:</strong> a booking is confirmed when you receive a booking
          reference, in the app or by message. Please check the details and tell us straight away
          if anything is wrong.
        </li>
        <li>
          <strong>Airport pickups:</strong> please give your arriving flight number and date so we
          can track your flight. You&apos;re responsible for giving us accurate flight, address and
          contact details.
        </li>
        <li>
          We may decline a booking, for example if no licensed driver and vehicle are available for
          the time requested. If so, we&apos;ll tell you as soon as we can.
        </li>
      </ul>
    ),
  },
  {
    id: "fares",
    title: "Fares and payment",
    body: (
      <ul>
        <li>
          <strong>Fixed fares.</strong> We tell you the fare before you book, and that&apos;s what
          you pay. It doesn&apos;t change because of traffic, roadworks, or a delayed flight
          we&apos;re tracking. The only extras are the waiting and late-cancellation charges
          described below, and any changes you ask us to make.
        </li>
        <li>The fare includes any airport drop-off or pickup charges that apply to your journey.</li>
        <li>
          If you change the journey, for example by adding a stop or changing the destination,
          we&apos;ll tell you the new fare before we go ahead.
        </li>
        <li>
          <strong>Payment:</strong> by card, Apple Pay or Google Pay through the app (processed
          securely by Stripe), or in cash to the driver. Business accounts can be invoiced by
          agreement.
        </li>
        <li>
          <strong>Promotional credit:</strong> any credit we give you in the app, such as a welcome
          bonus, can only be used towards OrangeRide journeys. It has no cash value, can&apos;t be
          transferred, and may expire; the expiry is shown in the app.
        </li>
      </ul>
    ),
  },
  {
    id: "cancel",
    title: "Changes, cancellations and waiting",
    body: (
      <ul>
        <li>You can change or cancel a booking in the app under Rides, or by contacting us.</li>
        <li>
          <strong>Free cancellation:</strong> cancelling is free up to{" "}
          <strong>15 minutes before</strong> your pickup time.
        </li>
        <li>
          <strong>Late cancellation or no-show:</strong> if you cancel less than 15 minutes before
          your pickup time, or you don&apos;t arrive and can&apos;t be contacted, we may charge{" "}
          <strong>50% of the fare</strong>.
        </li>
        <li>
          <strong>Waiting time:</strong> your driver waits <strong>10 minutes free</strong> from
          your pickup time. After that, waiting may be charged at <strong>£0.50 per minute</strong>.
        </li>
        <li>
          <strong>Airport pickups:</strong> your pickup time already follows your flight&apos;s
          actual arrival plus time to collect luggage, so you won&apos;t be charged for flight
          delays. Waiting time starts from your updated pickup time. If you need longer, use
          &quot;Need more time?&quot; in the app or message us.
        </li>
        <li>We&apos;ll always tell you about any charge before taking it, and we may choose to waive it.</li>
        <li>
          If we have to cancel, or your driver will be significantly late, we&apos;ll contact you as
          soon as possible. If you&apos;ve paid for a journey we can&apos;t provide, we&apos;ll refund
          you in full, and no cancellation charge applies.
        </li>
      </ul>
    ),
  },
  {
    id: "airport",
    title: "Airport pickups and flight tracking",
    body: (
      <ul>
        <li>
          When you give us your arriving flight, we track it using live flight data and set your
          pickup time based on when your flight reaches the gate, plus time for luggage.
        </li>
        <li>
          If your flight is delayed, we move your pickup later automatically. If it&apos;s early, we
          move it up to 15 minutes earlier, and check with you before moving it further.
        </li>
        <li>If your flight is cancelled or diverted, we&apos;ll contact you to rearrange.</li>
        <li>
          Flight information comes from third-party sources and can occasionally be wrong or late.
          If your plans change, please let us know.
        </li>
        <li>
          Gatwick meeting points are North Terminal, Car Park 6, Level 4, and South Terminal,
          Orange Car Park, Level 3, unless we agree otherwise.
        </li>
      </ul>
    ),
  },
  {
    id: "journey",
    title: "During your journey",
    body: (
      <ul>
        <li>
          All our drivers hold a TfL private hire driver&apos;s licence, and all our vehicles hold a
          TfL private hire vehicle licence and are insured for hire and reward.
        </li>
        <li>Seat belts must be worn. Smoking and vaping aren&apos;t allowed in our vehicles.</li>
        <li>
          Children&apos;s car seats aren&apos;t provided. You&apos;re welcome to bring your own;
          please tell us when you book.
        </li>
        <li>
          Please tell us about large luggage or extra passengers when you book, so we can send a
          suitable vehicle. We can&apos;t carry more passengers than the vehicle is licensed for.
        </li>
        <li>
          Assistance dogs are always welcome at no extra charge. Please tell us about any other
          accessibility needs when you book.
        </li>
        <li>A driver may refuse or end a journey if a passenger is abusive, violent or behaving unsafely.</li>
      </ul>
    ),
  },
  {
    id: "lost",
    title: "Lost property",
    body: (
      <p>
        If you leave something behind, report it in the app (Rides, then Lost Property) or contact
        us. We record all lost property, as TfL requires, and will arrange to return it to you.
      </p>
    ),
  },
  {
    id: "complaints",
    title: "Comments and complaints",
    body: (
      <>
        <p>We want to hear about anything that went wrong. To make a complaint:</p>
        <ul>
          <li>Use &quot;Report Issue&quot; on the trip in the app (under Rides), or</li>
          <li>
            email <a href={EMAIL_HREF}>{EMAIL}</a>, or call or WhatsApp{" "}
            <a href={PHONE_HREF}>{PHONE_DISPLAY}</a>.
          </li>
        </ul>
        <p>
          Please include your booking reference if you have it. We&apos;ll acknowledge your
          complaint within <strong>2 working days</strong> and aim to give you a full response
          within <strong>14 days</strong>. We keep a record of every complaint and what we did about
          it, as TfL requires.
        </p>
        <p>
          If you&apos;re not satisfied with our response, or your complaint is about the conduct of a
          licensed driver or operator, you can contact Transport for London:{" "}
          <strong>Transport for London, PO Box 7632, Bilston, WV14 4DN</strong>, or through{" "}
          <a href="https://tfl.gov.uk">tfl.gov.uk</a>.
        </p>
      </>
    ),
  },
  {
    id: "liability",
    title: "Our responsibility to you",
    body: (
      <ul>
        <li>
          We&apos;ll provide our service with reasonable care and skill. Nothing in these terms
          limits your legal rights as a consumer, or our liability for death or personal injury
          caused by our negligence, or for fraud.
        </li>
        <li>
          We aren&apos;t responsible for delays or losses caused by things outside our reasonable
          control, such as severe weather, road closures, accidents or airport disruption.
          We&apos;ll always do our best to get you there and keep you informed.
        </li>
        <li>
          We aren&apos;t responsible for indirect losses, such as a missed flight caused by giving us
          the wrong pickup time or address.
        </li>
      </ul>
    ),
  },
  {
    id: "general",
    title: "Changes and governing law",
    body: (
      <p>
        We may update these terms from time to time, and the version on this page on the day you
        book applies to that booking. These terms are governed by the law of England and Wales, and
        the courts of England and Wales have jurisdiction.
      </p>
    ),
  },
];

export const TERMS_OTHER = { href: "/privacy", label: "Privacy Policy" };
