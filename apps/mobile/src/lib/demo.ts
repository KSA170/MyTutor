/**
 * Demo mode — a fully client-side fixture backend for previews/screenshots.
 *
 * EXPO_PUBLIC_DEMO=1 makes lib/http.ts route every request here instead of
 * the API; no network, no keys. EXPO_PUBLIC_DEMO_STATE picks the entry state:
 *   "app" (default) — signed in, onboarded, rich data
 *   "onboarding"    — signed in, onboarding not completed
 *   "signedout"     — no session (sign-in screen)
 */
import type { SseEvent } from "@mytutor/shared";

export const DEMO = process.env.EXPO_PUBLIC_DEMO === "1";
export const DEMO_STATE = process.env.EXPO_PUBLIC_DEMO_STATE ?? "app";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const COURSE_ID = "00000000-0000-4000-8000-0000000000c0";
const now = Date.now();
const day = 86400_000;
const iso = (t: number) => new Date(t).toISOString();
const dateStr = (t: number) => new Date(t).toISOString().slice(0, 10);

export const demoProfile = {
  id: USER_ID,
  display_name: "Sam",
  handle: "sam_studies",
  grade_level: "Grade 10",
  program: "IB MYP",
  timezone: "America/Toronto",
  onboarding_completed: DEMO_STATE !== "onboarding",
  created_at: iso(now - 30 * day),
};

const courses = [{
  id: COURSE_ID,
  user_id: USER_ID,
  name: "Science 10",
  subject: "Science",
  grade_level: "Grade 10",
  instructor: "Ms. Kaur",
  term: "Fall 2026",
  curriculum: "Unit 1: Geology. Unit 2: Chemistry. Unit 3: Physics.",
  context_summary: "Covers geology, chemistry, and physics fundamentals.",
  created_at: iso(now - 29 * day),
}];

const materials = [
  {
    id: "m-1",
    title: "Geology Unit Notes.pdf",
    kind: "pdf",
    status: "ready",
    summary: "The three rock types, the rock cycle, plate tectonics.",
    topics: ["rock cycle", "igneous", "plate tectonics"],
    page_count: 24,
  },
  {
    id: "m-2",
    title: "Chapter 4 — Minerals.pdf",
    kind: "pdf",
    status: "ready",
    summary: "Mineral identification, hardness scale, crystal structures.",
    topics: ["minerals", "Mohs scale"],
    page_count: 31,
  },
  {
    id: "m-3",
    title: "Lab safety slides.pdf",
    kind: "pdf",
    status: "processing",
    summary: null,
    topics: null,
    page_count: null,
  },
].map((m, i) => ({
  user_id: USER_ID,
  course_id: COURSE_ID,
  storage_path: `${USER_ID}/x/${i}`,
  mime_type: "application/pdf",
  size_bytes: 1_000_000,
  error: null,
  processed_at: m.status === "ready" ? iso(now - 10 * day) : null,
  created_at: iso(now - (20 - i) * day),
  ...m,
}));

const sessions = [
  {
    id: "s-1",
    subject: "Geology",
    mode: "teaching",
    planned_minutes: 45,
    started_at: iso(now - 2 * day),
    ended_at: iso(now - 2 * day + 44 * 60_000),
    status: "completed",
    summary:
      "Worked through igneous vs. sedimentary rock formation with three practice questions; strong on definitions, needed hints on cooling rates.",
    questions_answered: 7,
    hints_given: 5,
    answers_revealed: 1,
    breaks_taken: 1,
    creations_made: 0,
    points_awarded: 76,
  },
  {
    id: "s-2",
    subject: "Geology",
    mode: "creation",
    planned_minutes: 25,
    started_at: iso(now - day),
    ended_at: iso(now - day + 22 * 60_000),
    status: "completed",
    summary:
      "Built a 12-card flashcard deck and an 8-question practice test for the Unit 1 Geology test.",
    questions_answered: 0,
    hints_given: 0,
    answers_revealed: 0,
    breaks_taken: 0,
    creations_made: 2,
    points_awarded: 43,
  },
].map((s) => ({
  user_id: USER_ID,
  course_id: COURSE_ID,
  created_at: s.started_at,
  ...s,
}));

