import React, { useId } from "react";

interface TipProps {
  label: string;
  keys?: string[];
  disabled?: boolean; // hides the hint, e.g. while the button's menu is open
  children: React.ReactElement<{ "aria-describedby"?: string }>;
}

/**
 * Hover and keyboard-focus hint under a pill button: the action name and its keys. It is not a
 * surface (no hit region) and never takes pointer events or focus; the CSS is `.sk-tip` in index.css.
 * Once one tip has shown, the others in the same surface show instantly while the pointer stays on it
 * (`.sk-tips-warm`).
 */
export const Tip: React.FC<TipProps> = ({ label, keys, disabled, children }) => {
  const id = useId();
  return (
    <span className="sk-tip-host relative inline-flex">
      {disabled ? children : React.cloneElement(children, { "aria-describedby": id })}
      {!disabled && (
        <span
          id={id}
          role="tooltip"
          className="sk-tip"
          onTransitionEnd={(e) => {
            // The key caps inside bubble their own transitions
            if (e.target !== e.currentTarget) return;
            const surface = e.currentTarget.closest(".sk-bar, .sk-surface, .sk-panel, .sk-menu");
            if (!surface) return;
            // Shown on hover: warm the surface (a keyboard-focus tip doesn't). Hidden after the pointer left: cool it
            if (getComputedStyle(e.currentTarget).opacity === "1") {
              if (surface.hasAttribute("data-hover")) surface.classList.add("sk-tips-warm");
            }
            else if (!surface.hasAttribute("data-hover")) surface.classList.remove("sk-tips-warm");
          }}
        >
          {label}
          {keys?.map((key) => (
            <kbd key={key} className="sk-kbd">
              {key}
            </kbd>
          ))}
        </span>
      )}
    </span>
  );
};
