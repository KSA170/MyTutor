# MyTutor — Personal AI Tutor App: Implementation Plan

## Context

The user wants to build "MyTutor": an AI tutor agent pre-loaded with their actual school context (course materials, curriculum, grade level, program) so it tutors better than a generic AI chat. Beyond tutoring, the app tracks study habits, gamifies studying, and manages schoolwork. The repo (`ksa170/mytutor`) is empty — greenfield build on branch `claude/personal-ai-tutor-agent-h9w9a0`. Goal: personal use immediately, published iOS app eventually.

**Full feature set (built across 3 phases):**
1. Context-aware AI tutor with live web search for practice materials
2. Rolling multi-modal uploads — PDFs, docs, screenshots, video lessons
3. Auto-generated notes into a per-user **Obsidian-compatible markdown vault** (wikilinks, tags, YAML frontmatter; .zip export to real Obsidian)
4. Learning-style adaptation (analogies / real-world examples / step-by-step), persisted across sessions
5. **Three modes**: **Teaching** (progressive hints, answer revealed only after N hints), **Answering** (direct answers), and **Creation** (agent generates study materials — practice tests, flashcards, study guides — saved as structured artifacts + vault notes)
6. Session tracking: time, questions answered, hints given; recommendations; break reminders based on planned session length
7. Social/gamification: friends, leaderboards, study points, "brain tree" mini-game
8. Calendar/assignment tracker: due dates, complexity estimates, reminders, planning
9. Grade tracking tied to assignments/tests; agent schedules review around weak topics
10. **Content organization**: everything (lesson notes, created materials, question summaries) organized **Class → Subject → Type** — mirrored in the vault folder structure (`{Course}/{Subject}/{Lessons|Created Materials|Question Summaries}/...`) and in the in-app Library browser
11. **MCP connectors**: user can connect external services (Google Drive, Gmail, Calendar, MyBib, …) the same way Claude does — via the Claude API MCP connector (`mcp_servers` param, hosted MCP servers + per-user OAuth tokens stored in `user_connectors`). Plumbing point designed into the agent loop now; connector UI + OAuth ships Phase 2/3

## Decisions (recommended defaults — user question went unanswered, so flag if wrong)

| Decision | Choice | Why |
|---|---|---|
| Frontend | **React Native + Expo (TypeScript), expo-router** | One codebase → App Store; also runs on web for dev in this cloud env |
| Backend | **Supabase** (Postgres, Auth, Storage, Realtime, Edge Functions) | Relational fit for sessions/grades/assignments; auth+storage+realtime included |
| AI | **Claude API, server-side only** — `claude-opus-5` for tutoring, `claude-haiku-4-5` for ingestion/summaries | Adaptive thinking, streaming, `web_search_20260209`, prompt caching; API key never in the app |
| Second brain | **Obsidian-compatible vault per user** (markdown rows in Postgres, rendered in-app, exported as .zip of real .md files) | Obsidian can't be embedded per-user at app scale; format compatibility preserves the benefit |
| Retrieval | **No pgvector in v1** — agentic retrieval: cached materials index + `search_materials` (Postgres full-text) + `get_material` tools | Anthropic has no embeddings API → pgvector means a 2nd AI vendor + pipeline. At one-student scale, Claude choosing from a labeled index beats cosine similarity. Swappable behind the tool later with zero prompt changes |
| Build order | P1 core tutor MVP → P2 planner/analytics/grades → P3 gamification/social/App Store | Usable app fastest; each phase shippable |

## Repo layout (npm workspaces monorepo)

```
MyTutor/
├─ apps/mobile/                  # Expo app: app/ (expo-router routes), src/{lib,state,api,components}
├─ packages/shared/              # pure TS: generated db-types.ts, api-types.ts (SSE events, tool payloads), points.ts (P3)
├─ supabase/
│  ├─ migrations/                # 0001_core.sql, 0002_planner.sql, 0003_social.sql
│  └─ functions/
│     ├─ _shared/                # anthropic.ts, prompts.ts, sse.ts, db.ts, tools/ (one file per tool + sorted registry)
│     ├─ tutor-chat/             # the agent loop (SSE endpoint) ← core file
│     ├─ ingest-material/        # upload processing pipeline
│     ├─ finish-session/         # close session, Haiku summary, metric rollups (P3: points award)
│     ├─ export-vault/           # build Obsidian .zip from note rows
│     └─ delete-account/         # P3, App Store requirement
└─ scripts/                      # seed.ts (test user/course/PDF), smoke-chat.sh (curl -N SSE test)
```