const notes = [
  {
    id: "n-1",
    path: "Science 10/Geology/Lessons/Igneous Rocks.md",
    title: "Igneous Rocks",
    content:
      "# Igneous Rocks\n\nForm when **molten rock cools and solidifies**.\n\n- **Intrusive** (e.g. granite): cools *slowly* underground → large crystals\n- **Extrusive** (e.g. basalt): cools *quickly* at the surface → small crystals\n\nCooling rate ↔ crystal size is the key relationship. Part of the [[Rock Cycle]].\n\n#geology #rocks",
    tags: ["geology", "rocks"],
    links: ["Rock Cycle"],
    subject: "Geology",
  },
  {
    id: "n-2",
    path: "Science 10/Geology/Lessons/Rock Cycle.md",
    title: "Rock Cycle",
    content:
      "# Rock Cycle\n\nThe continuous transformation between [[Igneous Rocks]], sedimentary, and metamorphic rock through melting, weathering, heat and pressure.\n\n#geology",
    tags: ["geology"],
    links: ["Igneous Rocks"],
    subject: "Geology",
  },
  {
    id: "n-3",
    path: "Science 10/Geology/Created Materials/Unit 1 Practice Test.md",
    title: "Unit 1 Practice Test",
    content:
      "# Unit 1 Practice Test\n\n## Question 1\nWhich rock type forms from cooled magma?\n- A. Sedimentary\n- B. Igneous\n- C. Metamorphic\n\n**Answer:** B\n\n*Igneous rocks form when molten rock cools and solidifies.*",
    tags: ["geology", "practice"],
    links: [],
    subject: "Geology",
  },
  {
    id: "n-4",
    path: "Science 10/Geology/Question Summaries/Session " +
      dateStr(now - 2 * day) + ".md",
    title: "Session " + dateStr(now - 2 * day),
    content:
      "# Session summary\n\nWorked on igneous vs sedimentary formation.\n\n## Questions covered\n- Cooling rate vs crystal size — correct after 2 hints\n- Identify granite vs basalt — correct\n- Where fossils form — revealed after hints\n\n**Concepts:** [[Igneous Rocks]], [[Rock Cycle]]",
    tags: ["session-summary"],
    links: ["Igneous Rocks", "Rock Cycle"],
    subject: "Geology",
  },
  {
    id: "n-5",
    path: "Recommendations/Week of " + dateStr(now) + ".md",
    title: "Week of " + dateStr(now),
    content:
      "**Great week, Sam!** 🎉 You studied **86 minutes** across 3 sessions and answered 12 questions (75% correct).\n\n**What's working:** teaching-mode sessions with breaks — your correctness jumps after breaks.\n\n**Watch out:** you leaned on hints for *cooling rates* twice. That topic is on the Unit 1 test.\n\n**Next week:** two 25-minute reviews of rock formations before Friday's test, and finish the lab report (due Wednesday).",
    tags: ["weekly-recap"],
    links: [],
    subject: null,
  },
].map((n) => ({
  user_id: USER_ID,
  course_id: n.path.startsWith("Recommendations/") ? null : COURSE_ID,
  frontmatter: { source: "mytutor" },
  source_session_id: null,
  updated_at: iso(now - day),
  created_at: iso(now - day),
  ...n,
}));

const assignments = [
  {
    id: "a-1",
    title: "Rock cycle lab report",
    description: "Write up the rock identification lab.",
    due_at: iso(now - day),
    estimated_minutes: 90,
    complexity: "medium",
    status: "in_progress",
    completed_at: null,
  },
  {
    id: "a-2",
    title: "Unit 1 Geology test",
    description: "Covers rock types, rock cycle, plate tectonics.",
    due_at: iso(now + 4 * day),
    estimated_minutes: 60,
    complexity: "high",
    status: "todo",
    completed_at: null,
  },
  {
    id: "a-3",
    title: "Mineral identification worksheet",
    description: null,
    due_at: iso(now + 9 * day),
    estimated_minutes: 30,
    complexity: "low",
    status: "todo",
    completed_at: null,
  },
  {
    id: "a-4",
    title: "Safety quiz",
    description: null,
    due_at: iso(now - 6 * day),
    estimated_minutes: 15,
    complexity: "low",
    status: "done",
    completed_at: iso(now - 6 * day),
  },
].map((a) => ({
  user_id: USER_ID,
  course_id: COURSE_ID,
  created_at: iso(now - 10 * day),
  ...a,
}));

