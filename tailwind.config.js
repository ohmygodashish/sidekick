/** @type {import('tailwindcss').Config} */

// Theme tokens from src/index.css; they switch with data-theme, so no alpha modifiers on these
const token = (name) => `var(--sk-${name})`;
const tokens = [
  "surface", "line", "fg", "fg-2", "fg-3", "fg-4", "fill", "fill-2", "hover",
  "accent", "accent-tint", "accent-solid", "accent-solid-hover", "on-solid", "focus",
  "danger", "danger-tint", "danger-solid", "danger-solid-hover", "warn", "success",
  "system", "mic",
  "code", "code-fg", "code-keyword", "code-string", "code-number", "code-comment", "code-punct",
];

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        sk: Object.fromEntries(tokens.map((name) => [name, token(name)])),
      },
    },
  },
  plugins: [],
};
