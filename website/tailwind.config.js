/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      screens: {
        // Full desktop header from here; below it the header shows a Menu button.
        // 1200px: below this the links + phone + "Get the app" don't fit on one line.
        nav: "1200px",
      },
      colors: {
        // Colours from the approved canvas (Light-v4 / Privacy / Terms)
        page: "#f1f5f9", // page background
        ink: "#2e3238", // dark grey: strip, flight section, closing banner, footer, headings
        "ink-2": "#3a3f46", // secondary dark
        amber: "#f59e0b", // CTA background (text on it is ink)
        accent: "#e06800", // orange accent text (hero)
        "accent-dark": "#b45309", // eyebrow labels, links
        body: "#4b5563", // body text
        line: "#e5e7eb", // card borders
        muted: "#6b7280",
        soft: "#374151",
      },
      fontFamily: {
        sans: ["var(--font-body)", "system-ui", "-apple-system", "sans-serif"],
        heading: ["var(--font-heading)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        // 1240px content + 2 x 24px padding (the canvas uses content-box sizing)
        site: "1288px",
      },
    },
  },
  plugins: [],
};
