import {
  ProgressiveSolution,
  Stage1Intuition,
  Stage2Code,
  Stage3Analysis,
} from "../../store/sessionStore";

/**
 * Extracts inner content of a tag even if the closing tag hasn't arrived yet (streaming mode).
 */
function extractTagContent(
  text: string,
  tagName: string,
  boundaryTag?: string
): string | null {
  // Find open tag with boundary
  const openRegex = new RegExp(`<${tagName}(?:>|\\s[^>]*>)`, "i");
  const openMatch = openRegex.exec(text);
  if (!openMatch) return null;

  const startIndex = openMatch.index + openMatch[0].length;
  let remaining = text.slice(startIndex);

  // Check if boundary tag exists before our closing tag
  if (boundaryTag) {
    const boundaryRegex = new RegExp(`</?${boundaryTag}(?:>|\\s[^>]*>)`, "i");
    const bMatch = boundaryRegex.exec(remaining);
    if (bMatch) {
      remaining = remaining.slice(0, bMatch.index);
    }
  }

  // Find close tag if present
  const closeRegex = new RegExp(`</${tagName}>`, "i");
  const closeMatch = closeRegex.exec(remaining);
  const content = closeMatch ? remaining.slice(0, closeMatch.index) : remaining;

  return content.trim();
}

/**
 * Extracts multiple occurrences of a tag (e.g. <tradeoff> or <edge_case>).
 */
function extractMultipleTags(text: string, tagName: string): string[] {
  const results: string[] = [];
  // 1. Closed tags
  const closedRegex = new RegExp(`<${tagName}(?:>|\\s[^>]*>)([\\s\\S]*?)<\\/${tagName}>`, "gi");
  let match: RegExpExecArray | null;
  let lastEnd = 0;

  while ((match = closedRegex.exec(text)) !== null) {
    const val = match[1].replace(/<[^>]+>/g, "").trim();
    if (val) {
      results.push(val);
    }
    lastEnd = match.index + match[0].length;
  }

  // 2. Trailing unclosed tag if streaming
  const trailingRegex = new RegExp(`<${tagName}(?:>|\\s[^>]*>)([^<]*)$`, "i");
  const trailingMatch = trailingRegex.exec(text.slice(lastEnd));
  if (trailingMatch) {
    const val = trailingMatch[1].trim();
    if (val) {
      results.push(val);
    }
  }

  return results;
}

/**
 * Parses markdown fallback when LLM does not strictly output XML tags.
 */