Edge functions (Deno) import `packages/shared` via import maps; app imports it as a workspace package. Regenerate types after each migration: `supabase gen types typescript --linked > packages/shared/src/db-types.ts`.

## Data model (all tables RLS-enabled, baseline policy `user_id = auth.uid()`)

**Phase 1**
- `profiles` — id (FK auth.users), display_name, grade_level, program, timezone, onboarding_completed; created by signup trigger
- `courses` — user_id, name, subject, instructor, term, `curriculum` (pasted syllabus), `context_summary` (Haiku rollup, rebuilt on ingestion)
- `materials` — course_id, title, kind (pdf/docx/image/video/other), storage_path, status (uploaded/processing/ready/failed), `summary`, `topics[]`
- `material_chunks` — material_id, seq, page range, content, `tsv` (generated tsvector, GIN index) — powers `search_materials`
- `sessions` — course_id, mode (teaching/answering), planned_minutes, started/ended_at, status, summary, rollup counters (questions_answered, hints_given, answers_revealed, breaks_taken, points_awarded)
- `session_events` — session_id, type (hint_given/answer_revealed/question_answered/break_suggested/break_taken/note_created/mode_switched), payload jsonb. **Source of truth for metrics**; AFTER INSERT trigger bumps session counters; Phase 2 analytics aggregate this
- `messages` — session_id, seq, role, `content` jsonb (**exact Anthropic content-block array incl. tool_use/tool_result, replayed verbatim next turn → byte-stable prefix for prompt caching**), display_text
- `notes` — the vault: unique (user_id, `path` e.g. `Geology/Rock Formations.md`), title, frontmatter jsonb, content (markdown), tags[], `links[]` (parsed wikilinks → backlinks). **DB is the single source of truth; export builds .md files on demand** — one write path, no sync bugs
- `learning_style_profiles` — user_id PK, `preferences` jsonb (from onboarding quiz: analogies/step_by_step/real_world/visual/socratic/pace), `style_notes` (freeform, agent-maintained, ~2K token cap)
- `creations` — Creation-mode outputs: course_id, session_id, `subject`, kind (practice_test/flashcards/study_guide/summary/other), title, `content` jsonb (structured: flashcard array / test questions+answers+explanations), `note_path` (vault mirror for Obsidian export). Agent tool `create_study_material`; app renders flashcards/tests interactively
- **Subject taxonomy**: `subject text` column on notes, creations, and sessions; vault paths follow `{Course}/{Subject}/{Type}/...` — this powers the Class → Subject → Type Library browser with zero extra tables
- `user_connectors` (schema now, UI later) — service, hosted MCP server URL, encrypted OAuth token, status; tutor-chat passes connected servers via the API's `mcp_servers` param

**Phase 2**: `assignments` (due_at, estimated_minutes, complexity, status), `grades` (assignment_id nullable, score/max/weight, feedback, `topics[]` for weak-topic detection)

**Phase 3**: `friendships` (requester/addressee/status), `points_ledger` (delta, reason, ref_id; balance = sum), `tree_states` (stage, owned/equipped items jsonb)

**RLS/security**: edge functions verify the caller's JWT then use a user-scoped client so RLS applies to agent writes too; service role only for cross-user work. Leaderboard = `security definer` function returning only (name, points, minutes) for accepted friends. Storage buckets private, keys prefixed by uid.

## AI architecture

**Runtime: Supabase Edge Functions (Deno), always streaming SSE.** One platform, zero extra hosting; Anthropic TS SDK via `npm:@anthropic-ai/sdk`. Wall-clock cap (~150s free/400s paid) mitigated by streaming + bounded turns (~8 tool rounds, `web_search max_uses: 5`, `max_tokens: 32000`); the loop is written against plain Request/Response so it ports to a small Node service in an afternoon if ever needed. API key only in `supabase secrets`.

**`tutor-chat` per turn** — manual streaming loop (`client.messages.stream` → `finalMessage()` → run tools → append all tool_results in one user message → repeat until `end_turn`), with `pause_turn` re-send handling and `stop_reason === "refusal"` branch. Request: `model: "claude-opus-5"` (thinking on by default — omit `thinking`; no sampling params), `output_config: {effort: "high"}`, tools = `web_search_20260209` + custom tools sorted by name.

