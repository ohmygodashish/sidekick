import React, { Fragment, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../../lib/utils";

export interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

const KEYWORDS = new Set([
  // control flow and declarations
  "def", "class", "return", "if", "elif", "else", "for", "while", "in", "break",
  "continue", "pass", "import", "from", "as", "try", "except", "finally", "raise",
  "with", "yield", "lambda", "async", "await", "global", "nonlocal", "assert",
  "function", "const", "let", "var", "switch", "case", "default", "throw",
  "new", "delete", "typeof", "instanceof", "void", "interface", "type", "export",
  "extends", "implements", "public", "private", "protected", "static", "readonly",
  "fn", "pub", "struct", "impl", "enum", "match", "mut", "use", "mod", "trait",
  "package", "go", "select", "chan", "defer", "where", "insert",
  // literals
  "true", "false", "True", "False", "None", "null", "nil", "undefined", "self", "this",
]);

// Languages whose line comments start with '#'. Everything else uses '//'.
const HASH_COMMENT_LANGS = new Set([
  "python", "py", "ruby", "rb", "shell", "sh", "bash", "zsh", "yaml", "yml", "r", "perl", "toml",
]);

const STRING = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/.source;
const COMMENT = { "#": /#[^\n]*/.source, "//": /\/\/[^\n]*/.source };
// Groups after comment (1) and string (2): number, call, word, operator, whitespace, other punctuation.
const REST =
  /(\b\d[\w.]*)|(\b[a-zA-Z_]\w*\b(?=\s*\())|(\b[a-zA-Z_]\w*\b)|(==|!=|<=|>=|=>|->|[+\-*/%=!<>])|(\s+)|([^\s\w])/
    .source;

const patternCache = new Map<"#" | "//", RegExp>();

// Built once per comment style. matchAll clones the regex, so the cached one stays stateless.
function tokenPattern(language: string): RegExp {
  const marker = HASH_COMMENT_LANGS.has(language.toLowerCase()) ? "#" : "//";
  let pattern = patternCache.get(marker);
  if (!pattern) {
    pattern = new RegExp(`(${COMMENT[marker]})|(${STRING})|${REST}`, "g");
    patternCache.set(marker, pattern);
  }
  return pattern;
}

function highlightLine(line: string, pattern: RegExp): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;

  for (const match of line.matchAll(pattern)) {
    const [text, comment, str, num, func, word, op, , punct] = match;
    const at = match.index ?? 0;

    // Text no token claims stays plain so the line always renders in full
    if (at > last) nodes.push(line.slice(last, at));
    last = at + text.length;

    let cls: string | undefined;
    if (comment) cls = "text-zinc-500 italic";
    else if (str) cls = "text-emerald-300";
    else if (num) cls = "text-amber-200";
    else if (func) cls = KEYWORDS.has(func) ? "text-sky-300" : "text-zinc-100";
    else if (word) cls = KEYWORDS.has(word) ? "text-sky-300" : "text-zinc-200";
    else if (op || punct) cls = "text-zinc-400";

    nodes.push(cls ? <span key={at} className={cls}>{text}</span> : text);
  }

  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language = "", className }) => {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable or denied: leave the button as it was
    }
  };

  const pattern = tokenPattern(language);

  return (
    <div className={cn("overflow-hidden rounded-lg bg-black/30 ring-1 ring-inset ring-white/5", className)}>
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="sk-meta">{language}</span>
        <button type="button" onClick={handleCopy} className="sk-btn">
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Copy
            </>
          )}
        </button>
      </div>

      <div className="overflow-x-auto sk-scroll">
        <pre className="px-3 py-2 font-mono text-[12px] leading-5 text-zinc-200">
          {code.split("\n").map((line, i) => (
            <Fragment key={i}>
              {i > 0 && "\n"}
              {highlightLine(line, pattern)}
            </Fragment>
          ))}
        </pre>
      </div>
    </div>
  );
};
