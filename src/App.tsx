import { Shield, EyeOff, Sparkles, Terminal } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { create } from "zustand";

interface AppState {
  isReady: boolean;
  setReady: (ready: boolean) => void;
}

const useStore = create<AppState>((set) => ({
  isReady: true,
  setReady: (ready) => set({ isReady: ready }),
}));

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const isReady = useStore((state) => state.isReady);

  return (
    <main
      className={cn(
        "flex h-screen w-screen items-center justify-center p-6",
        "bg-transparent"
      )}
    >
      <div className="w-full max-w-md rounded-2xl border border-zinc-800/80 bg-zinc-950/85 p-6 shadow-2xl backdrop-blur-xl text-zinc-100">
        <header className="flex items-center justify-between pb-4 border-b border-zinc-800/60">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-wide text-zinc-100">
                Sidekick Copilot
              </h1>
              <p className="text-xs text-zinc-400">
                Screen-share invisible HUD
              </p>
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {isReady ? "Ready" : "Initializing"}
          </span>
        </header>

        <section className="mt-4 space-y-3">
          <div className="rounded-xl bg-zinc-900/60 p-3 border border-zinc-800/50">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
              <EyeOff className="h-3.5 w-3.5 text-zinc-400" />
              <span>Invisibility Core</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
              Configured with macOS private API, transparent window, and screen-share exclusion.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-2 rounded-lg bg-zinc-900/40 p-2.5 border border-zinc-800/40 text-zinc-300">
              <Terminal className="h-3.5 w-3.5 text-sky-400" />
              <span className="text-[11px]">Tauri v2 + Rust</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-zinc-900/40 p-2.5 border border-zinc-800/40 text-zinc-300">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-[11px]">React 19 + Tailwind</span>
            </div>
          </div>
        </section>

        <footer className="mt-5 pt-3 border-t border-zinc-800/60 text-center">
          <p className="text-[10px] text-zinc-500">
            Press <kbd className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-zinc-300">Cmd + Shift + Space</kbd> to summon
          </p>
        </footer>
      </div>
    </main>
  );
}
