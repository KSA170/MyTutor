/**
 * Pure vault helpers — path validation, wikilink/tag parsing, markdown
 * assembly for the Obsidian-compatible vault. No I/O; unit-tested.
 */

export function validateVaultPath(path: string): string | null {
  if (!path || typeof path !== "string") return "path is required";
  if (!path.endsWith(".md")) return "path must end in .md";
  if (path.startsWith("/")) return "path must be vault-relative (no leading /)";
  if (path.includes("..")) return "path must not contain '..'";
  if (path.includes("\\")) return "path must use forward slashes";
  // deno-lint-ignore no-control-regex
  if (/[\x00-\x1f]/.test(path)) return "path contains control characters";
  const segments = path.split("/");
  if (segments.some((s) => s.trim() === "")) {
    return "path contains empty segments";
  }
  if (path.length > 512) return "path too long";
  return null;
}

/** Extract `[[wikilink]]` targets (without aliases or headings). */
export function parseWikilinks(markdown: string): string[] {
  const links = new Set<string>();
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const target = m[1].trim();
    if (target) links.add(target);
  }
  return [...links].sort();
}

/** Extract `#tag` occurrences from markdown body (excluding headings). */
export function parseTags(markdown: string): string[] {
  const tags = new Set<string>();
  // Negative lookbehind for start-of-line # (headings) and word chars (anchors)
  const re = /(?<=^|[\s(])#([A-Za-z][\w/-]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    tags.add(m[1]);
  }
  return [...tags].sort();
}

/** Serialize a note row into a complete Obsidian .md file (for export). */
export function renderNoteFile(note: {
  title: string;
  frontmatter: Record<string, unknown>;
  content: string;
}): string {
  const fm = { ...note.frontmatter };
  const lines: string[] = ["---"];
  for (const key of Object.keys(fm).sort()) {
    const value = fm[key];
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n") + "\n\n" + note.content +
    (note.content.endsWith("\n") ? "" : "\n");
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[:#\[\]{}&*!|>'"%@`,\n]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}
