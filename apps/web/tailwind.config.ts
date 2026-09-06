import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        canvas: "#0F1117",
        surface: "#171A23",
        "surface-alt": "#1F2230",
        border: "#2B2E3D",
        ink: "#E8E9F1",
        "ink-muted": "#8B8FA8",
        accent: {
          DEFAULT: "#5B6EF5",
          soft: "#1E2242",
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
