import type { Config } from "tailwindcss";
const v = (n: string) => `rgb(var(--${n}) / <alpha-value>)`;
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"), bg2: v("bg2"), surface: v("surface"), border: v("border"), ink: v("ink"), muted: v("muted"),
        accent: v("accent"), accent2: v("accent2"), highlight: v("highlight"), ok: v("ok"), err: v("err"),
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
