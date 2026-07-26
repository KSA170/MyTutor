import { useMemo, useState } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type {
  Assignment,
  AssignmentComplexity,
  AssignmentStatus,
} from "@mytutor/shared";
import {
  Button,
  Card,
  Chip,
  ErrorText,
  Label,
  Screen,
  Subtitle,
  Title,
} from "@/components/ui";
import {
  useAssignments,
  useCourses,
  useDeleteAssignment,
  useGrades,
  useSetAssignmentStatus,
} from "@/api/queries";
import { colors, spacing } from "@/theme";

const NEXT_STATUS: Record<AssignmentStatus, AssignmentStatus> = {
  todo: "in_progress",
  in_progress: "done",
  done: "todo",
};

const STATUS_LABELS: Record<AssignmentStatus, string> = {
  todo: "○ To do",
  in_progress: "◑ Doing",
  done: "✓ Done",
};

const STATUS_COLORS: Record<AssignmentStatus, string> = {
  todo: colors.textMuted,
  in_progress: colors.accent,
  done: colors.primary,
};

const COMPLEXITY_META: Record<
  AssignmentComplexity,
  { label: string; color: string }
> = {
  low: { label: "🟢 low", color: colors.primary },
  medium: { label: "🟠 medium", color: colors.accent },
  high: { label: "🔴 high", color: colors.danger },
};

function groupAssignments(assignments: Assignment[]) {
  const now = Date.now();
  const weekOut = now + 7 * 24 * 60 * 60 * 1000;
  const groups = {
    overdue: [] as Assignment[],
    thisWeek: [] as Assignment[],
    later: [] as Assignment[],
    noDate: [] as Assignment[],
    done: [] as Assignment[],
  };
  for (const a of assignments) {
    if (a.status === "done") groups.done.push(a);
    else if (!a.due_at) groups.noDate.push(a);
    else {
      const t = new Date(a.due_at).getTime();
      if (t < now) groups.overdue.push(a);
      else if (t <= weekOut) groups.thisWeek.push(a);
      else groups.later.push(a);
    }
  }
  return groups;
}

function percentColor(pct: number) {
  if (pct >= 85) return colors.primary;
  if (pct >= 70) return colors.accent;
  return colors.danger;
}

