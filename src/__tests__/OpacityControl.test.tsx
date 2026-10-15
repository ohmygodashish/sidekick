import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OpacityControl } from "../components/hud/OpacityControl";
import { useAppStore } from "../store/appStore";

describe("OpacityControl", () => {
  const setOpacity = vi.fn();

  beforeEach(() => {
    setOpacity.mockClear();
    useAppStore.setState({ opacity: 0.85, setOpacity });
  });

  it("shows the store opacity as a percentage slider value", () => {
    render(<OpacityControl />);

    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.value).toBe("85");
    expect(slider.min).toBe("15");
    expect(slider.max).toBe("100");
  });

  it("calls setOpacity with value / 100 when the slider changes", () => {
    render(<OpacityControl />);

    fireEvent.change(screen.getByRole("slider"), { target: { value: "50" } });
    expect(setOpacity).toHaveBeenCalledWith(0.5);
  });
});
