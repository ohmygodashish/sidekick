/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        waveform: {
          "0%, 100%": { height: "4px" },
          "50%": { height: "16px" },
        },
      },
      animation: {
        "waveform-1": "waveform 1.1s ease-in-out infinite",
        "waveform-2": "waveform 0.8s ease-in-out infinite 0.15s",
        "waveform-3": "waveform 1.3s ease-in-out infinite 0.35s",
        "waveform-4": "waveform 0.7s ease-in-out infinite 0.1s",
        "waveform-5": "waveform 1.0s ease-in-out infinite 0.25s",
      },
    },
  },
  plugins: [],
};
