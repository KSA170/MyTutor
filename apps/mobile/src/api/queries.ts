import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  Assignment,
  AssignmentStatus,
  Course,
  DailyStudyStats,
  Grade,
  LeaderboardRow,
  Material,
  Note,
  Session,
  TreeState,
} from "@mytutor/shared";
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

// ---------------------------------------------------------------------------
// Phase 2: planner + grades + analytics
// ---------------------------------------------------------------------------

export function useAssignments(includeDone = true) {
  return useQuery({
    queryKey: ["assignments", includeDone],
    queryFn: async (): Promise<Assignment[]> => {
      let q = supabase
        .from("assignments")
        .select("*")
        .order("due_at", { ascending: true, nullsFirst: false });
      if (!includeDone) q = q.neq("status", "done");
      const { data, error } = await q;
      if (error) throw error;
      return data as Assignment[];
    },
  });
}

export function useSaveAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id?: string;
      courseId: string;
      title: string;
      description?: string | null;
      dueAt?: string | null;
      estimatedMinutes?: number | null;
      complexity?: string | null;
    }): Promise<Assignment> => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");
      const row = {
        user_id: userId,
        course_id: args.courseId,
        title: args.title,
        description: args.description ?? null,
        due_at: args.dueAt ?? null,
        estimated_minutes: args.estimatedMinutes ?? null,
        complexity: args.complexity ?? null,
      };
      const query = args.id
        ? supabase.from("assignments").update(row).eq("id", args.id)
        : supabase.from("assignments").insert(row);
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      return data as Assignment;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["assignments"] }),
  });
}

export function useSetAssignmentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; status: AssignmentStatus }) => {
      const { error } = await supabase
        .from("assignments")
        .update({
          status: args.status,
          completed_at: args.status === "done"
            ? new Date().toISOString()
            : null,
        })
        .eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["assignments"] }),
  });
}

export function useDeleteAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("assignments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["assignments"] }),
  });
}

export function useGrades() {
  return useQuery({
    queryKey: ["grades"],
    queryFn: async (): Promise<Grade[]> => {
      const { data, error } = await supabase
        .from("grades")
        .select("*")
        .order("graded_at", { ascending: false });
      if (error) throw error;
      return data as Grade[];
    },
  });
}

export function useCreateGrade() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      courseId: string;
      title: string;
      score: number;
      maxScore: number;
      weight?: number | null;
      feedback?: string | null;
      topics: string[];
      assignmentId?: string | null;
      gradedAt?: string | null;
    }): Promise<Grade> => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("grades")
        .insert({
          user_id: userId,
          course_id: args.courseId,
          title: args.title,
          score: args.score,
          max_score: args.maxScore,
          weight: args.weight ?? null,
          feedback: args.feedback ?? null,
          topics: args.topics,
          assignment_id: args.assignmentId ?? null,
          ...(args.gradedAt ? { graded_at: args.gradedAt } : {}),
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as Grade;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["grades"] }),
  });
}

export function useDailyStats(days = 14) {
  return useQuery({
    queryKey: ["daily-stats", days],
    queryFn: async (): Promise<DailyStudyStats[]> => {
      const { data, error } = await supabase.rpc("get_daily_study_stats", {
        p_days: days,
      });
      if (error) throw error;
      return data as DailyStudyStats[];
    },
  });
}

/** Latest weekly recap note (written by the weekly-recap function). */
export function useLatestRecap() {
  return useQuery({
    queryKey: ["latest-recap"],
    queryFn: async (): Promise<Note | null> => {
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .like("path", "Recommendations/%")
        .order("path", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as Note) ?? null;
    },
  });
}

// ---------------------------------------------------------------------------
// Phase 3: points, tree, friends
// ---------------------------------------------------------------------------

export interface PointsSummary {
  balance: number;
  lifetime: number;
  week: number;
}

export function usePoints() {
  return useQuery({
    queryKey: ["points"],
    queryFn: async (): Promise<PointsSummary> => {
      const { data, error } = await supabase.rpc("get_points_summary");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        balance: row?.balance ?? 0,
        lifetime: row?.lifetime ?? 0,
        week: row?.week ?? 0,
      };
    },
  });
}

export function useTreeState() {
  return useQuery({
    queryKey: ["tree"],
    queryFn: async (): Promise<TreeState | null> => {
      const { data, error } = await supabase
        .from("tree_states")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return (data as TreeState) ?? null;
    },
  });
}

export function usePurchaseTreeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string): Promise<number> => {
      const { data, error } = await supabase.rpc("purchase_tree_item", {
        p_item_id: itemId,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tree"] });
      queryClient.invalidateQueries({ queryKey: ["points"] });
    },
  });
}

export function useSetEquippedItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: string[]) => {
      const { error } = await supabase.rpc("set_equipped_items", {
        p_items: items,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tree"] }),
  });
}

export interface FriendRequestRow {
  friendship_id: string;
  direction: "incoming" | "outgoing";
  display_name: string;
  handle: string | null;
  created_at: string;
}

export function useFriendRequests() {
  return useQuery({
    queryKey: ["friend-requests"],
    queryFn: async (): Promise<FriendRequestRow[]> => {
      const { data, error } = await supabase.rpc("get_friend_requests");
      if (error) throw error;
      return data as FriendRequestRow[];
    },
  });
}

export function useLeaderboard() {
  return useQuery({
    queryKey: ["leaderboard"],
    queryFn: async (): Promise<LeaderboardRow[]> => {
      const { data, error } = await supabase.rpc("get_leaderboard");
      if (error) throw error;
      return data as LeaderboardRow[];
    },
  });
}

export function useRequestFriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (handle: string) => {
      const { error } = await supabase.rpc("request_friend", {
        p_handle: handle.trim().toLowerCase(),
      });
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["friend-requests"] }),
  });
}

export function useRespondFriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { friendshipId: string; accept: boolean }) => {
      const { error } = await supabase.rpc("respond_friend", {
        p_friendship_id: args.friendshipId,
        p_accept: args.accept,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["friend-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    },
  });
}

export function useSetHandle() {
  return useMutation({
    mutationFn: async (handle: string) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({ handle: handle.trim().toLowerCase() })
        .eq("id", userId);
      if (error) throw error;
    },
  });
}
