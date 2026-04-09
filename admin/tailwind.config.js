/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          // OrangeRide orange — exact match to website #ff8c1a
          50: "#fff8f0",
          100: "#ffefd9",
          200: "#ffd9a8",
          300: "#ffbf6b",
          400: "#ffa63d",
          500: "#ff8c1a", // ← exact website button colour
          600: "#e07200",
          700: "#b85d00",
          800: "#924a00",
          900: "#6b3600",
        },
        surface: {
          50: "#f8fafc",
          100: "#f1f5f9",
          900: "#0f1623",
          950: "#090d14",
        },
      },
      fontFamily: {
        sans: ["var(--font-sora)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: {
          from: { opacity: 0, transform: "translateY(8px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
