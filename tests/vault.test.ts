import { describe, expect, it } from "vitest";
import {
  parseTags,
  parseWikilinks,
  renderNoteFile,
  validateVaultPath,
} from "../supabase/functions/_shared/vault.ts";

describe("validateVaultPath", () => {
  it("accepts well-formed vault paths", () => {
    expect(
      validateVaultPath("Science 10/Geology/Lessons/Rock Formations.md"),
    ).toBeNull();
    expect(validateVaultPath("Course/Note.md")).toBeNull();
  });

  it("rejects traversal and malformed paths", () => {
    expect(validateVaultPath("../etc/passwd.md")).not.toBeNull();
    expect(validateVaultPath("a/../b.md")).not.toBeNull();
    expect(validateVaultPath("/absolute.md")).not.toBeNull();
    expect(validateVaultPath("no-extension")).not.toBeNull();
    expect(validateVaultPath("a//b.md")).not.toBeNull();
    expect(validateVaultPath("back\\slash.md")).not.toBeNull();
    expect(validateVaultPath("")).not.toBeNull();
  });
});

describe("parseWikilinks", () => {
  it("extracts targets, aliases, and heading links", () => {
    const md =
      "See [[Igneous Rocks]] and [[Rock Cycle|the cycle]] plus [[Plate Tectonics#Subduction]].";
    expect(parseWikilinks(md)).toEqual([
      "Igneous Rocks",
      "Plate Tectonics",
      "Rock Cycle",
    ]);
  });

  it("dedupes and ignores empty links", () => {
    expect(parseWikilinks("[[A]] [[A]] [[]]")).toEqual(["A"]);
  });
});

describe("parseTags", () => {
  it("extracts #tags but not markdown headings", () => {
    const md = "# Heading\n\nAbout #geology and #rock-cycle stuff (#minerals)";
    expect(parseTags(md)).toEqual(["geology", "minerals", "rock-cycle"]);
  });
});

describe("renderNoteFile", () => {
  it("renders sorted YAML frontmatter and body", () => {
    const file = renderNoteFile({
      title: "Rocks",
      frontmatter: {
        tags: ["geology"],
        created: "2026-07-26",
        source: "mytutor",
      },
      content: "# Rocks\n\nBody text.",
    });
    expect(file).toBe(
      [
        "---",
        "created: 2026-07-26",
        "source: mytutor",
        "tags:",
        "  - geology",
        "---",
        "",
        "# Rocks",
        "",
        "Body text.",
        "",
      ].join("\n"),
    );
  });

  it("quotes YAML-special scalars", () => {
    const file = renderNoteFile({
      title: "T",
      frontmatter: { note: "colon: risky" },
      content: "x",
    });
    expect(file).toContain('note: "colon: risky"');
  });
});
