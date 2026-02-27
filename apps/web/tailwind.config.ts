import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        panel: "var(--panel)",
        text: "var(--text)",
        muted: "var(--muted)",
        accent: "var(--accent)",
        ok: "var(--ok)",
        warn: "var(--warn)",
        bad: "var(--bad)",
      },
      boxShadow: {
        card: "0 10px 30px rgba(13, 31, 56, 0.08)",
      },
      borderRadius: {
        xl2: "1rem",
      },
    },
  },
  plugins: [],
};

export default config;
