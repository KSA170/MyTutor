#!/usr/bin/env node
/**
 * Seed a test user + demo course + pre-processed material so the backend can
 * be exercised end-to-end without the app (see scripts/smoke-chat.sh).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *     node scripts/seed.mjs
 *
 * Prints the test user's JWT and the seeded course/session ids.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (!url || !serviceKey || !anonKey) {
  console.error(
    "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY",
  );
  process.exit(1);
}

const EMAIL = process.env.TEST_EMAIL ?? "test@mytutor.local";
const PASSWORD = process.env.TEST_PASSWORD ?? "test-password-123";

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

// --- user ------------------------------------------------------------------
let userId;
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { display_name: "Test Student" },
});
if (createErr) {
  if (!/already/i.test(createErr.message)) throw createErr;
  const { data: list } = await admin.auth.admin.listUsers();
  userId = list.users.find((u) => u.email === EMAIL)?.id;
  if (!userId) throw new Error("User exists but not found");
  console.log("Reusing existing test user", userId);
} else {
  userId = created.user.id;
  console.log("Created test user", userId);
}

await admin
  .from("profiles")
  .update({
    grade_level: "Grade 10",
    program: "IB MYP",
    onboarding_completed: true,
  })
  .eq("id", userId);

// --- course ----------------------------------------------------------------
const { data: existingCourse } = await admin
  .from("courses")
  .select("id")
  .eq("user_id", userId)
  .eq("name", "Science 10")
  .maybeSingle();

let courseId = existingCourse?.id;
if (!courseId) {
  const { data: course, error } = await admin
    .from("courses")
    .insert({
      user_id: userId,
      name: "Science 10",
      subject: "Science",
      grade_level: "Grade 10",
      instructor: "Ms. Kaur",
      term: "Fall 2026",
      curriculum:
        "Unit 1: Geology — rock cycle, rock formations, plate tectonics.\nUnit 2: Chemistry — atomic structure, periodic table.\nUnit 3: Physics — motion and forces.",
    })
    .select("id")
    .single();
  if (error) throw error;
  courseId = course.id;
}
console.log("Course:", courseId);

// --- material + chunks (pre-processed; skips the ingestion pipeline) -------
const { data: existingMaterial } = await admin
  .from("materials")
  .select("id")
  .eq("course_id", courseId)
  .eq("title", "Geology Unit Notes")
  .maybeSingle();

if (!existingMaterial) {
  const { data: material, error } = await admin
    .from("materials")
    .insert({
      user_id: userId,
      course_id: courseId,
      title: "Geology Unit Notes",
      kind: "pdf",
      storage_path: `${userId}/${courseId}/seed/geology-notes.pdf`,
      mime_type: "application/pdf",
      status: "ready",
      summary:
        "Class notes for the geology unit: the three rock types (igneous, sedimentary, metamorphic), how each forms, the rock cycle, and an intro to plate tectonics.",
      topics: ["rock cycle", "igneous", "sedimentary", "metamorphic", "plate tectonics"],
      page_count: 3,
      processed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;

  await admin.from("material_chunks").insert([
    {
      material_id: material.id,
      user_id: userId,
      seq: 0,
      page_start: 1,
      page_end: 1,
      content:
        "Igneous rocks form when molten rock (magma or lava) cools and solidifies. Intrusive igneous rocks like granite cool slowly underground, producing large crystals. Extrusive igneous rocks like basalt cool quickly at the surface, producing small crystals.",
      token_estimate: 60,
    },
    {
      material_id: material.id,
      user_id: userId,
      seq: 1,
      page_start: 2,
      page_end: 2,
      content:
        "Sedimentary rocks form from compacted and cemented sediments — sand, silt, and organic matter deposited in layers. Examples: sandstone, limestone, shale. Fossils are almost always found in sedimentary rock.",
      token_estimate: 55,
    },
    {
      material_id: material.id,
      user_id: userId,
      seq: 2,
      page_start: 3,
      page_end: 3,
      content:
        "Metamorphic rocks form when existing rocks are transformed by heat and pressure without melting. Examples: marble (from limestone), slate (from shale). The rock cycle connects all three types through melting, weathering, and metamorphism.",
      token_estimate: 55,
    },
  ]);
  console.log("Material seeded:", material.id);
} else {
  console.log("Material already seeded");
}

// --- session (teaching mode) ----------------------------------------------
const { data: session, error: sessionErr } = await admin
  .from("sessions")
  .insert({
    user_id: userId,
    course_id: courseId,
    subject: "Geology",
    mode: "teaching",
    planned_minutes: 25,
  })
  .select("id")
  .single();
if (sessionErr) throw sessionErr;
console.log("Session:", session.id);

// --- sign in for a JWT -----------------------------------------------------
const client = createClient(url, anonKey, { auth: { persistSession: false } });
const { data: signIn, error: signInErr } = await client.auth
  .signInWithPassword({ email: EMAIL, password: PASSWORD });
if (signInErr) throw signInErr;

console.log("\nExport these for smoke-chat.sh:");
console.log(`export SUPABASE_URL=${url}`);
console.log(`export JWT=${signIn.session.access_token}`);
console.log(`export SESSION_ID=${session.id}`);
