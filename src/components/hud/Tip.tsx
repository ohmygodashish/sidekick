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
 */
export const Tip: React.FC<TipProps> = ({ label, keys, disabled, children }) => {
  const id = useId();
  return (
    <span className="sk-tip-host relative inline-flex">
      {disabled ? children : React.cloneElement(children, { "aria-describedby": id })}
      {!disabled && (
        <span id={id} role="tooltip" className="sk-tip">
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
