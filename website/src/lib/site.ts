// Every contact detail and store link on the site comes from here.

export const SITE_URL = "https://orangeride.co.uk";

export const PHONE_DISPLAY = "07398 341839";
export const PHONE_E164 = "+447398341839";
export const PHONE_HREF = `tel:${PHONE_E164}`;
export const WHATSAPP_HREF = "https://wa.me/447398341839";
export const EMAIL = "admin@orangeride.co.uk";
export const EMAIL_HREF = `mailto:${EMAIL}`;

export const PASSENGER_IOS = "https://apps.apple.com/gb/app/orangeride/id6762009896";
export const PASSENGER_ANDROID =
  "https://play.google.com/store/apps/details?id=com.orangeride.passenger";
export const DRIVER_IOS = "https://apps.apple.com/gb/app/orangeride-driver/id6762009686";
export const DRIVER_ANDROID = "https://play.google.com/store/apps/details?id=com.orangeride.driver";
/** Driver application (Google Form, public link). */
export const DRIVER_APPLY_URL =
  "https://docs.google.com/forms/d/1MvbvmyebFUgcj5jkr4mKoOI8CLsiF4XmP6GSlmtEWqE/viewform";

export const TFL_LICENCE = "11786";

// The only address published on the site: the TfL operating centre.
export const OPERATING_CENTRE = "Unit 2, 12 Deer Park Road, South Wimbledon, London SW19 3TL";

// Hotel booking site (white label run by Nuitée / LiteAPI, merchant of record). Override with
// NEXT_PUBLIC_HOTELS_DOMAIN (e.g. the *.nuitee.link address while the custom domain is set up).
export const HOTELS_DOMAIN = process.env.NEXT_PUBLIC_HOTELS_DOMAIN || "hotels.orangeride.co.uk";
/** Google place ID of London Gatwick Airport (LGW), as the hotel site uses it. */
export const GATWICK_PLACE_ID = "ChIJGzkffd7vdUgR_3OJAb-k3Vk";
/** /gatwick/hotels stays out of Google, the sitemap and the menus until hotel bookings go live. */
export const HOTELS_LIVE = process.env.NEXT_PUBLIC_HOTELS_LIVE === "true";
