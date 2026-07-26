/**
 * Wire protocol + domain constants shared between the mobile app and the
 * Supabase Edge Functions.
 *
 * IMPORTANT: this file must stay fully self-contained (no imports) — edge
 * functions import it directly by relative path under Deno, which resolves
 * only explicit file paths.
 */

// ---------------------------------------------------------------------------
// Domain enums (mirror the CHECK constraints in supabase/migrations)
// ---------------------------------------------------------------------------

export type SessionMode = "teaching" | "answering" | "creation";

export type SessionStatus = "active" | "completed" | "abandoned";

export type MaterialKind = "pdf" | "docx" | "image" | "video" | "other";

export type MaterialStatus = "uploaded" | "processing" | "ready" | "failed";

export type SessionEventType =
  | "hint_given"
  | "answer_revealed"
  | "question_answered"
  | "break_suggested"
  | "break_taken"
  | "note_created"
  | "creation_saved"
  | "mode_switched";

export type CreationKind =
  | "practice_test"
  | "flashcards"
  | "study_guide"
  | "summary"
  | "other";

export type ConnectorStatus = "connected" | "disconnected" | "error";

export type MessageRole = "user" | "assistant" | "system";

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** Hints required on a problem before reveal_answer is allowed (teaching mode). */
export const HINTS_BEFORE_REVEAL = 3;

/** Model used for the tutor agent loop. */
export const TUTOR_MODEL = "claude-opus-5";

/** Model used for ingestion, summaries, and other cheap structured tasks. */
export const UTILITY_MODEL = "claude-haiku-4-5";

/** Max assistant tool-use rounds per user turn before the loop bails out. */
export const MAX_TOOL_ROUNDS = 8;

/** Cap on server-side web searches per turn. */
export const WEB_SEARCH_MAX_USES = 5;

/** max_tokens for tutor turns (streaming). */
export const TUTOR_MAX_TOKENS = 32000;

/** Replay at most this many stored messages as conversation history. */
export const HISTORY_MESSAGE_CAP = 40;

/** Target size (in ~tokens) for material chunks. */
export const CHUNK_TOKEN_TARGET = 1800;

/** Break-suggestion thresholds as fractions of planned session length. */
export const BREAK_THRESHOLDS = [0.5, 1.0, 1.25] as const;

/** Storage buckets. */
export const MATERIALS_BUCKET = "materials";
export const EXPORTS_BUCKET = "exports";

/**
 * Vault folder convention: {Course}/{Subject}/{TypeFolder}/Note.md
 * This is the Class → Subject → Type organization mirrored in Obsidian.
 */
export const VAULT_TYPE_FOLDERS = {
  lessons: "Lessons",
  created: "Created Materials",
  questions: "Question Summaries",
} as const;

// ---------------------------------------------------------------------------
// Creation-mode structured content
// ---------------------------------------------------------------------------

export interface Flashcard {
  front: string;
  back: string;
}

export interface PracticeQuestion {
  prompt: string;
  /** For multiple-choice; omitted for free-response. */
  choices?: string[];
  answer: string;
  explanation?: string;
}

/** `creations.content` payload, discriminated by `creations.kind`. */
export type CreationContent =
  | { kind: "flashcards"; cards: Flashcard[] }
  | { kind: "practice_test"; questions: PracticeQuestion[] }
  | { kind: "study_guide" | "summary" | "other"; markdown: string };

// ---------------------------------------------------------------------------
// tutor-chat request/response protocol
// ---------------------------------------------------------------------------

/** An in-chat attachment already uploaded to the materials bucket. */
export interface ChatAttachment {
  /** Storage object key, e.g. `{userId}/chat/{sessionId}/{uuid}.jpg` */
  storagePath: string;
  mimeType: string;
  /** When true, also route the attachment through material ingestion. */
  addToCourse?: boolean;
}

export interface TutorChatRequest {
  sessionId: string;
  message: string;
  attachments?: ChatAttachment[];
  /**
   * When set and different from the session's current mode, switches the
   * session mode (persisted + system-message injection) before this turn.
   */
  mode?: SessionMode;
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/** Server → client SSE events emitted by the tutor-chat function. */
export type SseEvent =
  | { type: "delta"; text: string }
  | { type: "thinking"; active: boolean }
  | { type: "tool"; name: string; label: string }
  | { type: "note"; noteId: string; path: string; title: string }
  | {
      type: "creation";
      creationId: string;
      kind: CreationKind;
      title: string;
    }
  | {
      type: "hint";
      problemLabel: string;
      hintsGiven: number;
      revealAllowed: boolean;
    }
  | { type: "done"; messageId: string; usage: TurnUsage }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Other function payloads
// ---------------------------------------------------------------------------

export interface IngestMaterialRequest {
  materialId: string;
}

export interface FinishSessionRequest {
  sessionId: string;
  /** 'completed' normally; 'abandoned' when discarded without summary. */
  outcome?: Extract<SessionStatus, "completed" | "abandoned">;
}

export interface FinishSessionResponse {
  sessionId: string;
  summary: string | null;
  durationMinutes: number;
  questionsAnswered: number;
  hintsGiven: number;
  answersRevealed: number;
  notesCreated: number;
}

// ---------------------------------------------------------------------------
// Learning style
// ---------------------------------------------------------------------------

/** Structured learning-style toggles seeded by the onboarding quiz. */
export interface LearningStylePreferences {
  analogies: boolean;
  step_by_step: boolean;
  real_world_examples: boolean;
  visual: boolean;
  socratic: boolean;
  pace: "slow" | "moderate" | "fast";
}

export const DEFAULT_LEARNING_STYLE: LearningStylePreferences = {
  analogies: true,
  step_by_step: true,
  real_world_examples: true,
  visual: false,
  socratic: false,
  pace: "moderate",
};
