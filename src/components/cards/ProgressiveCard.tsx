import React, { useId, useState } from "react";
import { ChevronDown, Clock, CodeXml } from "lucide-react";
import type { ProgressiveSolution } from "../../store/sessionStore";
import { CodeBlock } from "./CodeBlock";
import { cn } from "../../lib/utils";

// A half-received tag such as "<verbal" is streaming noise, not an answer
const PARTIAL_TAG = /^\s*<[a-z_0-9]*$/i;

const listOfStrings = (items: unknown): string[] =>
  Array.isArray(items) ? items.filter((x): x is string => typeof x === "string") : [];

interface SectionProps {
  rowTestId: string;
  icon: React.ReactNode;
  label: string;
  detail?: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ rowTestId, icon, label, detail, defaultOpen, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div>
      <button
        type="button"
        data-testid={rowTestId}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((o) => !o)}
        className="sk-row"
      >
        {icon}
        <span className="min-w-0 truncate">
          {label}
          {detail && <span className="text-sk-fg-3"> · {detail}</span>}
        </span>
        <ChevronDown
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0 text-sk-fg-3 transition-transform duration-150",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>
      <div id={contentId} hidden={!open} className="space-y-2 pt-2">
        {children}
      </div>
    </div>
  );
};

export interface ProgressiveCardProps {
  solution: ProgressiveSolution | null;
  className?: string;
}

export const ProgressiveCard: React.FC<ProgressiveCardProps> = ({ solution, className }) => {
  const stage1 = solution?.stage1Intuition;
  const stage2 = solution?.stage2Code;
  const stage3 = solution?.stage3Analysis;

  const rawSummary = typeof stage1?.verbalSummary === "string" ? stage1.verbalSummary : "";
  const summary = PARTIAL_TAG.test(rawSummary) ? "" : rawSummary;
  const tradeoffs = listOfStrings(stage1?.keyTradeoffs).slice(0, 3);

  const hasCode = Boolean(stage2?.code);
  const edgeCases = listOfStrings(stage3?.edgeCases);
  const complexity = [
    stage3?.timeComplexity && `${stage3.timeComplexity} time`,
    stage3?.spaceComplexity && `${stage3.spaceComplexity} space`,
  ]
    .filter(Boolean)
    .join(" · ");
  const hasComplexity = Boolean(complexity || edgeCases.length > 0);

  if (!summary && tradeoffs.length === 0 && !hasCode && !hasComplexity) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {summary && (
        <p data-testid="answer-summary" className="sk-body">
          {summary}
        </p>
      )}

      {tradeoffs.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-sk-fg-2">
          {tradeoffs.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}

      {hasCode && stage2 && (
        <Section
          rowTestId="answer-code-row"
          icon={<CodeXml className="h-3.5 w-3.5 shrink-0 text-sk-fg-3" aria-hidden="true" />}
          label="Code"
          detail={stage2.language || undefined}
          defaultOpen
        >
          {stage2.explanation && <p className="sk-meta">{stage2.explanation}</p>}
          <CodeBlock code={stage2.code} language={stage2.language} />
        </Section>
      )}

      {hasComplexity && (
        <Section
          rowTestId="answer-complexity-row"
          icon={<Clock className="h-3.5 w-3.5 shrink-0 text-sk-fg-3" aria-hidden="true" />}
          label="Complexity"
          detail={complexity || undefined}
          defaultOpen={false}
        >
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-sk-fg-2">
            {edgeCases.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
};