const grades = [
  {
    id: "g-1",
    title: "Geology quiz 1",
    score: 6,
    max_score: 10,
    weight: 5,
    feedback: "Mixed up intrusive and extrusive cooling rates.",
    topics: ["rock formations", "igneous rocks"],
    graded_at: dateStr(now - 8 * day),
  },
  {
    id: "g-2",
    title: "Minerals worksheet",
    score: 17,
    max_score: 20,
    weight: 5,
    feedback: null,
    topics: ["minerals", "Mohs scale"],
    graded_at: dateStr(now - 4 * day),
  },
  {
    id: "g-3",
    title: "Lab technique check",
    score: 9,
    max_score: 10,
    weight: null,
    feedback: "Excellent observations.",
    topics: ["lab skills"],
    graded_at: dateStr(now - 2 * day),
  },
].map((g) => ({
  user_id: USER_ID,
  course_id: COURSE_ID,
  assignment_id: null,
  created_at: iso(now - 5 * day),
  ...g,
}));

const dailyStats = Array.from({ length: 14 }, (_, i) => {
  const t = now - (13 - i) * day;
  const pattern = [35, 0, 48, 25, 0, 60, 44, 20, 0, 52, 38, 45, 22, 44];
  const minutes = pattern[i];
  return {
    day: dateStr(t),
    minutes,
    sessions: minutes > 0 ? 1 : 0,
    questions: minutes > 0 ? Math.round(minutes / 6) : 0,
    correct: minutes > 0 ? Math.round(minutes / 8) : 0,
    hints: minutes > 0 ? Math.round(minutes / 15) : 0,
  };
});

const leaderboard = [
  {
    user_id: "friend-1",
    display_name: "Priya",
    handle: "priya_p",
    points_week: 265,
    minutes_week: 180,
    points_total: 1420,
  },
  {
    user_id: USER_ID,
    display_name: "Sam",
    handle: "sam_studies",
    points_week: 210,
    minutes_week: 156,
    points_total: 620,
  },
  {
    user_id: "friend-2",
    display_name: "Marcus",
    handle: "marcus_w",
    points_week: 95,
    minutes_week: 70,
    points_total: 830,
  },
];

const friendRequests = [
  {
    friendship_id: "f-1",
    direction: "incoming",
    display_name: "Jordan",
    handle: "jordan_k",
    created_at: iso(now - day),
  },
];

const tree = {
  user_id: USER_ID,
  owned_items: ["flowers", "birdhouse", "lanterns"],
  equipped_items: ["flowers", "birdhouse"],
  updated_at: iso(now - day),
};

// ---------------------------------------------------------------------------
// Route-level fixture handler — the single demo interception point
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type Json = any;

let insertCounter = 0;

