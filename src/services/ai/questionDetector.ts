/**
 * Question Detection payload matching spec §4.2 (`sidekick://question_detected`).
 */
export interface QuestionDetectionPayload {
  question_id: string;
  timestamp: number;
  confidence: number;
  raw_transcript: string;
  extracted_question: string;
  quick_pointers: string[];
}

export interface QuestionDetectorOptions {
  apiKey?: string;
  model?: string;
  groqEndpoint?: string;
  forceMock?: boolean;
}

/**
 * Conversational filler words and phrases to strip from the beginning of turns.
 * Includes filler sounds ("um", "uh", "er"), pleasantries ("can you hear me"),
 * and conversational transitions ("so basically", "so I was wondering").
 */
const LEADING_FILLER_REGEX =
  /^(?:can you hear me(?:\?|\.|!)?|can you see my screen(?:\?|\.|!)?|am i audible(?:\?|\.|!)?|so basically\b|basically\b|so i was wondering(?: if| that)?\b|i was wondering(?: if| that)?\b|so yeah\b|yeah\b|yes\b|okay\b|ok\b|well\b|you know\b|actually\b|right\b|let's see\b|i mean\b|i guess\b|like\b|so\b|um+\b|uh+\b|er+\b|ah+\b|erm+\b|hmm+\b)[,\s.:;!?-]*/i;

/**
 * Trailing pleasantries or conversational filler tags.
 */
const TRAILING_FILLER_REGEX =
  /[,\s]+(?:you know|right|or something|or whatever)\??$/i;

/**
 * Strips conversational filler and pleasantries from raw speech transcript.
 * Capitalizes the first character and ensures grammatical interrogative form.
 *
 * Example:
 * Input:  "Um, yeah, so I was wondering, how would you design a distributed cache to handle hot keys?"
 * Output: "How would you design a distributed cache to handle hot keys?"
 */
export function stripFillerWords(text: string): string {
  if (!text) return "";
  let cleaned = text.trim();
  let prev = "";

  // Iteratively strip leading filler tokens
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(LEADING_FILLER_REGEX, "").trim();
  }

  // Strip trailing conversational tags if present
  if (TRAILING_FILLER_REGEX.test(cleaned)) {
    cleaned = cleaned.replace(TRAILING_FILLER_REGEX, "").trim();
    if (!/[?.!]$/.test(cleaned)) {
      cleaned += "?";
    }
  }

  // Capitalize first character
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  // Ensure trailing question mark if it is clearly an interrogative question
  if (
    cleaned.length > 0 &&
    !/[?.!]$/.test(cleaned) &&
    /^(how|what|why|where|when|which|who|whom|whose|can|could|would|is|are|do|does|did|will|should)\b/i.test(cleaned)
  ) {
    cleaned += "?";
  }

  return cleaned;
}

/**
 * Generates 3-4 domain-specific punchy talking points, architectural concepts,
 * or counter-questions based on keywords in the question.
 */
