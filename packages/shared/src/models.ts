/**
 * Hand-written row models matching supabase/migrations/0001_core.sql.
 *
 * These are the app-side domain types. Once a Supabase project is linked,
 * `npm run gen-types` writes the full generated `Database` type into
 * db-types.ts; these interfaces stay as the stable, ergonomic surface the
 * app imports.
 */

import type {
  AssignmentComplexity,
  AssignmentStatus,
  ConnectorStatus,
  CreationContent,
  CreationKind,
  FriendshipStatus,
  LearningStylePreferences,
  MaterialKind,
  MaterialStatus,
  MessageRole,
  SessionEventType,
  SessionMode,
  SessionStatus,
} from "./protocol";

export interface Profile {
  id: string;
  display_name: string | null;
  handle: string | null;
  grade_level: string | null;
  program: string | null;
  timezone: string | null;
  onboarding_completed: boolean;
  created_at: string;
}

export interface Course {
  id: string;
  user_id: string;
  name: string;
  subject: string | null;
  grade_level: string | null;
  instructor: string | null;
  term: string | null;
  curriculum: string | null;
  context_summary: string | null;
  created_at: string;
}

export interface Material {
  id: string;
  user_id: string;
  course_id: string;
  title: string;
  kind: MaterialKind;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  status: MaterialStatus;
  error: string | null;
  summary: string | null;
  topics: string[] | null;
  page_count: number | null;
  processed_at: string | null;
  created_at: string;
}

export interface MaterialChunk {
  id: string;
  material_id: string;
  user_id: string;
  seq: number;
  page_start: number | null;
  page_end: number | null;
  content: string;
  token_estimate: number | null;
  created_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  course_id: string | null;
  subject: string | null;
  mode: SessionMode;
  planned_minutes: number | null;
  started_at: string;
  ended_at: string | null;
  status: SessionStatus;
  summary: string | null;
  questions_answered: number;
  hints_given: number;
  answers_revealed: number;
  breaks_taken: number;
  creations_made: number;
  points_awarded: number;
  created_at: string;
}

export interface SessionEvent {
  id: string;
  session_id: string;
  user_id: string;
  type: SessionEventType;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Message {
  id: string;
  session_id: string;
  user_id: string;
  seq: number;
  role: MessageRole;
  /** Exact Anthropic content-block array, replayed verbatim on later turns. */
  content: unknown;
  display_text: string | null;
  created_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  course_id: string | null;
  subject: string | null;
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  content: string;
  tags: string[];
  links: string[];
  source_session_id: string | null;
  updated_at: string;
  created_at: string;
}

export interface LearningStyleProfile {
  user_id: string;
  preferences: LearningStylePreferences;
  style_notes: string | null;
  updated_at: string;
}

export interface Creation {
  id: string;
  user_id: string;
  course_id: string;
  session_id: string | null;
  subject: string | null;
  kind: CreationKind;
  title: string;
  description: string | null;
  content: CreationContent;
  note_path: string | null;
  created_at: string;
}

export interface Assignment {
  id: string;
  user_id: string;
  course_id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  estimated_minutes: number | null;
  complexity: AssignmentComplexity | null;
  status: AssignmentStatus;
  completed_at: string | null;
  created_at: string;
}

export interface Grade {
  id: string;
  user_id: string;
  course_id: string;
  assignment_id: string | null;
  title: string;
  score: number;
  max_score: number;
  weight: number | null;
  feedback: string | null;
  topics: string[];
  graded_at: string;
  created_at: string;
}

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
}

export interface PointsLedgerEntry {
  id: string;
  user_id: string;
  delta: number;
  reason: string;
  ref_id: string | null;
  created_at: string;
}

export interface TreeState {
  user_id: string;
  owned_items: string[];
  equipped_items: string[];
  updated_at: string;
}

export interface UserConnector {
  id: string;
  user_id: string;
  service: string;
  server_url: string;
  /** OAuth access token; stored server-side only, never sent to the app. */
  authorization_token: string | null;
  status: ConnectorStatus;
  created_at: string;
}
