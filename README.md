# MyTutor

A personal AI tutor that actually knows your courses. Feed it your course
materials, curriculum, and grade level once — then study with an agent that
teaches from *your* class content, tracks your study habits, and builds you an
Obsidian-compatible second brain as you learn.

## What it does

- **Context-aware tutoring** — the agent is grounded in your uploaded
  materials (PDF, DOCX, screenshots, video), your curriculum, and your grade
  level, with live web search for practice materials.
- **Three session modes**
  - **Teaching** — progressive hints; the answer is only revealed after
    working through hints (enforced server-side, not just prompted).
  - **Answering** — direct, complete answers.
  - **Creation** — generates flashcards, practice tests, and study guides
    from your actual course content.
- **Second brain** — the tutor writes Obsidian-compatible markdown notes
  (wikilinks, tags, YAML frontmatter) organized
  `{Course}/{Subject}/{Lessons | Created Materials | Question Summaries}`,
  browsable in-app and exportable as a real vault (.zip).
- **Learning-style adaptation** — seeded by an onboarding quiz, refined by
  the agent over time, persisted across sessions.
- **Session tracking** — time studied, questions answered, hints used, and
  break reminders based on your planned session length.
- **Planner** — assignments and tests with due dates, complexity and time
  estimates, and local due-date reminders. The tutor logs homework you
  mention in chat and helps plan around it.
- **Grades** — log marks (or scan a photo of a marked test), tag topics, and
  the tutor schedules review of weak topics before related assessments.
- **Stats** — study-habit dashboard (minutes, questions, correctness,
  streaks), weak-topic detection, and an AI weekly recap with
  recommendations, saved into your vault.
- **Brain tree** — studying earns points (formula enforced server-side);
  spend them growing and decorating your tree.
- **Friends & leaderboard** — add friends by handle and compare weekly study
  points and minutes.
- **App Store groundwork** — in-app account deletion, privacy policy draft
  ([docs/PRIVACY.md](docs/PRIVACY.md)), EAS build config, iOS permission
  strings.

The full build plan lives in [docs/PLAN.md](docs/PLAN.md).

## Architecture

```
apps/mobile        Expo (React Native, TypeScript, expo-router) — iOS-first, runs on web
packages/shared    Shared types + wire protocol (app ↔ edge functions)
supabase/
  migrations/      Postgres schema — RLS on everything
  functions/
    tutor-chat/      the agent loop (claude-opus-5, streaming SSE, prompt caching)
    ingest-material/ upload processing (unpdf/mammoth/Haiku vision + summaries)
    finish-session/  session close + summary + vault note + points award
    export-vault/    Obsidian vault .zip export
    weekly-recap/    AI study-habit recap (on demand or via pg_cron)
    extract-grade/   photo of a marked test → prefilled grade entry
    delete-account/  full account + data deletion (App Store requirement)
scripts/           seed + curl smoke tests
```

Key design decisions:

- **All Claude API calls are server-side** (Supabase Edge Functions). The
  API key never ships in the app.
- **Retrieval without a vector DB** — materials are chunked into Postgres
  full-text search; the agent gets a summarized index of every material in
  its cached context and pulls passages via `search_materials` /
  `get_material` tools. Swappable for embeddings later with zero prompt
  changes.
- **Metrics are event-sourced** — hints/answers/breaks are tool calls the
  agent must make, logged to `session_events`; a trigger maintains rollups.
  The model can't miscount.
- **Prompt caching discipline** — static tutor prompt + deterministic course
  context + append-only history; cache reads are asserted in tests and logged
  per turn.

## Setup

You need: a [Supabase](https://supabase.com) project (free tier is fine), an
[Anthropic API key](https://console.anthropic.com), Node 20+, and the
[Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
# 1. Install
npm install

# 2. Link your Supabase project
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# 3. Apply the schema
supabase db push

# 4. Set the Claude API key for edge functions
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

# 5. Deploy edge functions
supabase functions deploy tutor-chat ingest-material finish-session \
  export-vault weekly-recap extract-grade delete-account

# 6. Configure the app
cp apps/mobile/.env.example apps/mobile/.env
#    → fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY

# 7. Run it
npm run web        # browser (fastest for development)
npm run mobile     # Expo dev server → scan QR with Expo Go on your iPhone
```

Optional: regenerate DB types after schema changes with `npm run gen-types`.

## Testing without the app

```bash
# Unit tests (chunking, vault parsing, SSE parser, prompt determinism)
npm test

# Seed a test user + course + material, then smoke-test the agent over curl
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... npm run seed
# → export the printed vars, then:
./scripts/smoke-chat.sh
# Run it twice — the second run asserts prompt-cache hits.
```

## Trust model note

Study metrics (session events, counters) are written through the user's own
RLS-scoped session, so a technically savvy user could inflate their *own*
stats/points via the API — acceptable for a personal app where the
leaderboard is only visible to accepted friends. Item purchases and point
awards are already server-enforced (SECURITY DEFINER). If leaderboard
integrity ever matters, move `session_events` writes behind a definer
function the same way.

## Cost notes

Tutoring runs on `claude-opus-5` with prompt caching (the static prompt +
course context are cached; conversation history is append-only), web search
capped at 5 uses/turn, and bounded tool rounds. Ingestion and summaries run
on `claude-haiku-4-5`. Per-turn usage (including cache reads) is logged by
the `tutor-chat` function.