**Prompt caching (the cost model depends on this):**
1. Breakpoint 1 — static tutor prompt (~2–4K tokens): persona, both mode specs, tool rules, Obsidian note format, style-adaptation instructions. Frozen bytes — no dates/names/interpolation.
2. Breakpoint 2 — course context, rebuilt deterministically (sorted queries, stable serialization): profile, course + curriculum, **materials index** (title + one-line summary + topics per material = the agent's table of contents), learning-style profile.
3. Breakpoint 3 — last block of the newly appended conversation turn; history replayed byte-identically from `messages.content`.
4. All volatile content (elapsed-time status, mode switches, attachments) goes into `messages`, never `system`. Log `usage.cache_read_input_tokens` per turn; zero on turn ≥2 = bug.

**Mode enforcement** — all three modes (teaching/answering/creation) defined in the static prompt; current mode injected as a system-role message inside `messages` at session start; mid-session switches append `{role:"system", content:"Mode switched to …"}` (natively supported on `claude-opus-5`, no cache invalidation) + a `mode_switched` event. Creation mode centers on the `create_study_material` tool (structured flashcards/practice tests/study guides → `creations` row + vault note at `{Course}/{Subject}/Created Materials/`); `finish-session` also writes a question-summary note to `{Course}/{Subject}/Question Summaries/`.

**MCP connectors** — the agent request includes `mcp_servers` built from the user's connected rows in `user_connectors` (Claude API MCP connector; hosted MCP servers for Drive/Gmail/Calendar/MyBib with per-user OAuth tokens). Phase 1 ships the plumbing (empty list); Phase 2/3 ships the connect UI + OAuth flows.

**Hint counting is server-enforced, not prompt-trusted** — Teaching mode requires the agent to call `give_hint(problem_label, hint_text)` before presenting any hint (handler logs event, returns `{hints_given_for_problem, reveal_allowed}`) and `reveal_answer(problem_label)` before any full solution (handler allows only after ≥N hints, default 3, or explicit user give-up; otherwise returns `{allowed: false}` and the agent keeps coaching). `record_answer_outcome(problem_label, correct)` logs answered questions. The server is the counter → metrics are exact.

**Breaks** — client collects `planned_minutes` at session start; server computes elapsed time each turn and past thresholds (50% / 100% / +25%) appends a system status line; agent weaves the break suggestion in at a natural stopping point (`break_suggested` event). No timers needed.

**Style adaptation** — onboarding quiz seeds `preferences`; agent calls `update_learning_style({preferences_patch?, style_notes_append?})` when it learns something durable; injected via cache breakpoint 2 so it persists across sessions.

**Notes tools** — `create_note` / `update_note` / `list_notes`. Handler validates path (`.md`, no `..`), writes YAML frontmatter (created, course, tags, source), parses `[[wikilinks]]` into `links[]`, upserts on (user_id, path), emits an SSE `note` event so a "note created" card appears inline in chat. `list_notes` lets the agent link into the existing vault instead of duplicating.

**Ingestion (`ingest-material`, runs under `EdgeRuntime.waitUntil`, status via Realtime)** — PDF: `unpdf` text extraction → ~1.5–2K-token chunks on page boundaries; scanned PDFs fall back to Haiku vision transcription in page batches. DOCX: `mammoth`. Images: Haiku vision transcription (multi-screenshot = one material, several chunks). **Video v1: store file + short user-typed description in the index; transcript extraction deferred to Phase 3+** (avoids a speech-to-text vendor dependency now). All kinds get a Haiku `messages.parse` structured summary `{summary, topics, suggested_title}` → then `courses.context_summary` is rebuilt. In-chat attachments go straight into the user turn as image/document blocks, with an optional "add to course materials" toggle.

**SSE protocol to the app**: `delta`, `thinking on/off`, `tool {name,label}` ("Searching the web…"), `note`, `hint {count, reveal_allowed}`, `done {usage}`, `error`.

## Mobile app (Phase 1 routes)

State: Zustand (streaming/chat) + TanStack Query (server data, Realtime invalidation). Streaming via `expo/fetch` (streams bodies) → SSE parser → chat store. Notes rendered with `react-native-markdown-display` + custom wikilink rule navigating to `/notes/[path]`.

```
app/(auth)/sign-in|sign-up
app/onboarding/{profile,course,materials,style}   # wizard, sets onboarding_completed
app/(tabs)/{index,notes/index,settings}           # home + start session / vault browser / prefs + export + sign out
app/session/{new,[id],[id]/summary}               # mode+minutes sheet / streaming chat with attach / metrics summary
app/notes/[...path]                               # note render + backlinks
```
Phase 2 adds `(tabs)/planner` + `(tabs)/stats`; Phase 3 adds `(tabs)/tree` + `friends/`.

## Phase plan

**Phase 1 — Core tutor MVP** (each step verifiable before the next):
1. Scaffold: workspaces root, `create-expo-app` (router template), `supabase init` + link hosted project, shared package
2. Auth + profiles (email/password, signup trigger, secure-store persistence)
3. Migration `0001_core.sql`: all P1 tables, counter trigger, RLS, storage buckets → gen types
4. Onboarding wizard (profile → course → material upload → style quiz)
5. `ingest-material` pipeline + Realtime status UI — **verify with curl + seeded PDF before the agent exists**
6. `tutor-chat` agent endpoint: prompts, tool registry (`search_materials`, `get_material`, `list_notes` first), caching breakpoints, streaming loop, persistence — **smoke-test entirely with `curl -N`**
7. Chat UI: session start sheet, streaming screen, tool-activity chips, attachments
8. Modes + hints: hint/reveal/outcome tools + gating, mode-switch injection, hint counter UI
9. Notes: note tools, inline cards, vault browser, wikilink nav, `export-vault` zip via share sheet
10. Session lifecycle: `finish-session` (Haiku summary, rollups), summary screen, break injection → **MVP usable daily**

**Phase 2 — Planner, grades, analytics**: migration 0002 → planner tab + agent tools (`create_assignment`/`update_assignment`/`get_upcoming_assignments` — agent logs homework mentioned in chat and estimates complexity) → calendar + local due-date notifications (`expo-notifications`) → grade entry (incl. photo-of-marked-test Haiku extraction) + `log_grade` with topic tagging → analytics dashboard from `session_events` → nightly `weekly-recap` cron (pg_cron) writing a recommendations note; recent grades enter the tutor's context block so weak-topic review happens in-chat.

**Phase 3 — Social, gamification, App Store**: migration 0003 → points formula in `packages/shared` awarded by `finish-session` → brain tree tab (stages by lifetime points, decorations via ledger) → friends + security-definer leaderboard → Expo push notifications → App Store prep: EAS build/submit, Sign in with Apple, `delete-account` (required), privacy policy/labels, UGC moderation (report/block/name filter), TestFlight.

## Verification

- **Backend-first, curl-driven**: `scripts/seed.ts` (service role) creates test user + JWT + demo course + sample PDF; `scripts/smoke-chat.sh` runs `curl -N` against `tutor-chat` and asserts SSE shapes. Same pattern for ingestion (poll status), hint gating (teaching mode, immediately ask for the answer, assert `reveal_allowed: false`), and vault export (unzip, check frontmatter/wikilinks).
- **Hosted Supabase project** (`db push` + `functions deploy`) instead of local Docker stack — works in this cloud env.
- **Unit tests**: `deno test` for tool handlers (path validation, wikilink parsing, hint gating, and **course-context builder determinism** — byte-identical output for identical DB state = the cache invariant); `vitest` for SSE parser.
- **UI on Expo web** (`expo start --web`): navigation, onboarding, streaming chat, notes. Native-only features (camera, share sheet) deferred to simulator/EAS dev build on the user's machine.
- **Per-turn `usage` logging** including cache reads — cache misses on turn ≥2 are treated as bugs.

## Risks

- **Edge function wall-clock cap** vs long agentic turns → streaming + bounded iterations; pre-planned port to a small Node service if outgrown (loop is transport-agnostic).
- **Cache discipline** → deterministic context builder + tests; no timestamps/interpolation in `system`.
- **File limits** → Storage 50MB default per file (raise for video); Claude PDF ≤32MB & page-batching for scanned docs.
- **History growth** → cap replayed history (~last 40 messages); session summaries carry context forward; server-side compaction (beta) as a later option.
- **Extraction failures** (exotic PDFs/DOCX) → `status='failed'` surfaced with retry-via-vision fallback.
- **App Store later** → account deletion, privacy labels, Sign in with Apple, UGC moderation, 13+ rating — all planned in Phase 3, designed for now.
- **User setup needed before Phase 1 step 1 can fully run**: a Supabase project (free) and an Anthropic API key — I'll scaffold everything and clearly mark where these get plugged in.
