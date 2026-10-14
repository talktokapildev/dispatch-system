import Script from "next/script";
import { CONSENT_KEY, GOOGLE_TAG_ID } from "@/lib/analytics";

/**
 * Google tag (Google Ads) with Consent Mode v2.
 * Everything is "denied" until the visitor accepts in the cookie banner; a stored choice is re-applied
 * before the tag loads, so returning visitors aren't asked again.
 */
export default function GoogleTag() {
  const init = `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('consent', 'default', {
  ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
  analytics_storage: 'denied', wait_for_update: 500
});
gtag('set', 'ads_data_redaction', true);
gtag('set', 'url_passthrough', true);
try {
  if (localStorage.getItem('${CONSENT_KEY}') === 'granted') {
    gtag('consent', 'update', {
      ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted'
    });
  }
} catch (e) {}
gtag('js', new Date());
gtag('config', '${GOOGLE_TAG_ID}');
`;
  return (
    <>
      {/* Plain inline script: runs while the HTML is parsed, before gtag.js loads. */}
      <script id="google-consent-init" dangerouslySetInnerHTML={{ __html: init }} />
      <Script
        id="google-tag"
        src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_TAG_ID}`}
        strategy="afterInteractive"
      />
    </>
  );
}
