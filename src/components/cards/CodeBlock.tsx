import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../../lib/utils";

export interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
  maxHeight?: string;
  showLineNumbers?: boolean;
}

// Token classifications for syntax highlighting
const KEYWORDS = new Set([
  "def", "class", "return", "if", "elif", "else", "for", "while", "in", "break",
  "continue", "pass", "import", "from", "as", "try", "except", "finally", "raise",
  "with", "yield", "lambda", "async", "await", "global", "nonlocal", "assert",
  "function", "const", "let", "var", "switch", "case", "default", "throw",
  "new", "delete", "typeof", "instanceof", "void", "interface", "type", "export",
  "extends", "implements", "public", "private", "protected", "static", "readonly",
  "fn", "pub", "struct", "impl", "enum", "match", "mut", "use", "mod", "trait",
  "package", "go", "select", "chan", "defer", "where", "select", "insert",
]);

const TYPES = new Set([
  "int", "float", "str", "bool", "list", "dict", "set", "tuple", "any", "object",
  "number", "string", "boolean", "symbol", "bigint", "void", "never", "unknown",
  "i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "f32", "f64", "usize", "isize",
  "Vec", "Option", "Result", "String", "Self", "char", "double", "long",
]);

const CONSTANTS = new Set([
  "true", "false", "True", "False", "None", "null", "nil", "undefined", "self", "this",
]);

const TOKEN_REGEX =
  /(\/\/[^\n]*|#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_]\w*\b(?=\s*\())|(\b[a-zA-Z_]\w*\b)|(==|!=|<=|>=|=>|->|[+\-*/%=!<>])|(\s+)|([^\s\w])/g;

function highlightLine(line: string): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  TOKEN_REGEX.lastIndex = 0;

  while ((match = TOKEN_REGEX.exec(line)) !== null) {
    const [
      full,
      comment,
      str,
      num,
      func,
      word,
      operator,
      whitespace,
      punct,
    ] = match;

    const key = `${match.index}_${full}`;

    if (comment !== undefined) {
      elements.push(
        <span key={key} className="text-zinc-500 italic">
          {comment}
        </span>
      );
    } else if (str !== undefined) {
      elements.push(
        <span key={key} className="text-emerald-300">
          {str}
        </span>
      );
    } else if (num !== undefined) {
      elements.push(
        <span key={key} className="text-amber-300">
          {num}
        </span>
      );
    } else if (func !== undefined) {
      elements.push(
        <span key={key} className="text-sky-300 font-medium">
          {func}
        </span>
      );
    } else if (word !== undefined) {
      if (KEYWORDS.has(word)) {
        elements.push(
          <span key={key} className="text-purple-400 font-medium">
            {word}
          </span>
        );
      } else if (TYPES.has(word)) {
        elements.push(
          <span key={key} className="text-cyan-300 font-medium">
            {word}
          </span>
        );
      } else if (CONSTANTS.has(word)) {
        elements.push(
          <span key={key} className="text-rose-400 font-medium">
            {word}
          </span>
        );
      } else {
        elements.push(
          <span key={key} className="text-zinc-200">
            {word}
          </span>
        );
      }
    } else if (operator !== undefined) {
      elements.push(
        <span key={key} className="text-rose-300">
          {operator}
        </span>
      );
    } else if (whitespace !== undefined) {
      elements.push(<span key={key}>{whitespace}</span>);
    } else if (punct !== undefined) {
      elements.push(
        <span key={key} className="text-zinc-400">
          {punct}
        </span>
      );
    }

    lastIndex = TOKEN_REGEX.lastIndex;
  }

  // Any trailing slice
  if (lastIndex < line.length) {
    elements.push(
      <span key={`tail_${lastIndex}`}>{line.slice(lastIndex)}</span>
    );
  }

  return elements;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language = "python",
  className,
  maxHeight = "360px",
  showLineNumbers = true,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write failed (fallback)
    }
  };

  const lines = code ? code.split("\n") : [];

  return (
    <div
      data-testid="code-block"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
          handleCopy();
        }
      }}
      className={cn(
        "rounded-xl border border-zinc-800/80 bg-zinc-950/90 overflow-hidden shadow-inner flex flex-col group",
        className
      )}
    >
      {/* Top Header: Language badge & Copy Button */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/60 bg-zinc-900/40 select-none">
        <span
          data-testid="code-language-badge"
          className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-zinc-900 text-sky-400 border border-zinc-800"
        >
          {language}
        </span>

        <button
          type="button"
          data-testid="code-copy-btn"
          onClick={handleCopy}
          title="Copy code to clipboard (Cmd + C)"
          aria-label="Copy code to clipboard"
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-zinc-800/70 hover:bg-zinc-700/80 text-zinc-300 hover:text-zinc-100 border border-zinc-700/40 transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400 font-medium">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3 text-zinc-400" />
              <span>Copy</span>
              <kbd className="hidden sm:inline font-mono text-[9px] text-zinc-400 bg-zinc-900/80 px-1 py-0.2 rounded border border-zinc-800">
                ⌘C
              </kbd>
            </>
          )}
        </button>
      </div>

      {/* Screen reader & test accessible raw text */}
      <pre className="sr-only font-mono">{code}</pre>

      {/* Code Listing with Line Numbers */}
      <div
        className="p-3 overflow-x-auto overflow-y-auto custom-scrollbar"
        style={{ maxHeight }}
      >
        {lines.length === 0 ? (
          <div className="flex items-center gap-2 text-zinc-500 font-mono text-xs py-2">
            <span className="inline-block h-3.5 w-1.5 bg-sky-400 animate-pulse" />
            <span>Generating code solution...</span>
          </div>
        ) : (
          <div className="table w-full">
            {lines.map((line, idx) => (
              <div key={idx} className="table-row">
                {showLineNumbers && (
                  <span
                    data-testid={`line-number-${idx + 1}`}
                    className="table-cell select-none text-right pr-3.5 text-zinc-600 font-mono text-[11px] w-8 align-top"
                  >
                    {idx + 1}
                  </span>
                )}
                <span className="table-cell font-mono text-[11px] leading-relaxed whitespace-pre text-zinc-200">
                  {highlightLine(line)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
