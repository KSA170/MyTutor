import { describe, expect, it } from "vitest";
import {
  buildCourseContext,
  modeInstruction,
  stableJson,
  STATIC_TUTOR_PROMPT,
} from "../supabase/functions/_shared/prompts.ts";

/**
 * Minimal chainable fake of the supabase query builder — enough for
 * buildCourseContext's query shapes (select/eq/order/single chains).
 */
// deno-lint-ignore-file no-explicit-any
function fakeDb(fixtures: {
  profiles?: any;
  learning_style_profiles?: any;
  courses?: any;
  materials?: any[];
  grades?: any[];
  assignments?: any[];
}) {
  return {
    from(table: string) {
      const fixture = (fixtures as any)[table];
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        neq: () => builder,
        order: () => builder,
        limit: () => builder,
        single: () => Promise.resolve({ data: fixture ?? null }),
        then: (resolve: (v: any) => void) =>
          Promise.resolve({ data: fixture ?? [] }).then(resolve),
      };
      return builder;
    },
  } as any;
}

const FIXTURES = {
  profiles: { display_name: "Sam", grade_level: "Grade 10", program: "IB" },
  learning_style_profiles: {
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
  courses: {
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
    const a = await buildCourseContext(fakeDb(FIXTURES), "u1", "c1");
    const b = await buildCourseContext(fakeDb(FIXTURES), "u1", "c1");
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
      learning_style_profiles: {
        ...FIXTURES.learning_style_profiles,
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
    const a = await buildCourseContext(fakeDb(FIXTURES), "u1", "c1");
    const b = await buildCourseContext(fakeDb(reordered), "u1", "c1");
    expect(a).toBe(b);
  });

  it("handles the no-course case", async () => {
    const out = await buildCourseContext(fakeDb(FIXTURES), "u1", null);
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
