import { describe, expect, it } from "vitest";
import {
  buildCourseContext,
  modeInstruction,
  stableJson,
  STATIC_TUTOR_PROMPT,
  type Db,
} from "../apps/api/src/lib/prompts.ts";

/** Fake Db routing on SQL text — enough for buildCourseContext's queries. */
// deno-lint-ignore no-explicit-any
type Json = any;

function fakeDb(fixtures: {
  profile?: Json;
  style?: Json;
  course?: Json;
  materials?: Json[];
  grades?: Json[];
  assignments?: Json[];
}): Db {
  const route = (sql: string): Json => {
    if (sql.includes("from profiles")) return fixtures.profile ?? null;
    if (sql.includes("from learning_style_profiles")) {
      return fixtures.style ?? null;
    }
    if (sql.includes("from courses")) return fixtures.course ?? null;
    if (sql.includes("from materials")) return fixtures.materials ?? [];
    if (sql.includes("from grades")) return fixtures.grades ?? [];
    if (sql.includes("from assignments")) return fixtures.assignments ?? [];
    throw new Error(`unrouted sql: ${sql}`);
  };
  return {
    q: async (sql) => route(sql) ?? [],
    one: async (sql) => route(sql),
  };
}

const FIXTURES = {
  profile: { display_name: "Sam", grade_level: "Grade 10", program: "IB" },
  style: {
    preferences: {
      pace: "moderate",
      analogies: true,
      step_by_step: true,
      real_world_examples: false,
      visual: false,
      socratic: false,
    },
    style_notes: "- Prefers sports analogies",
  },
  course: {
    name: "Science 10",
    subject: "Science",
    grade_level: "Grade 10",
    instructor: "Ms. K",
    term: "Fall 2026",
    curriculum: "Unit 1: Geology\nUnit 2: Physics",
    context_summary: "Covers geology and physics fundamentals.",
  },
  materials: [
    {
      id: "m1",
      title: "Lecture 1",
      kind: "pdf",
      summary: "Intro to rocks.",
      topics: ["rocks", "minerals"],
    },
  ],
  grades: [
    {
      title: "Quiz 1",
      score: 6,
      max_score: 10,
      topics: ["rock formations"],
      graded_at: "2026-07-20",
      feedback: null,
    },
  ],
  assignments: [
    {
      title: "Lab report",
      due_at: "2026-08-01T00:00:00Z",
      status: "todo",
      complexity: "medium",
      estimated_minutes: 90,
    },
  ],
};

describe("buildCourseContext determinism (the cache invariant)", () => {
  it("produces byte-identical output for identical DB state", async () => {
    const a = await buildCourseContext("u1", "c1", fakeDb(FIXTURES));
    const b = await buildCourseContext("u1", "c1", fakeDb(FIXTURES));
    expect(a).toBe(b);
    expect(a).toContain("Science 10");
    expect(a).toContain("Lecture 1");
    expect(a).toContain("Quiz 1"); // recent results feed review planning
    expect(a).toContain("weak — plan review"); // 60% flags weak topic
    expect(a).toContain("Lab report"); // open assignments visible
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no timestamps in the prefix
  });

  it("is insensitive to JSON key order in preferences", async () => {
    const reordered = {
      ...FIXTURES,
      style: {
        ...FIXTURES.style,
        preferences: {
          socratic: false,
          visual: false,
          real_world_examples: false,
          step_by_step: true,
          analogies: true,
          pace: "moderate",
        },
      },
    };
    const a = await buildCourseContext("u1", "c1", fakeDb(FIXTURES));
    const b = await buildCourseContext("u1", "c1", fakeDb(reordered));
    expect(a).toBe(b);
  });

  it("handles the no-course case", async () => {
    const out = await buildCourseContext("u1", null, fakeDb(FIXTURES));
    expect(out).toContain("no course selected");
  });
});

describe("stableJson", () => {
  it("sorts keys recursively", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });
});

describe("static prompt", () => {
  it("covers all three modes and the tool contract", () => {
    for (const needle of [
      "teaching",
      "answering",
      "creation",
      "give_hint",
      "reveal_answer",
      "create_study_material",
      "create_note",
      "create_assignment",
      "log_grade",
      "[[wikilinks]]",
    ]) {
      expect(STATIC_TUTOR_PROMPT).toContain(needle);
    }
  });

  it("mode instructions are distinct per mode", () => {
    const set = new Set(
      ["teaching", "answering", "creation"].map(modeInstruction),
    );
    expect(set.size).toBe(3);
  });
});