export default function Planner() {
  const router = useRouter();
  const [view, setView] = useState<"assignments" | "grades">("assignments");
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: assignments } = useAssignments();
  const { data: grades } = useGrades();
  const { data: courses } = useCourses();
  const setStatus = useSetAssignmentStatus();
  const deleteAssignment = useDeleteAssignment();

  const groups = useMemo(
    () => groupAssignments(assignments ?? []),
    [assignments],
  );
  const courseNames = useMemo(
    () => new Map((courses ?? []).map((c) => [c.id, c.name])),
    [courses],
  );

  const cycleStatus = async (a: Assignment) => {
    setError(null);
    try {
      await setStatus.mutateAsync({ id: a.id, status: NEXT_STATUS[a.status] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update status");
    }
  };

  const confirmDelete = (a: Assignment) => {
    const run = async () => {
      setError(null);
      try {
        await deleteAssignment.mutateAsync(a.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete");
      }
    };
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (confirm(`Delete "${a.title}"?`)) void run();
      return;
    }
    Alert.alert("Delete assignment?", `"${a.title}" will be removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void run() },
    ]);
  };

  const renderAssignment = (a: Assignment) => (
    <Card key={a.id}>
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.s }}
      >
        <Pressable
          style={{ flex: 1, gap: 2 }}
          onPress={() => router.push(`/assignment/new?id=${a.id}`)}
          onLongPress={() => confirmDelete(a)}
        >
          <Text style={{ fontWeight: "600", fontSize: 16, color: colors.text }}>
            {a.title}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>
            {a.due_at
              ? `Due ${new Date(a.due_at).toLocaleDateString()}`
              : "No due date"}
            {a.estimated_minutes ? ` · ~${a.estimated_minutes} min` : ""}
          </Text>
          {a.complexity && (
            <Text
              style={{
                color: COMPLEXITY_META[a.complexity].color,
                fontSize: 12,
                fontWeight: "600",
              }}
            >
              {COMPLEXITY_META[a.complexity].label}
            </Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => void cycleStatus(a)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: STATUS_COLORS[a.status],
          }}
        >
          <Text
            style={{
              color: STATUS_COLORS[a.status],
              fontWeight: "600",
              fontSize: 13,
            }}
          >
            {STATUS_LABELS[a.status]}
          </Text>
        </Pressable>
        <Pressable onPress={() => confirmDelete(a)} hitSlop={8}>
          <Text style={{ color: colors.textMuted, fontSize: 15 }}>✕</Text>
        </Pressable>
      </View>
    </Card>
  );

  const sections: { title: string; items: Assignment[] }[] = [
    { title: "Overdue", items: groups.overdue },
    { title: "This week", items: groups.thisWeek },
    { title: "Later", items: groups.later },
    { title: "No due date", items: groups.noDate },
  ];
  const activeCount =
    groups.overdue.length + groups.thisWeek.length + groups.later.length +
    groups.noDate.length;

  return (
    <Screen>
      <View style={{ marginTop: spacing.s, gap: spacing.xs }}>
        <Title>Planner</Title>
        <Subtitle>
          Your tutor also logs assignments and grades you mention in chat.
        </Subtitle>
      </View>

      <View style={{ flexDirection: "row", gap: spacing.s }}>
        <Chip
          label="Assignments"
          selected={view === "assignments"}
          onPress={() => setView("assignments")}
        />
        <Chip
          label="Grades"
          selected={view === "grades"}
          onPress={() => setView("grades")}
        />
      </View>

      <ErrorText>{error}</ErrorText>

      {view === "assignments" && (
        <>
          <Button
            title="Add assignment"
            onPress={() => router.push("/assignment/new")}
          />
          {!assignments && <Subtitle>Loading your plan…</Subtitle>}
          {assignments && activeCount === 0 && groups.done.length === 0 && (
            <Subtitle>
              Nothing on your plate yet 🎉 Add an assignment or mention one to
              your tutor.
            </Subtitle>
          )}
          {sections.map((section) =>
            section.items.length === 0 ? null : (
              <View key={section.title} style={{ gap: spacing.s }}>
                <Label>
                  {section.title === "Overdue"
                    ? `🔥 Overdue (${section.items.length})`
                    : section.title}
                </Label>
                {section.items.map(renderAssignment)}
              </View>
            )
          )}
          {groups.done.length > 0 && (
            <View style={{ gap: spacing.s }}>
              <Pressable onPress={() => setShowDone((v) => !v)}>
                <Label>
                  {showDone ? "▾" : "▸"} Done ({groups.done.length})
                </Label>
              </Pressable>
              {showDone && groups.done.map(renderAssignment)}
            </View>
          )}
        </>
      )}

      {view === "grades" && (
        <>
          <Button
            title="Log a grade"
            onPress={() => router.push("/grade/new")}
          />
          {!grades && <Subtitle>Loading your grades…</Subtitle>}
          {grades && grades.length === 0 && (
            <Subtitle>
              No grades logged yet. Snap a marked test or log one by hand — your
              tutor uses these to spot weak topics.
            </Subtitle>
          )}
          {(grades ?? []).map((g) => {
            const pct = g.max_score > 0
              ? Math.round((g.score / g.max_score) * 100)
              : 0;
            return (
              <Card key={g.id}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.s,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontWeight: "600",
                        fontSize: 16,
                        color: colors.text,
                      }}
                    >
                      {g.title}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                      {courseNames.get(g.course_id) ?? "Course"} ·{" "}
                      {new Date(g.graded_at).toLocaleDateString()}
                      {g.weight != null ? ` · weight ${g.weight}%` : ""}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text
                      style={{
                        fontWeight: "700",
                        fontSize: 16,
                        color: percentColor(pct),
                      }}
                    >
                      {pct}%
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                      {g.score}/{g.max_score}
                    </Text>
                  </View>
                </View>
                {g.topics.length > 0 && (
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: spacing.xs,
                      marginTop: spacing.xs,
                    }}
                  >
                    {g.topics.map((t) => <Chip key={t} label={t} />)}
                  </View>
                )}
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}