export function generateQuickPointers(questionText: string): string[] {
  const text = questionText.toLowerCase();

  // 1. Distributed Cache & Hot Keys
  if (
    text.includes("cache") ||
    text.includes("caching") ||
    text.includes("hot key") ||
    text.includes("hotkey") ||
    text.includes("redis") ||
    text.includes("memcached")
  ) {
    return [
      "Consistent hashing with virtual nodes for uniform distribution",
      "Multi-tier caching: Local L1 in-memory (LRU/TinyLFU) + Redis L2 cluster",
      "Hot-key mitigation: Key salting/sharding and local read-through replicas",
      "Cache invalidation strategy: Cache-Aside vs Write-Through with TTL jitter",
    ];
  }

  // 2. Rate Limiter & Throttling
  if (
    text.includes("rate limit") ||
    text.includes("ratelimit") ||
    text.includes("throttl") ||
    text.includes("token bucket") ||
    text.includes("leaky bucket")
  ) {
    return [
      "Token Bucket or Leaky Bucket algorithm for burst tolerance",
      "Redis sliding window counter / log via atomic Lua script",
      "Distributed synchronization: Local in-memory counter with periodic Redis sync",
      "Clarify with interviewer: Hard vs soft throttling, per-user vs per-IP, 429 Retry-After headers",
    ];
  }

  // 3. Consensus & Distributed Systems (Raft, Paxos)
  if (
    text.includes("raft") ||
    text.includes("paxos") ||
    text.includes("consensus") ||
    text.includes("leader election") ||
    text.includes("zookeeper") ||
    text.includes("etcd")
  ) {
    return [
      "Leader Election: Randomized election timeouts to prevent split-vote",
      "Log Replication: Leader appends entries and commits upon majority quorum",
      "Safety Invariants: Election safety, leader completeness, and state machine safety",
      "Compare with Paxos: Raft decomposes consensus into discrete, understandable stages",
    ];
  }

  // 4. SQL vs NoSQL & Database Design
  if (
    text.includes("sql vs nosql") ||
    text.includes("nosql") ||
    text.includes("relational") ||
    text.includes("postgres") ||
    text.includes("mongodb") ||
    text.includes("cassandra") ||
    text.includes("dynamodb") ||
    text.includes("acid")
  ) {
    return [
      "ACID transactions and normalization vs horizontal scalability and flexible schema",
      "Query patterns: Complex multi-table joins vs high-throughput key-value lookups",
      "Storage engine trade-offs: B-Tree (read-heavy) vs LSM-Tree (write-heavy append)",
      "Replication & consistency: Multi-master / Raft vs eventual consistency (PACELC)",
    ];
  }

  // 5. Concurrency, Deadlock & Threading
  if (
    text.includes("concurren") ||
    text.includes("deadlock") ||
    text.includes("thread") ||
    text.includes("race condition") ||
    text.includes("mutex") ||
    text.includes("lock")
  ) {
    return [
      "Four Coffman conditions: Mutual Exclusion, Hold & Wait, No Preemption, Circular Wait",
      "Prevention strategies: Strict global lock ordering and tryLock with timeouts",
      "Optimistic vs pessimistic concurrency control (CAS / version timestamps)",
      "Thread pool sizing: CPU-bound (N_cpu + 1) vs I/O-bound (N_cpu * (1 + W/C))",
    ];
  }

  // 6. Microservices & Event-Driven Systems
  if (
    text.includes("microservice") ||
    text.includes("kafka") ||
    text.includes("message queue") ||
    text.includes("rabbitmq") ||
    text.includes("pub sub") ||
    text.includes("pub/sub") ||
    text.includes("event driven")
  ) {
    return [
      "Asynchronous event decoupling via Kafka with at-least-once delivery",
      "Distributed transactions: Saga pattern (orchestration vs choreography) with compensations",
      "Inter-service protocol: gRPC/Protobuf for internal RPC, REST/GraphQL for edge",
      "Resilience patterns: Circuit breakers (Envoy/Resilience4j) and dead-letter queues (DLQ)",
    ];
  }

  // 7. System Design (General / Scalability)
  if (
    text.includes("system design") ||
    text.includes("design a") ||
    text.includes("architecture") ||
    text.includes("scale") ||
    text.includes("load balancer") ||
    text.includes("high availability")
  ) {
    return [
      "Clarify requirements: Peak QPS, read/write ratio, latency SLA, and storage volume",
      "High-level architecture: DNS Anycast, CDN, Load Balancer, Microservices, DB Cluster",
      "Data layer scaling: Read replicas, database sharding, and write-through caching",
      "Resilience & observability: Health checks, circuit breakers, and distributed tracing",
    ];
  }

  // 8. Algorithms & Data Structures
  if (
    text.includes("algorithm") ||
    text.includes("complexity") ||
    text.includes("binary search") ||
    text.includes("two pointer") ||
    text.includes("sliding window") ||
    text.includes("dynamic programming") ||
    text.includes("tree") ||
    text.includes("graph") ||
    text.includes("array") ||
    text.includes("quicksort") ||
    text.includes("sort")
  ) {
    return [
      "Clarify constraints: Input size, duplicate elements, null/empty edge cases",
      "Analyze brute-force approach first before proposing optimal time/space complexity",
      "Optimal data structure selection: HashMap, Two Pointers, Monotonic Stack, or DP",
      "Dry-run with sample test cases and boundary conditions before implementation",
    ];
  }

  // 9. General Technical Interview Fallback
  return [
    "Clarify scope, assumptions, and edge cases directly with the interviewer",
    "State high-level approach and key trade-offs before diving into implementation",
    "Discuss time and space complexity trade-offs and potential bottlenecks",
    "Structure response with clear progressive milestones and verify alignment",
  ];
}

/**
 * Classifies interrogative intent, confidence score, and produces extracted question and pointers.
 */