function parseMarkdownFallback(rawText: string): ProgressiveSolution | null {
  const hasMarkdownStages =
    /stage\s*1/i.test(rawText) ||
    /stage\s*2/i.test(rawText) ||
    /stage\s*3/i.test(rawText) ||
    /```[a-z]*\n/i.test(rawText);

  if (!hasMarkdownStages) return null;

  let stage1: Stage1Intuition | null = null;
  let stage2: Stage2Code | null = null;
  let stage3: Stage3Analysis | null = null;

  // Extract Code Block
  const codeBlockMatch = /```([a-zA-Z0-9_+#-]*)\n([\s\S]*?)```/.exec(rawText);
  if (codeBlockMatch) {
    stage2 = {
      language: codeBlockMatch[1] || "python",
      code: codeBlockMatch[2].trim(),
      explanation: "Extracted code implementation.",
    };
  }

  // Extract Stage 1 section
  const stage1Match = /(?:###?\s*(?:Stage\s*1|Intuition)[^\n]*\n)([\s\S]*?)(?:###?\s*Stage\s*2|```|$)/i.exec(
    rawText
  );
  if (stage1Match) {
    const stage1Body = stage1Match[1].trim();
    const lines = stage1Body.split("\n").map((l) => l.trim()).filter(Boolean);
    const bullets = lines
      .filter((l) => /^[-*•›]/.test(l))
      .map((l) => l.replace(/^[-*•›]\s*/, "").trim());
    const prose = lines.filter((l) => !/^[-*•›]/.test(l)).join(" ");

    stage1 = {
      verbalSummary: prose || stage1Body.slice(0, 300),
      keyTradeoffs: bullets.length > 0 ? bullets : ["Evaluated algorithmic time/space trade-offs"],
    };
  }

  // Extract Stage 3 section
  const stage3Match = /(?:###?\s*(?:Stage\s*3|Complexity|Edge Cases)[^\n]*\n)([\s\S]*?)$/i.exec(
    rawText
  );
  if (stage3Match) {
    const stage3Body = stage3Match[1].trim();
    const timeMatch = /time\s*complexity[:\s-]*([^\n.]+)/i.exec(stage3Body);
    const spaceMatch = /space\s*complexity[:\s-]*([^\n.]+)/i.exec(stage3Body);
    const lines = stage3Body.split("\n").map((l) => l.trim()).filter(Boolean);
    const bullets = lines
      .filter((l) => /^[-*•›]/.test(l))
      .map((l) => l.replace(/^[-*•›]\s*/, "").trim());

    stage3 = {
      timeComplexity: timeMatch ? timeMatch[1].trim() : "O(N)",
      spaceComplexity: spaceMatch ? spaceMatch[1].trim() : "O(1)",
      edgeCases: bullets.length > 0 ? bullets : ["Empty or single-element input"],
    };
  }

  if (!stage1 && !stage2 && !stage3) return null;

  return {
    stage1Intuition: stage1,
    stage2Code: stage2,
    stage3Analysis: stage3,
  };
}

/**
 * Parses JSON fallback if the response arrived as raw JSON.
 */
function parseJsonFallback(rawText: string): ProgressiveSolution | null {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{")) return null;

  try {
    const obj = JSON.parse(trimmed);
    const s1 = obj.stage_1_intuition || obj.stage1Intuition;
    const s2 = obj.stage_2_code || obj.stage2Code;
    const s3 = obj.stage_3_analysis || obj.stage3Analysis;

    if (!s1 && !s2 && !s3) return null;

    return {
      stage1Intuition: s1
        ? {
            verbalSummary: s1.verbal_summary || s1.verbalSummary || "",
            keyTradeoffs: Array.isArray(s1.key_tradeoffs || s1.keyTradeoffs)
              ? s1.key_tradeoffs || s1.keyTradeoffs
              : [],
          }
        : null,
      stage2Code: s2
        ? {
            language: s2.language || "python",
            code: s2.code || "",
            explanation: s2.explanation || "",
          }
        : null,
      stage3Analysis: s3
        ? {
            timeComplexity: s3.time_complexity || s3.timeComplexity || "",
            spaceComplexity: s3.space_complexity || s3.spaceComplexity || "",
            edgeCases: Array.isArray(s3.edge_cases || s3.edgeCases)
              ? s3.edge_cases || s3.edgeCases
              : [],
          }
        : null,
    };
  } catch {
    return null;
  }
}

/**
 * Progressively parses stream tokens into Stage 1, Stage 2, and Stage 3 (REQ-015, AC-006).
 * Handles partial / unclosed streaming tags gracefully so updates appear in real time.
 */
export function parseProgressiveStream(
  rawText: string,
  metadata?: { questionId?: string; provider?: string; model?: string }
): ProgressiveSolution {
  if (!rawText || !rawText.trim()) {
    return {
      questionId: metadata?.questionId,
      provider: metadata?.provider,
      model: metadata?.model,
      stage1Intuition: null,
      stage2Code: null,
      stage3Analysis: null,
    };
  }

  // 1. Try primary XML tag parsing
  const hasStage1Tag = /<stage_1_intuition/i.test(rawText);
  const hasStage2Tag = /<stage_2_code/i.test(rawText);
  const hasStage3Tag = /<stage_3_analysis/i.test(rawText);

  let stage1: Stage1Intuition | null = null;
  let stage2: Stage2Code | null = null;
  let stage3: Stage3Analysis | null = null;

  if (hasStage1Tag || hasStage2Tag || hasStage3Tag) {
    // ── STAGE 1: INTUITION ──
    if (hasStage1Tag) {
      const stage1Section = extractTagContent(rawText, "stage_1_intuition") || rawText;
      let verbalSummary = extractTagContent(stage1Section, "verbal_summary", "key_tradeoffs") || "";
      // Strip any nested tags if raw
      verbalSummary = verbalSummary.replace(/<[^>]+>/g, "").trim();

      let tradeoffs = extractMultipleTags(stage1Section, "tradeoff");
      if (tradeoffs.length === 0) {
        // Check for bullet lines inside key_tradeoffs
        const ktContent = extractTagContent(stage1Section, "key_tradeoffs");
        if (ktContent) {
          tradeoffs = ktContent
            .split("\n")
            .map((l) => l.replace(/<[^>]+>/g, "").trim())
            .filter((l) => l.length > 0 && (l.startsWith("-") || l.startsWith("•") || l.startsWith("›")))
            .map((l) => l.replace(/^[-•›]\s*/, "").trim());
        }
      }

      if (verbalSummary || tradeoffs.length > 0) {
        stage1 = {
          verbalSummary,
          keyTradeoffs: tradeoffs,
        };
      }
    }

    // ── STAGE 2: CODE ──
    if (hasStage2Tag) {
      const stage2Section = extractTagContent(rawText, "stage_2_code") || rawText;
      let language = extractTagContent(stage2Section, "language", "code") || "python";
      language = language.replace(/<[^>]+>/g, "").trim().toLowerCase();

      let code = extractTagContent(stage2Section, "code", "explanation") || "";
      // Strip markdown code fence markers if model accidentally included them inside <code>
      code = code.replace(/^```[a-zA-Z0-9_+#-]*\n/, "").replace(/```$/, "").trim();

      let explanation = extractTagContent(stage2Section, "explanation") || "";
      explanation = explanation.replace(/<[^>]+>/g, "").trim();

      if (code || explanation) {
        stage2 = {
          language: language || "python",
          code,
          explanation,
        };
      }
    }

    // ── STAGE 3: ANALYSIS ──
    if (hasStage3Tag) {
      const stage3Section = extractTagContent(rawText, "stage_3_analysis") || rawText;
      let timeComplexity =
        extractTagContent(stage3Section, "time_complexity", "space_complexity") || "";
      timeComplexity = timeComplexity.replace(/<[^>]+>/g, "").trim();

      let spaceComplexity =
        extractTagContent(stage3Section, "space_complexity", "edge_cases") || "";
      spaceComplexity = spaceComplexity.replace(/<[^>]+>/g, "").trim();

      let edgeCases = extractMultipleTags(stage3Section, "edge_case");
      if (edgeCases.length === 0) {
        const ecContent = extractTagContent(stage3Section, "edge_cases");
        if (ecContent) {
          edgeCases = ecContent
            .split("\n")
            .map((l) => l.replace(/<[^>]+>/g, "").trim())
            .filter((l) => l.length > 0 && (l.startsWith("-") || l.startsWith("•") || l.startsWith("›")))
            .map((l) => l.replace(/^[-•›]\s*/, "").trim());
        }
      }

      if (timeComplexity || spaceComplexity || edgeCases.length > 0) {
        stage3 = {
          timeComplexity,
          spaceComplexity,
          edgeCases,
        };
      }
    }

    return {
      questionId: metadata?.questionId,
      provider: metadata?.provider,
      model: metadata?.model,
      stage1Intuition: stage1,
      stage2Code: stage2,
      stage3Analysis: stage3,
    };
  }

  // 2. Try JSON Fallback
  const jsonResult = parseJsonFallback(rawText);
  if (jsonResult) {
    return {
      questionId: metadata?.questionId,
      provider: metadata?.provider,
      model: metadata?.model,
      ...jsonResult,
    };
  }

  // 3. Try Markdown Fallback
  const mdResult = parseMarkdownFallback(rawText);
  if (mdResult) {
    return {
      questionId: metadata?.questionId,
      provider: metadata?.provider,
      model: metadata?.model,
      ...mdResult,
    };
  }

  // If unformatted text but has content, treat as Stage 1 verbal intuition
  return {
    questionId: metadata?.questionId,
    provider: metadata?.provider,
    model: metadata?.model,
    stage1Intuition: {
      verbalSummary: rawText.trim(),
      keyTradeoffs: [],
    },
    stage2Code: null,
    stage3Analysis: null,
  };
}

/**
 * Common SSE stream chunk processor for browser ReadableStream.
 */
export async function readSSEStream(
  response: Response,
  onLine: (line: string) => void,
  signal?: AbortSignal,
  onActivity?: () => void
): Promise<void> {
  if (!response.body) {
    throw new Error("HTTP response has no readable body stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;
      onActivity?.();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          onLine(trimmed);
        }
      }
    }

    if (buffer.trim()) {
      onLine(buffer.trim());
    }
  } finally {
    reader.releaseLock();
  }
}
