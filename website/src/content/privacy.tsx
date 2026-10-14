import type { LegalSection } from "@/components/legal/LegalLayout";
import { EMAIL, EMAIL_HREF, OPERATING_CENTRE, PHONE_DISPLAY, PHONE_HREF } from "@/lib/site";

// Word for word from the approved Privacy artboard (Privacy.dc.html). Do not reword.

export const PRIVACY_UPDATED = "14 October 2026";

export const PRIVACY_INTRO =
  "How OrangeRide collects, uses and protects your personal data when you book a ride, use our apps or drive with us.";

export const PRIVACY_SUMMARY = [
  {
    title: "Who we are",
    text: "Kapil Dev, trading as OrangeRide. Data controller registered with the ICO (ZB912095).",
  },
  {
    title: "What we collect",
    text: "Your name, phone number, booking details, payment status and, for airport pickups, your flight number.",
  },
  {
    title: "Why",
    text: "To take and carry out your bookings, keep the records TfL requires, and keep you updated.",
  },
  {
    title: "Your rights",
    text: "You can ask to see, correct or delete your data, or complain to the ICO.",
  },
];

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "who",
    title: "Who we are",
    body: (
      <>
        <p>
          OrangeRide is a trading name of <strong>Kapil Dev</strong>, a sole trader licensed by
          Transport for London as a private hire vehicle operator (licence 11786). In this policy,
          &quot;we&quot;, &quot;us&quot; and &quot;OrangeRide&quot; mean Kapil Dev trading as OrangeRide.
        </p>
        <p>
          We are the <strong>data controller</strong> for the personal data described here, and
          we&apos;re registered with the Information Commissioner&apos;s Office (ICO) under
          registration reference <strong>ZB912095</strong>.
        </p>
        <p>
          Operating centre: {OPERATING_CENTRE}
          <br />
          Email: <a href={EMAIL_HREF}>{EMAIL}</a> · Phone: <a href={PHONE_HREF}>{PHONE_DISPLAY}</a>
        </p>
        <p>
          This policy covers our website, the OrangeRide passenger app, the OrangeRide Driver app,
          and bookings made by phone, WhatsApp or email.
        </p>
      </>
    ),
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <>
        <h3>If you book a ride</h3>
        <ul>
          <li>
            <strong>Account details:</strong> your first and last name, mobile number and, if you
            give it, your email address.
          </li>
          <li>
            <strong>Booking details:</strong> pickup and drop-off addresses, date and time, any
            extra stops, saved addresses, the fare, and your booking reference.
          </li>
          <li>
            <strong>Airport pickups:</strong> your arriving flight number and date, terminal,
            luggage choice and any extra time you ask for.
          </li>
          <li>
            <strong>Location:</strong> if you allow it, your phone&apos;s location, to set your
            pickup point and show your driver approaching. We don&apos;t track you in the background.
          </li>
          <li>
            <strong>Payments:</strong> card, Apple Pay and Google Pay payments are handled by
            Stripe. We don&apos;t see or store your full card number; we keep the payment status
            and, for saved cards, the card type and last four digits.
          </li>
          <li>
            <strong>Messages and support:</strong> what you send us by WhatsApp, text, email or
            phone, issue reports, and lost property reports.
          </li>
          <li>
            <strong>App and device data:</strong> a notification token so we can send you booking
            updates, and basic technical logs that help us fix problems.
          </li>
        </ul>
        <h3>If you drive with us or apply to</h3>
        <ul>
          <li>Your name, contact details, address and profile photo.</li>
          <li>
            Licence and vetting documents: private hire driver licence, DVLA driving licence, DBS
            check, and for your vehicle the PHV licence, insurance, MOT and V5C.
          </li>
          <li>Your location while you&apos;re online or on a job, job history and earnings.</li>
          <li>
            If you choose to connect a Tesla, we use that connection only to send pickup addresses
            to your car&apos;s navigation.
          </li>
        </ul>
        <h3>Care homes and business accounts</h3>
        <p>
          If a care home books for its residents, the care home gives us the resident&apos;s name
          and any mobility, access or care notes our driver needs to transport them safely. Some of
          this can be health information, which is a special category of data, so we use it only
          to plan and carry out that resident&apos;s journey and we limit who can see it. Business
          accounts give us staff names, contact details and journey records for invoicing.
        </p>
      </>
    ),
  },
  {
    id: "use",
    title: "How we use it, and our lawful basis",
    body: (
      <>
        <ul>
          <li>
            <strong>To take, plan and carry out your booking</strong>, including assigning a
            driver, sharing your pickup details with them, and contacting you about it.{" "}
            <em>Lawful basis: performing our contract with you.</em>
          </li>
          <li>
            <strong>To track arriving flights</strong> and move your pickup time when your flight
            is early, late, cancelled or diverted. <em>Contract.</em>
          </li>
          <li>
            <strong>To keep the records TfL requires</strong> of every booking, driver and vehicle,
            lost property and complaints, and to check our drivers are properly licensed and
            vetted. <em>Legal obligation.</em>
          </li>
          <li>
            <strong>To take payment, issue receipts and invoices, and keep accounts.</strong>{" "}
            <em>Contract and legal obligation.</em>
          </li>
          <li>
            <strong>
              To keep passengers and drivers safe, prevent fraud and handle complaints or claims.
            </strong>{" "}
            <em>Legitimate interests.</em>
          </li>
          <li>
            <strong>To improve our service</strong> using booking history and app logs.{" "}
            <em>Legitimate interests.</em>
          </li>
          <li>
            <strong>To send you offers or news.</strong> Only if you&apos;ve agreed, and you can
            opt out at any time. <em>Consent.</em>
          </li>
          <li>
            <strong>Care home residents&apos; health information</strong> is used only where needed
            for their transport and care, under the UK GDPR conditions for health and social care
            and for substantial public interest, and with the care home&apos;s instructions.
          </li>
        </ul>
        <p>
          We don&apos;t sell your personal data, and we don&apos;t make decisions about you based
          solely on automated processing.
        </p>
      </>
    ),
  },
  {
    id: "share",
    title: "Who we share it with",
    body: (
      <>
        <p>We share only what each party needs:</p>
        <ul>
          <li>
            <strong>Your driver:</strong> your first name, phone number (or a way to contact you),
            pickup and drop-off, and flight details for airport pickups.
          </li>
          <li>
            <strong>Transport for London and other authorities</strong>, when they ask to inspect
            our records, or when the law or the police require it.
          </li>
          <li>
            <strong>Service providers who work for us</strong>, under contracts that require them
            to protect your data:
            <ul>
              <li>Stripe (card and wallet payments)</li>
              <li>Twilio (text messages and sign-in codes)</li>
              <li>Google Maps (address search, routes and journey times)</li>
              <li>AeroDataBox (flight times; we send flight numbers, not your name)</li>
              <li>Cloudinary (storing driver documents and photos)</li>
              <li>Expo and Google Firebase (app notifications)</li>
              <li>Resend (emails such as receipts)</li>
              <li>Railway (hosting our servers and database)</li>
              <li>Google Ads (measuring how our adverts perform, only if you accept cookies)</li>
            </ul>
          </li>
          <li>
            <strong>Your business account or care home</strong>, if they booked or paid for your
            journey.
          </li>
          <li>
            <strong>Professional advisers and insurers</strong>, if needed for a claim or legal
            matter.
          </li>
        </ul>
        <p>
          Some of these providers process data outside the UK, for example in the United States.
          When they do, we rely on UK adequacy regulations or approved safeguards such as the UK
          International Data Transfer Addendum.
        </p>
      </>
    ),
  },
  {
    id: "keep",
    title: "How long we keep it",
    body: (
      <ul>
        <li>
          <strong>Booking records:</strong> at least 12 months from the journey, as TfL requires.
          We may keep them longer where we need them for accounting, tax, or a complaint or claim.
        </li>
        <li>
          <strong>Payment and accounting records:</strong> as long as UK tax law requires.
        </li>
        <li>
          <strong>Flight-tracking data</strong> from our flight data provider: deleted
          automatically after 6 days.
        </li>
        <li>
          <strong>Driver records:</strong> for as long as the driver works with us and at least 12
          months after, as TfL requires.
        </li>
        <li>
          <strong>Your account:</strong> until you ask us to close it. We then delete or anonymise
          your details, except the records we must keep.
        </li>
      </ul>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>Under UK data protection law you can ask us to:</p>
        <ul>
          <li>give you a copy of the personal data we hold about you</li>
          <li>correct anything that&apos;s wrong or incomplete</li>
          <li>delete your data, where we don&apos;t need to keep it by law</li>
          <li>limit or object to how we use it</li>
          <li>send your data to you or another organisation in a portable format</li>
          <li>stop marketing messages, and withdraw any consent you&apos;ve given</li>
        </ul>
        <p>
          To use any of these rights, email <a href={EMAIL_HREF}>{EMAIL}</a>. We&apos;ll reply
          within one month. It&apos;s free in most cases.
        </p>
        <p>
          If you&apos;re unhappy with how we&apos;ve handled your data, please tell us first. You
          also have the right to complain to the Information Commissioner&apos;s Office at{" "}
          <a href="https://ico.org.uk/make-a-complaint/">ico.org.uk/make-a-complaint</a> or on 0303
          123 1113.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "Keeping your data safe",
    body: (
      <p>
        Access to booking and personal data is protected by login and limited to the people who
        need it. Data is encrypted in transit, and payment details are handled by Stripe rather
        than stored on our systems. Drivers can see only the details of the jobs assigned to them.
      </p>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and advertising",
    body: (
      <>
        <p>
          Our website advertises through Google Ads. If you choose <strong>Accept</strong> in the
          cookie banner, Google sets cookies that tell us when someone who clicked one of our adverts
          then contacts us, for example by tapping WhatsApp, call or email. This helps us see which
          adverts work. Google receives your browser and device details, the pages you visit on our
          site and which contact link you tap. It doesn&apos;t receive your name or phone number from
          us.
        </p>
        <p>
          If you choose <strong>Reject</strong>, we don&apos;t set these cookies. Google may still
          receive basic, cookie-free signals that help it estimate how adverts perform overall.
        </p>
        <p>
          We use these cookies only with your consent, and you can change your choice at any time
          using <strong>Cookie settings</strong> at the bottom of every page. Our apps don&apos;t
          use advertising cookies. Google&apos;s use of data is described at{" "}
          <a href="https://policies.google.com/technologies/partner-sites">
            policies.google.com/technologies/partner-sites
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        Our app is for adults. Children can travel with us when an adult books for them, and we
        don&apos;t knowingly create accounts for anyone under 18.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        We&apos;ll update this page if how we use personal data changes, and change the date at the
        top. If a change is significant, we&apos;ll also tell you in the app or by message.
      </p>
    ),
  },
];

export const PRIVACY_OTHER = { href: "/terms", label: "Terms & Conditions" };