export function classifyQuestionIntent(text: string): {
  isQuestion: boolean;
  confidence: number;
  extractedQuestion: string;
  quickPointers: string[];
} {
  const extractedQuestion = stripFillerWords(text);
  if (!extractedQuestion || extractedQuestion.length < 5) {
    return {
      isQuestion: false,
      confidence: 0.1,
      extractedQuestion: "",
      quickPointers: [],
    };
  }

  // Pure small talk / pleasantry checks
  const isPureSmallTalk =
    /^(thanks|thank you|ok|okay|got it|sounds good|cool|nice|let's move on|moving on|hello|hi|yes|no|sure|right|understood)[.! ]*$/i.test(
      extractedQuestion
    );

  if (isPureSmallTalk) {
    return {
      isQuestion: false,
      confidence: 0.15,
      extractedQuestion,
      quickPointers: [],
    };
  }

  let confidence = 0.2;
  let isQuestion = false;

  const hasQuestionMark = extractedQuestion.endsWith("?");
  const startsWithInterrogative =
    /^(how|what|why|where|when|which|who|whom|whose|can|could|would|is|are|do|does|did|will|should)\b/i.test(
      extractedQuestion
    );
  const startsWithPrompt =
    /^(design|explain|describe|walk me through|tell me about|implement|compare|discuss|solve|suppose|assume|consider)\b/i.test(
      extractedQuestion
    );
  const containsInterrogativePhrase =
    /\b(how would you|how do you|how can|what are|what is|why would|why do|can we|could we|could you explain|how to handle)\b/i.test(
      extractedQuestion
    );
  const containsTechnicalTopic =
    /\b(cache|redis|rate limiter|distributed|consensus|raft|paxos|sql|nosql|deadlock|concurrency|database|architecture|latency|throughput|complexity|algorithm)\b/i.test(
      extractedQuestion
    );

  if (startsWithInterrogative && hasQuestionMark) {
    confidence = 0.98;
    isQuestion = true;
  } else if (startsWithPrompt && (hasQuestionMark || containsTechnicalTopic)) {
    confidence = 0.95;
    isQuestion = true;
  } else if (containsInterrogativePhrase) {
    confidence = hasQuestionMark ? 0.96 : 0.90;
    isQuestion = true;
  } else if (startsWithInterrogative) {
    confidence = 0.92;
    isQuestion = true;
  } else if (startsWithPrompt) {
    confidence = 0.88;
    isQuestion = true;
  } else if (hasQuestionMark && containsTechnicalTopic) {
    confidence = 0.85;
    isQuestion = true;
  } else if (hasQuestionMark) {
    confidence = 0.75;
    isQuestion = true;
  }

  const quickPointers = isQuestion ? generateQuickPointers(extractedQuestion) : [];

  return {
    isQuestion: isQuestion && confidence >= 0.7,
    confidence,
    extractedQuestion,
    quickPointers,
  };
}

/**
 * Fallback/mock evaluator for offline/test environments (when no Groq API key is configured or offline).
 */
export function mockEvaluateQuestion(
  rawTranscript: string
): QuestionDetectionPayload | null {
  const classification = classifyQuestionIntent(rawTranscript);

  if (!classification.isQuestion || classification.confidence < 0.7) {
    return null;
  }

  return {
    question_id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: Date.now(),
    confidence: classification.confidence,
    raw_transcript: rawTranscript,
    extracted_question: classification.extractedQuestion,
    quick_pointers: classification.quickPointers,
  };
}

/**
 * Evaluates streaming STT transcript turn using Groq LPU (Llama 3.3 70B)
 * with structured JSON schema output, falling back to mock evaluator when offline.
 */
export async function detectQuestion(
  rawTranscript: string,
  options?: QuestionDetectorOptions
): Promise<QuestionDetectionPayload | null> {
  const trimmed = rawTranscript.trim();
  if (!trimmed) return null;

  const apiKey = options?.apiKey?.trim();
  const forceMock = options?.forceMock ?? false;

  // Use offline/mock evaluator if no key or forceMock requested
  if (!apiKey || forceMock) {
    return mockEvaluateQuestion(trimmed);
  }

  // Clean model name (e.g. "groq/llama-3.3-70b-versatile" -> "llama-3.3-70b-versatile")
  let model = options?.model || "llama-3.3-70b-versatile";
  if (model.startsWith("groq/")) {
    model = model.slice("groq/".length);
  }

  const endpoint =
    options?.groqEndpoint || "https://api.groq.com/openai/v1/chat/completions";

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const systemPrompt = `You are a real-time technical interview assistant analyzing live speech from the interviewer (Channel 0).
Your mission:
1. Detect if the statement is an interview question, coding task, system design problem, or technical inquiry.
2. Score confidence between 0.0 and 1.0 (float).
3. Strip conversational filler ("um", "uh", "so basically", "can you hear me", "yeah", "I was wondering", "like").
4. Extract the distilled, clean question string.
5. Generate exactly 3 to 4 punchy bullet talking points / architectural concepts / buzzwords / counter-questions.

Strictly respond with a valid JSON object matching this schema:
{
  "is_question": boolean,
  "confidence": number,
  "extracted_question": string,
  "quick_pointers": string[]
}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: trimmed },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 450,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[Groq QuestionDetector] HTTP ${res.status}, falling back to mock evaluator`);
      return mockEvaluateQuestion(trimmed);
    }

    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      return mockEvaluateQuestion(trimmed);
    }

    const parsed = JSON.parse(content);
    const confidence =
      typeof parsed.confidence === "number" ? parsed.confidence : 0.95;
    const isQuestion = Boolean(parsed.is_question);

    if (!isQuestion || confidence < 0.7) {
      return null;
    }

    const extractedQuestion =
      typeof parsed.extracted_question === "string" && parsed.extracted_question.trim().length > 0
        ? parsed.extracted_question.trim()
        : stripFillerWords(trimmed);

    let quickPointers: string[] = [];
    if (Array.isArray(parsed.quick_pointers) && parsed.quick_pointers.length > 0) {
      quickPointers = parsed.quick_pointers.slice(0, 4);
    } else {
      quickPointers = generateQuickPointers(extractedQuestion);
    }

    return {
      question_id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      confidence,
      raw_transcript: trimmed,
      extracted_question: extractedQuestion,
      quick_pointers: quickPointers,
    };
  } catch (err) {
    // Network offline, timeout, or parsing error -> fallback cleanly
    return mockEvaluateQuestion(trimmed);
  }
}
