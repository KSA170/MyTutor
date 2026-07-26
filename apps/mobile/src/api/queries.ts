import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Course, Material, Note, Session } from "@mytutor/shared";
import { supabase } from "../lib/supabase";

export function useCourses() {
  return useQuery({
    queryKey: ["courses"],
    queryFn: async (): Promise<Course[]> => {
      const { data, error } = await supabase
        .from("courses")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Course[];
    },
  });
}

export function useMaterials(courseId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["materials", courseId],
    enabled: !!courseId,
    queryFn: async (): Promise<Material[]> => {
      const { data, error } = await supabase
        .from("materials")
        .select("*")
        .eq("course_id", courseId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Material[];
    },
  });

  // Live processing-status updates (uploaded → processing → ready/failed).
  useEffect(() => {
    if (!courseId) return;
    const channel = supabase
      .channel(`materials-${courseId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "materials",
          filter: `course_id=eq.${courseId}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ["materials", courseId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [courseId, queryClient]);

  return query;
}

export function useNotes() {
  return useQuery({
    queryKey: ["notes"],
    queryFn: async (): Promise<Note[]> => {
      const { data, error } = await supabase
        .from("notes")
        .select("id, user_id, course_id, subject, path, title, frontmatter, content, tags, links, source_session_id, updated_at, created_at")
        .order("path");
      if (error) throw error;
      return data as Note[];
    },
  });
}

export function useRecentSessions(limit = 10) {
  return useQuery({
    queryKey: ["sessions", "recent", limit],
    queryFn: async (): Promise<Session[]> => {
      const { data, error } = await supabase
        .from("sessions")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as Session[];
    },
  });
}

export function useSession(sessionId: string | null) {
  return useQuery({
    queryKey: ["session", sessionId],
    enabled: !!sessionId,
    queryFn: async (): Promise<Session> => {
      const { data, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", sessionId!)
        .single();
      if (error) throw error;
      return data as Session;
    },
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      courseId: string | null;
      mode: string;
      plannedMinutes: number | null;
      subject?: string | null;
    }): Promise<Session> => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("sessions")
        .insert({
          user_id: userId,
          course_id: args.courseId,
          subject: args.subject ?? null,
          mode: args.mode,
          planned_minutes: args.plannedMinutes,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as Session;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}
