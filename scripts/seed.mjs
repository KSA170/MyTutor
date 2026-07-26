#!/usr/bin/env node
/**
 * Seed a test user + demo course + assignments/grades through the API, and
 * print a JWT for smoke-chat.sh.
 *
 * Usage:  API_URL=http://localhost:3000 node scripts/seed.mjs
 * (Run the API first: DATABASE_URL=... JWT_SECRET=... OPENROUTER_API_KEY=... \
 *    npm run dev --workspace @mytutor/api)
 */
const API_URL = (process.env.API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = process.env.TEST_EMAIL ?? "test@mytutor.local";
const PASSWORD = process.env.TEST_PASSWORD ?? "test-password-123";

async function call(method, path, body, token) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data.error ?? ""}`);
  return data;
}

// --- user (signup, else login) --------------------------------------------
let token;
try {
  ({ token } = await call("POST", "/auth/signup", {
    email: EMAIL,
    password: PASSWORD,
    displayName: "Test Student",
  }));
  console.log("Created test user");
} catch {
  ({ token } = await call("POST", "/auth/login", {
    email: EMAIL,
    password: PASSWORD,
  }));
  console.log("Reusing existing test user");
}

await call("PATCH", "/profile", {
  grade_level: "Grade 10",
  program: "IB MYP",
  onboarding_completed: true,
}, token);

// --- course ---------------------------------------------------------------
const courses = await call("GET", "/courses", null, token);
let course = courses.find((c) => c.name === "Science 10");
if (!course) {
  course = await call("POST", "/courses", {
    name: "Science 10",
    subject: "Science",
    instructor: "Ms. Kaur",
    term: "Fall 2026",
    curriculum:
      "Unit 1: Geology — rock cycle, rock formations, plate tectonics.\nUnit 2: Chemistry — atomic structure, periodic table.\nUnit 3: Physics — motion and forces.",
  }, token);
}
console.log("Course:", course.id);

// --- assignments + a grade -------------------------------------------------
const assignments = await call("GET", "/assignments", null, token);
if (assignments.length === 0) {
  await call("POST", "/assignments", {
    courseId: course.id,
    title: "Rock cycle lab report",
    description: "Write up the rock identification lab.",
    dueAt: new Date(Date.now() + 3 * 86400_000).toISOString(),
    estimatedMinutes: 90,
    complexity: "medium",
  }, token);
  await call("POST", "/grades", {
    courseId: course.id,
    title: "Geology quiz 1",
    score: 6,
    maxScore: 10,
    topics: ["rock formations", "igneous rocks"],
    feedback: "Mixed up intrusive and extrusive cooling rates.",
  }, token);
  console.log("Assignments + grade seeded");
}

// --- session ---------------------------------------------------------------
const session = await call("POST", "/sessions", {
  courseId: course.id,
  subject: "Geology",
  mode: "teaching",
  plannedMinutes: 25,
}, token);
console.log("Session:", session.id);

console.log("\nExport these for smoke-chat.sh:");
console.log(`export API_URL=${API_URL}`);
console.log(`export JWT=${token}`);
console.log(`export SESSION_ID=${session.id}`);
