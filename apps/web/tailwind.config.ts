import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        canvas: "#F7F7FA",
        surface: "#FFFFFF",
        "surface-alt": "#EDEEF3",
        border: "#DBDCE6",
        ink: "#1B1D29",
        "ink-muted": "#5B5E72",
        accent: {
          DEFAULT: "#3651D4",
          soft: "#E7EAFC",
        },
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
