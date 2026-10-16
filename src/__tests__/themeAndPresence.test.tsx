import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { usePresence, EXIT_MS } from "../hooks/usePresence";
import { useTheme } from "../hooks/useTheme";
import { useSettingsStore } from "../store/settingsStore";

function PresenceProbe({ open }: { open: boolean }) {
  const { mounted, state } = usePresence(open);
  return mounted ? <div data-testid="probe" data-state={state} /> : null;
}

function ThemeHost() {
  useTheme();
  return null;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeSwitching;
});

describe("usePresence", () => {
  it("keeps a closing element for its exit, and reopening mid-exit keeps it", () => {
    vi.useFakeTimers();
    const { rerender, queryByTestId } = render(<PresenceProbe open />);

    rerender(<PresenceProbe open={false} />);
    expect(queryByTestId("probe")?.dataset.state).toBe("closed");

    act(() => vi.advanceTimersByTime(EXIT_MS / 2));
    rerender(<PresenceProbe open />);
    act(() => vi.advanceTimersByTime(EXIT_MS));
    expect(queryByTestId("probe")?.dataset.state).toBe("open");

    rerender(<PresenceProbe open={false} />);
    act(() => vi.advanceTimersByTime(EXIT_MS));
    expect(queryByTestId("probe")).toBeNull();
  });
});

describe("useTheme", () => {
  it("applies an explicit theme, and System follows macOS until unmounted", () => {
    const listeners = new Set<() => void>();
    const media = {
      matches: false,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
    vi.spyOn(window, "matchMedia").mockReturnValue(media as unknown as MediaQueryList);

    useSettingsStore.setState({ theme: "light" });
    const { unmount } = render(<ThemeHost />);
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => useSettingsStore.setState({ theme: "system" }));
    expect(document.documentElement.dataset.theme).toBe("dark");

    media.matches = true;
    act(() => listeners.forEach((fn) => fn()));
    expect(document.documentElement.dataset.theme).toBe("light");

    unmount();
    expect(listeners.size).toBe(0);
  });

  it("switches theme in one frame: transitions are off for two frames, but not on first apply", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
    useSettingsStore.setState({ theme: "dark" });
    render(<ThemeHost />);
    expect(document.documentElement.dataset.themeSwitching).toBeUndefined();

    act(() => useSettingsStore.setState({ theme: "light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themeSwitching).toBe("");

    act(() => vi.advanceTimersToNextFrame());
    expect(document.documentElement.dataset.themeSwitching).toBe("");
    act(() => vi.advanceTimersToNextFrame());
    expect(document.documentElement.dataset.themeSwitching).toBeUndefined();
  });
});
