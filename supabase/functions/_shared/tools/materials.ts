import type { Tool } from "./types.ts";

export const searchMaterials: Tool = {
  definition: {
    name: "search_materials",
    description:
      "Full-text search across the student's uploaded course materials for this course. Call this when a question likely relates to course content — lecture slides, textbook chapters, notes, handouts. Returns the most relevant passages with their source material and pages.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search terms — key concepts, not full sentences (e.g. 'igneous rock formation cooling rate').",
        },
        max_results: {
          type: "integer",
          description: "Maximum passages to return (default 6, max 20).",
        },
      },
      required: ["query"],
    },
  },
  label: (input) => `Searching materials: ${input.query}`,
  handler: async (input, ctx) => {
    if (!ctx.courseId) {
      return { error: "No course is attached to this session." };
    }
    const { data, error } = await ctx.supabase.rpc("search_material_chunks", {
      p_course_id: ctx.courseId,
      p_query: input.query,
      p_limit: input.max_results ?? 6,
    });
    if (error) return { error: error.message };
    if (!data || data.length === 0) {
      return {
        results: [],
        note: "No passages matched. Try different terms, or read a specific material with get_material using its id from the materials index.",
      };
    }
    return {
      results: data.map((row: Record<string, unknown>) => ({
        material_id: row.material_id,
        material_title: row.material_title,
        pages:
          row.page_start != null ? `${row.page_start}-${row.page_end}` : null,
        content: row.content,
      })),
    };
  },
};

export const getMaterial: Tool = {
  definition: {
    name: "get_material",
    description:
      "Read the extracted content of one uploaded material by id (ids are in the materials index). Use after search_materials when you need more surrounding context, or to read a document straight through. Content is returned in sequential chunks.",
    input_schema: {
      type: "object",
      properties: {
        material_id: { type: "string", description: "Material id (uuid)." },
        from_chunk: {
          type: "integer",
          description: "First chunk index to read (default 0).",
        },
        max_chunks: {
          type: "integer",
          description: "How many chunks to return (default 4, max 10).",
        },
      },
      required: ["material_id"],
    },
  },
  label: () => "Reading course material",
  handler: async (input, ctx) => {
    const from = input.from_chunk ?? 0;
    const count = Math.min(input.max_chunks ?? 4, 10);
    const { data: material } = await ctx.supabase
      .from("materials")
      .select("title, kind, page_count")
      .eq("id", input.material_id)
      .single();
    if (!material) return { error: "Material not found." };

    const { data: chunks, error } = await ctx.supabase
      .from("material_chunks")
      .select("seq, page_start, page_end, content")
      .eq("material_id", input.material_id)
      .gte("seq", from)
      .order("seq", { ascending: true })
      .limit(count);
    if (error) return { error: error.message };

    const { count: total } = await ctx.supabase
      .from("material_chunks")
      .select("id", { count: "exact", head: true })
      .eq("material_id", input.material_id);

    return {
      title: material.title,
      kind: material.kind,
      total_chunks: total ?? 0,
      chunks: (chunks ?? []).map((c) => ({
        seq: c.seq,
        pages: c.page_start != null ? `${c.page_start}-${c.page_end}` : null,
        content: c.content,
      })),
    };
  },
};
