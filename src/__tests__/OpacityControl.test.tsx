import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OpacityControl } from "../components/hud/OpacityControl";
import { useAppStore } from "../store/appStore";

describe("OpacityControl", () => {
  beforeEach(() => {
    useAppStore.setState({ opacity: 0.85 });
  });

  it("renders with initial 85% opacity label", () => {
    render(<OpacityControl />);
    expect(screen.getByText("85%")).toBeDefined();
    const slider = screen.getByLabelText("Window Opacity") as HTMLInputElement;
    expect(slider.value).toBe("0.85");
  });

  it("updates store opacity when slider changes", () => {
    render(<OpacityControl />);
    const slider = screen.getByLabelText("Window Opacity");

    fireEvent.change(slider, { target: { value: "0.5" } });
    expect(useAppStore.getState().opacity).toBe(0.5);
    expect(screen.getByText("50%")).toBeDefined();
  });

  it("renders in compact mode without 'Alpha' text label", () => {
    const { rerender } = render(<OpacityControl compact={false} />);
    expect(screen.getByText("Alpha")).toBeDefined();

    rerender(<OpacityControl compact={true} />);
    expect(screen.queryByText("Alpha")).toBeNull();
  });
});
