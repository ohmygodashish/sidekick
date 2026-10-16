import React from "react";
import { useAppStore } from "../../store/appStore";

export const OpacityControl: React.FC = () => {
  const opacity = useAppStore((state) => state.opacity);
  const setOpacity = useAppStore((state) => state.setOpacity);

  return (
    <input
      id="sk-opacity"
      type="range"
      min={15}
      max={100}
      step={1}
      value={Math.round(opacity * 100)}
      onChange={(e) => setOpacity(Number(e.target.value) / 100)}
      className="h-1 min-w-0 flex-1 cursor-pointer accent-sk-accent-solid"
    />
  );
};
