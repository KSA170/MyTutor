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
apps/api           Node/Hono API — auth (JWT), file storage, the tutor agent
                   loop (OpenRouter, streaming SSE), ingestion, vault export,
                   recap, grade extraction, account deletion
packages/shared    Shared types + wire protocol (app ↔ API)
apps/api/migrations  Plain-Postgres schema (Render Postgres or any managed PG)
render.yaml        One-click Render blueprint: API + Postgres + upload disk
scripts/           seed + curl smoke tests
```

Key design decisions:

- **All model calls are server-side** through OpenRouter (OpenAI-compatible
  API) — one env var picks the model. Defaults are cheap
  (`google/gemini-2.5-flash`); ~$10 of OpenRouter credits goes a long way.
  Swap `TUTOR_MODEL` for any OpenRouter id (Claude, GPT, DeepSeek…) any time.
  The API key never ships in the app.
- **Retrieval without a vector DB** — materials are chunked into Postgres
  full-text search; the agent gets a summarized index of every material in
  its cached context and pulls passages via `search_materials` /
  `get_material` tools. Swappable for embeddings later with zero prompt
  changes.
- **Metrics are event-sourced** — hints/answers/breaks are tool calls the
  agent must make, logged to `session_events`; a trigger maintains rollups.
  The model can't miscount.
- **Deterministic context discipline** — static tutor prompt + deterministic
  course context + append-only history, so provider-side prompt caching works
  wherever the chosen model supports it (asserted in tests).

## Setup

You need: a Postgres database and a place to run the API — [Render](https://render.com)
covers both — plus an [OpenRouter](https://openrouter.ai) API key and Node 20+.

**Deploy on Render (recommended):** push this repo to GitHub, then in Render
choose **New → Blueprint** and point it at the repo. `render.yaml` provisions
the Postgres database, the API web service (migrations run on every deploy),
and a persistent disk for uploads. Paste your `OPENROUTER_API_KEY` when
prompted. Then:

```bash
cp apps/mobile/.env.example apps/mobile/.env
#    → set EXPO_PUBLIC_API_URL to your Render service URL
npm install
npm run web        # browser (fastest for development)
npm run mobile     # Expo dev server → scan QR with Expo Go on your iPhone
```

**Local development instead:**

```bash
npm install
cp apps/api/.env.example apps/api/.env    # point DATABASE_URL at any Postgres
npm run migrate                            # apply the schema
npm run api                                # API on :3000
# in another terminal:
EXPO_PUBLIC_API_URL=http://localhost:3000 npm run web
```

Model choice: `TUTOR_MODEL`/`UTILITY_MODEL` accept any OpenRouter model id.
The Gemini Flash defaults cost ~$0.30/M input tokens; a Claude model like
`anthropic/claude-sonnet-4.5` is stronger but ~10× the price — with ~$10 of
credits, Flash for daily studying and an occasional Claude session is a good
mix. Web search uses OpenRouter's `:online` variant (disable with
`WEB_SEARCH=0`).

## Testing without the app

```bash
# Unit tests (chunking, vault parsing, SSE parser, prompt determinism)
npm test

# Seed a test user + course + assignments through a running API,
# then smoke-test the agent over curl
API_URL=http://localhost:3000 npm run seed
# → export the printed vars, then:
./scripts/smoke-chat.sh
```

## Trust model note

Authorization lives entirely in the API layer — every query is scoped by the
JWT's user id. Study metrics are written by the agent's tools server-side;
points awards and tree purchases are enforced in SQL functions, so clients
can't mint points directly.

## Cost notes

Tutor turns are bounded (max tool rounds, capped history) and the context
block is deterministic, so provider-side caching applies where supported.
Ingestion, summaries, recaps, and grade extraction all run on the cheaper
`UTILITY_MODEL`. Watch spend live on the OpenRouter dashboard — every request
is itemized there.
