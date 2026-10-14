/** @type {import('next').NextConfig} */

// Old WordPress URLs (from https://orangeride.co.uk/wp-sitemap.xml and the old menus/footer)
// mapped to the new site. All permanent (308).
//
// WordPress URLs end in "/" (e.g. /privacy-policy/). Next.js first strips the trailing slash
// (308 -> /privacy-policy), then applies the redirect below (308 -> /privacy): two permanent hops,
// which browsers, Google and the app stores all follow.
const OLD_TO_NEW = [
  // Registered as the privacy policy URL in App Store Connect and Google Play Console.
  ["/privacy-policy", "/privacy"],
  ["/hello-world", "/"],
  ["/category/:slug*", "/"],
  ["/2026/:month*", "/"],
  ["/author/:slug*", "/"],
  ["/feed", "/"],
  ["/comments/feed", "/"],
  ["/wp-sitemap.xml", "/sitemap.xml"],
  ["/wp-sitemap-:part.xml", "/sitemap.xml"],
  ["/sitemap_index.xml", "/sitemap.xml"],
  ["/wp-admin/:path*", "/"],
  ["/wp-login.php", "/"],
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    return [
      // www.orangeride.co.uk -> orangeride.co.uk (the apex is the canonical address)
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.orangeride.co.uk" }],
        destination: "https://orangeride.co.uk/:path*",
        permanent: true,
      },
      ...OLD_TO_NEW.map(([source, destination]) => ({ source, destination, permanent: true })),
    ];
  },
};

module.exports = nextConfig;
