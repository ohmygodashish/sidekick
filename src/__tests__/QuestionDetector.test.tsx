import { describe, it, expect } from "vitest";
import {
  stripFillerWords,
  classifyQuestionIntent,
  generateQuickPointers,
} from "../services/ai/questionDetector";

// Local heuristics used for live options when there is no Groq key
describe("question heuristics", () => {
  describe("1. Filler Stripping & Cleaning (REQ-011)", () => {
    it("strips conversational filler from brief prompt simulation", () => {
      const input =
        "Um, yeah, so I was wondering, how would you design a distributed cache to handle hot keys?";
      const cleaned = stripFillerWords(input);

      expect(cleaned).toBe(
        "How would you design a distributed cache to handle hot keys?"
      );
    });

    it("strips conversational phrases like 'can you hear me' and 'so basically'", () => {
      const input =
        "Can you hear me? Uh, so basically, what are the trade-offs between SQL and NoSQL?";
      const cleaned = stripFillerWords(input);

      expect(cleaned).toBe("What are the trade-offs between SQL and NoSQL?");
    });

    it("strips leading filler sounds and words ('um', 'uh', 'like', 'well', 'you know')", () => {
      expect(stripFillerWords("Um, how does Raft handle leader election?")).toBe(
        "How does Raft handle leader election?"
      );
      expect(
        stripFillerWords("Like, so, walk me through your concurrency model.")
      ).toBe("Walk me through your concurrency model.");
      expect(
        stripFillerWords("Well, you know, could you implement an LRU cache?")
      ).toBe("Could you implement an LRU cache?");
    });

    it("strips trailing conversational tags (e.g., ', you know?')", () => {
      const input = "How would you handle network partitions, you know?";
      const cleaned = stripFillerWords(input);
      expect(cleaned).toBe("How would you handle network partitions?");
    });

    it("preserves clean questions that have no filler words", () => {
      const input = "What is the time complexity of quicksort in the worst case?";
      expect(stripFillerWords(input)).toBe(input);
    });

    it("ensures interrogative questions end with a question mark if missing", () => {
      const input = "so basically how would you scale a postgres database";
      expect(stripFillerWords(input)).toBe("How would you scale a postgres database?");
    });
  });

  describe("2. Intent Classification & Confidence Scoring (REQ-011, AC-004)", () => {
    it("accurately classifies interrogative intent with high confidence (>= 0.7)", () => {
      const result = classifyQuestionIntent(
        "How would you design a rate limiter for a multi-tenant API?"
      );

      expect(result.isQuestion).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.extractedQuestion).toContain("How would you design a rate limiter");
      expect(result.quickPointers.length).toBeGreaterThanOrEqual(3);
    });

    it("scores non-question pleasantries and small talk below 0.7 confidence", () => {
      const pleasantries = [
        "Sounds good, let's begin.",
        "Thanks, that makes sense.",
        "Okay cool, let's move on.",
        "Understood, thank you.",
        "Yes, absolutely.",
      ];

      for (const phrase of pleasantries) {
        const result = classifyQuestionIntent(phrase);
        expect(result.isQuestion).toBe(false);
        expect(result.confidence).toBeLessThan(0.7);
      }
    });

    it("generates 3-4 domain-specific quick pointers for distributed cache", () => {
      const pointers = generateQuickPointers("How would you design a distributed cache?");
      expect(pointers.length).toBeGreaterThanOrEqual(3);
      expect(pointers.length).toBeLessThanOrEqual(4);
      expect(pointers.some((p) => p.toLowerCase().includes("consistent hashing"))).toBe(true);
      expect(pointers.some((p) => p.toLowerCase().includes("l1"))).toBe(true);
    });

    it("generates 3-4 domain-specific quick pointers for rate limiter", () => {
      const pointers = generateQuickPointers("Design a rate limiter for API gateway");
      expect(pointers.length).toBeGreaterThanOrEqual(3);
      expect(pointers.some((p) => p.toLowerCase().includes("token bucket"))).toBe(true);
      expect(pointers.some((p) => p.toLowerCase().includes("redis"))).toBe(true);
    });

    it("generates 3-4 domain-specific quick pointers for consensus algorithms", () => {
      const pointers = generateQuickPointers("Explain how Raft consensus works");
      expect(pointers.length).toBeGreaterThanOrEqual(3);
      expect(pointers.some((p) => p.toLowerCase().includes("leader election"))).toBe(true);
    });
  });
});
