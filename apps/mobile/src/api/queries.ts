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
import { http } from "../lib/http";

export function useCourses() {
  return useQuery({
    queryKey: ["courses"],
    queryFn: () => http.get<Course[]>("/courses"),
  });
}

export function useMaterials(courseId: string | null) {
  return useQuery({
    queryKey: ["materials", courseId],
    enabled: !!courseId,
    queryFn: () => http.get<Material[]>(`/courses/${courseId}/materials`),
    // Poll while anything is still processing (replaces Supabase Realtime).
    refetchInterval: (query) =>
      (query.state.data ?? []).some(
          (m) => m.status === "uploaded" || m.status === "processing",
        )
        ? 4000
        : false,
  });
}

export function useNotes() {
  return useQuery({
    queryKey: ["notes"],
    queryFn: () => http.get<Note[]>("/notes"),
  });
}

export function useRecentSessions(limit = 10) {
  return useQuery({
    queryKey: ["sessions", "recent", limit],
    queryFn: () => http.get<Session[]>(`/sessions?limit=${limit}`),
  });
}

export function useSession(sessionId: string | null) {
  return useQuery({
    queryKey: ["session", sessionId],
    enabled: !!sessionId,
    queryFn: () => http.get<Session>(`/sessions/${sessionId}`),
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      courseId: string | null;
      mode: string;
      plannedMinutes: number | null;
      subject?: string | null;
    }) => http.post<Session>("/sessions", args),
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
    queryFn: async () => {
      const rows = await http.get<Assignment[]>("/assignments");
      return includeDone ? rows : rows.filter((a) => a.status !== "done");
    },
  });
}

export function useSaveAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id?: string;
      courseId: string;
      title: string;
      description?: string | null;
      dueAt?: string | null;
      estimatedMinutes?: number | null;
      complexity?: string | null;
    }) =>
      args.id
        ? http.patch<Assignment>(`/assignments/${args.id}`, args)
        : http.post<Assignment>("/assignments", args),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["assignments"] }),
  });
}

export function useSetAssignmentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; status: AssignmentStatus }) =>
      http.patch(`/assignments/${args.id}`, { status: args.status }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["assignments"] }),
  });
}

export function useDeleteAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => http.del(`/assignments/${id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["assignments"] }),
  });
}

export function useGrades() {
  return useQuery({
    queryKey: ["grades"],
    queryFn: () => http.get<Grade[]>("/grades"),
  });
}

export function useCreateGrade() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      courseId: string;
      title: string;
      score: number;
      maxScore: number;
      weight?: number | null;
      feedback?: string | null;
      topics: string[];
      assignmentId?: string | null;
      gradedAt?: string | null;
    }) => http.post<Grade>("/grades", args),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["grades"] }),
  });
}

export function useDailyStats(days = 14) {
  return useQuery({
    queryKey: ["daily-stats", days],
    queryFn: () => http.get<DailyStudyStats[]>(`/stats/daily?days=${days}`),
  });
}

/** Latest weekly recap note (written by the recap endpoint). */
export function useLatestRecap() {
  return useQuery({
    queryKey: ["notes"],
    queryFn: () => http.get<Note[]>("/notes"),
    select: (notes): Note | null =>
      notes
        .filter((n) => n.path.startsWith("Recommendations/"))
        .sort((a, b) => b.path.localeCompare(a.path))[0] ?? null,
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
    queryFn: () => http.get<PointsSummary>("/points"),
  });
}

export function useTreeState() {
  return useQuery({
    queryKey: ["tree"],
    queryFn: () => http.get<TreeState | null>("/tree"),
  });
}

export function usePurchaseTreeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const res = await http.post<{ balance: number }>("/tree/purchase", {
        itemId,
      });
      return res.balance;
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
    mutationFn: (items: string[]) => http.post("/tree/equip", { items }),
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
    queryFn: () => http.get<FriendRequestRow[]>("/friends/requests"),
  });
}

export function useLeaderboard() {
  return useQuery({
    queryKey: ["leaderboard"],
    queryFn: () => http.get<LeaderboardRow[]>("/leaderboard"),
  });
}

export function useRequestFriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (handle: string) =>
      http.post("/friends/request", { handle: handle.trim().toLowerCase() }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["friend-requests"] }),
  });
}

export function useRespondFriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { friendshipId: string; accept: boolean }) =>
      http.post("/friends/respond", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["friend-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    },
  });
}

export function useSetHandle() {
  return useMutation({
    mutationFn: (handle: string) =>
      http.patch("/profile", { handle: handle.trim().toLowerCase() }),
  });
}