export function demoRequest(method: string, path: string, body?: Json): Json {
  const route = `${method} ${path.split("?")[0]}`;

  // Exact routes first
  switch (route) {
    case "GET /auth/me":
      return DEMO_STATE === "signedout"
        ? { user: null, profile: null }
        : {
          user: { id: USER_ID, email: "sam@example.com" },
          profile: demoProfile,
        };
    case "POST /auth/login":
    case "POST /auth/signup":
      return { token: "demo-token", userId: USER_ID };
    case "GET /profile":
      return demoProfile;
    case "PATCH /profile":
      Object.assign(demoProfile, body ?? {});
      return demoProfile;
    case "GET /style":
      return {
        user_id: USER_ID,
        preferences: {
          analogies: true,
          step_by_step: true,
          real_world_examples: true,
          visual: false,
          socratic: false,
          pace: "moderate",
        },
        style_notes: null,
      };
    case "PATCH /style":
      return { ok: true };
    case "GET /courses":
      return courses;
    case "POST /courses": {
      const course = {
        ...courses[0],
        id: `demo-course-${++insertCounter}`,
        ...body,
      };
      return course;
    }
    case "GET /sessions":
      return sessions;
    case "POST /sessions": {
      const session = {
        id: `demo-${++insertCounter}`,
        user_id: USER_ID,
        course_id: body?.courseId ?? COURSE_ID,
        subject: body?.subject ?? null,
        mode: body?.mode ?? "teaching",
        planned_minutes: body?.plannedMinutes ?? null,
        started_at: iso(now),
        ended_at: null,
        status: "active",
        summary: null,
        questions_answered: 0,
        hints_given: 0,
        answers_revealed: 0,
        breaks_taken: 0,
        creations_made: 0,
        points_awarded: 0,
        created_at: iso(now),
      };
      sessions.unshift(session as Json);
      return session;
    }
    case "GET /notes":
      return notes;
    case "GET /assignments":
      return assignments;
    case "POST /assignments":
      return { id: `demo-a-${++insertCounter}`, ...body };
    case "GET /grades":
      return grades;
    case "POST /grades":
      return { id: `demo-g-${++insertCounter}`, ...body };
    case "POST /extract-grade":
      return {
        title: "Geology quiz 2",
        score: 8,
        max_score: 10,
        feedback: "Much better on cooling rates!",
        topics: ["igneous rocks", "rock cycle"],
      };
    case "GET /stats/daily":
      return dailyStats;
    case "GET /points":
      return { balance: 185, lifetime: 620, week: 210 };
    case "GET /tree":
      return tree;
    case "POST /tree/purchase":
      return { balance: 125 };
    case "POST /tree/equip":
      return { ok: true };
    case "GET /friends/requests":
      return friendRequests;
    case "POST /friends/request":
      return { requested: true };
    case "POST /friends/respond":
      return { ok: true };
    case "GET /leaderboard":
      return leaderboard;
    case "POST /recap":
      return { recap: "Recap refreshed (demo).", notePath: null };
    case "DELETE /account":
      return { deleted: true };
    case "POST /materials":
      return { id: `demo-m-${++insertCounter}`, status: "uploaded", ...body };
  }

  // Parameterized routes
  const sessionMatch = path.match(/^\/sessions\/([^/]+)$/);
  if (method === "GET" && sessionMatch) {
    return sessions.find((s) => s.id === sessionMatch[1]) ?? sessions[0];
  }
  if (method === "GET" && /^\/sessions\/[^/]+\/messages$/.test(path)) {
    return [];
  }
  if (method === "GET" && /^\/courses\/[^/]+\/materials$/.test(path)) {
    return materials;
  }
  if (method === "PATCH" && /^\/assignments\//.test(path)) {
    const id = path.split("/")[2];
    const a = assignments.find((x) => x.id === id);
    if (a) Object.assign(a, body ?? {});
    return a ?? { ok: true };
  }
  if (method === "DELETE" && /^\/assignments\//.test(path)) {
    return { deleted: true };
  }

  console.warn(`demoRequest: unhandled route ${route}`);
  return {};
}

// ---------------------------------------------------------------------------
// Canned tutoring stream (teaching mode, geology)
// ---------------------------------------------------------------------------

const CANNED_REPLY =
  "Good question — and it's exactly what tripped you up on quiz 1, so let's nail it. 💪\n\nFrom your **Geology Unit Notes** (p. 1): crystal size comes down to *how fast* the molten rock cools.\n\nHere's your first hint:\n\n> Think about what a crystal needs in order to grow large. Is it more likely to get that deep underground, or out on the surface after an eruption?\n\nTake a guess: which one cools slower — granite (intrusive) or basalt (extrusive)?";

export async function demoStreamTutorChat(
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  onEvent({ type: "thinking", active: true });
  await sleep(700);
  onEvent({ type: "thinking", active: false });
  onEvent({
    type: "tool",
    name: "search_materials",
    label: "Searching materials: crystal size cooling rate",
  });
  await sleep(800);
  onEvent({ type: "tool", name: "give_hint", label: "Preparing a hint" });
  await sleep(400);
  onEvent({
    type: "hint",
    problemLabel: "crystal-size",
    hintsGiven: 1,
    revealAllowed: false,
  });
  for (const word of CANNED_REPLY.split(/(?<= )/)) {
    onEvent({ type: "delta", text: word });
    await sleep(18);
  }
  await sleep(200);
  onEvent({
    type: "note",
    noteId: "n-1",
    path: "Science 10/Geology/Lessons/Igneous Rocks.md",
    title: "Igneous Rocks",
  });
  onEvent({
    type: "done",
    messageId: "demo-msg",
    usage: {
      inputTokens: 2100,
      outputTokens: 260,
      cacheReadInputTokens: 6400,
      cacheCreationInputTokens: 0,
    },
  });
}

export const demoFinishSession = {
  sessionId: "demo",
  summary:
    "Reviewed igneous rock formation and the cooling-rate/crystal-size relationship with three practice questions.",
  durationMinutes: 32,
  questionsAnswered: 5,
  hintsGiven: 3,
  answersRevealed: 0,
  notesCreated: 1,
  pointsAwarded: 58,
};
