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
    if (comment) cls = "text-sk-code-comment italic";
    else if (str) cls = "text-sk-code-string";
    else if (num) cls = "text-sk-code-number";
    else if (func) cls = KEYWORDS.has(func) ? "text-sk-code-keyword" : "text-sk-code-fg";
    else if (word) cls = KEYWORDS.has(word) ? "text-sk-code-keyword" : "text-sk-code-fg";
    else if (op || punct) cls = "text-sk-code-punct";

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
    <div className={cn("overflow-hidden rounded-lg bg-sk-code ring-1 ring-inset ring-sk-line", className)}>
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="sk-meta">{language}</span>
        <button type="button" onClick={handleCopy} className="sk-btn">
          {/* Keyed so the swap cross-fades instead of popping */}
          <span key={copied ? "copied" : "copy"} className="sk-fade inline-flex items-center gap-1.5">
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-sk-success" aria-hidden="true" />
                <span className="text-sk-success">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                Copy
              </>
            )}
          </span>
        </button>
      </div>

      <div className="overflow-x-auto sk-scroll">
        <pre className="px-3 py-2 font-mono text-[12px] leading-5 text-sk-code-fg">
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
