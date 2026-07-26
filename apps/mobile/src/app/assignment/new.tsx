import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { AssignmentComplexity } from "@mytutor/shared";
import {
  Button,
  Chip,
  ErrorText,
  Field,
  Label,
  Screen,
  Subtitle,
  Title,
} from "@/components/ui";
import { useAssignments, useCourses, useSaveAssignment } from "@/api/queries";
import { scheduleAssignmentReminders } from "@/lib/notifications";
import { colors, spacing } from "@/theme";

const COMPLEXITIES: { value: AssignmentComplexity; label: string }[] = [
  { value: "low", label: "🟢 Low" },
  { value: "medium", label: "🟠 Medium" },
  { value: "high", label: "🔴 High" },
];

const pad = (n: number) => String(n).padStart(2, "0");

function parseDueAt(
  dateStr: string,
  timeStr: string,
): { ok: true; iso: string | null } | { ok: false; message: string } {
  const d = dateStr.trim();
  const t = timeStr.trim();
  if (!d) {
    if (t) {
      return { ok: false, message: "Add a due date for that time, or clear the time." };
    }
    return { ok: true, iso: null };
  }
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!dm) {
    return { ok: false, message: "Due date should look like 2026-03-14 (YYYY-MM-DD)." };
  }
  const tm = t ? /^(\d{1,2}):(\d{2})$/.exec(t) : null;
  if (t && !tm) {
    return { ok: false, message: "Time should look like 16:30 (HH:MM)." };
  }
  const year = Number(dm[1]);
  const month = Number(dm[2]);
  const day = Number(dm[3]);
  const hours = tm ? Number(tm[1]) : 23;
  const minutes = tm ? Number(tm[2]) : 59;
  if (hours > 23 || minutes > 59) {
    return { ok: false, message: "That time doesn't exist — try HH:MM, 24h clock." };
  }
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return { ok: false, message: "That date doesn't exist — double-check it." };
  }
  return { ok: true, iso: date.toISOString() };
}

export default function AssignmentForm() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: courses } = useCourses();
  const { data: assignments } = useAssignments();
  const saveAssignment = useSaveAssignment();

  const editing = id ? assignments?.find((a) => a.id === id) : undefined;

  const [courseId, setCourseId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [minutes, setMinutes] = useState("");
  const [complexity, setComplexity] = useState<AssignmentComplexity | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (!editing || prefilled) return;
    setPrefilled(true);
    setCourseId(editing.course_id);
    setTitle(editing.title);
    setDescription(editing.description ?? "");
    if (editing.due_at) {
      const d = new Date(editing.due_at);
      setDueDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
      setDueTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
    setMinutes(
      editing.estimated_minutes != null ? String(editing.estimated_minutes) : "",
    );
    setComplexity(editing.complexity);
  }, [editing, prefilled]);

  const save = async () => {
    setError(null);
    const cid = courseId ?? courses?.[0]?.id;
    if (!cid) {
      setError("Add a course first — you can do that from the Home tab.");
      return;
    }
    if (!title.trim()) {
      setError("Give the assignment a title.");
      return;
    }
    const due = parseDueAt(dueDate, dueTime);
    if (!due.ok) {
      setError(due.message);
      return;
    }
    const mins = minutes.trim() ? Number(minutes.trim()) : null;
    if (mins !== null && (!Number.isInteger(mins) || mins <= 0)) {
      setError("Estimated minutes should be a whole number above 0.");
      return;
    }
    try {
      const saved = await saveAssignment.mutateAsync({
        id: editing?.id,
        courseId: cid,
        title: title.trim(),
        description: description.trim() || null,
        dueAt: due.iso,
        estimatedMinutes: mins,
        complexity,
      });
      void scheduleAssignmentReminders(saved);
      router.back();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save the assignment",
      );
    }
  };

  return (
    <Screen>
      <View style={{ marginTop: spacing.s, gap: spacing.xs }}>
        <Title>{editing ? "Edit assignment" : "New assignment"}</Title>
        <Subtitle>
          Anything with a due date gets gentle reminders the day before and the
          morning it's due. 📅
        </Subtitle>
      </View>

      <Label>Course</Label>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.s }}>
        {(courses ?? []).map((c) => (
          <Chip
            key={c.id}
            label={c.name}
            selected={(courseId ?? courses?.[0]?.id) === c.id}
            onPress={() => setCourseId(c.id)}
          />
        ))}
      </View>
      {courses && courses.length === 0 && (
        <Subtitle>No courses yet — add one from the Home tab first.</Subtitle>
      )}

      <Label>Title</Label>
      <Field
        placeholder='e.g. "Problem set 4"'
        value={title}
        onChangeText={setTitle}
      />

      <Label>Description (optional)</Label>
      <Field
        placeholder="What's involved? Your tutor reads this too."
        value={description}
        onChangeText={setDescription}
        multiline
      />

      <Label>Due date (optional)</Label>
      <View style={{ flexDirection: "row", gap: spacing.s }}>
        <Field
          placeholder="YYYY-MM-DD"
          value={dueDate}
          onChangeText={setDueDate}
          autoCapitalize="none"
          style={{ flex: 2 }}
        />
        <Field
          placeholder="HH:MM"
          value={dueTime}
          onChangeText={setDueTime}
          autoCapitalize="none"
          style={{ flex: 1 }}
        />
      </View>

      <Label>Estimated minutes (optional)</Label>
      <Field
        placeholder="e.g. 90"
        value={minutes}
        onChangeText={setMinutes}
        keyboardType="numeric"
      />

      <Label>Complexity</Label>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.s }}>
        {COMPLEXITIES.map((c) => (
          <Chip
            key={c.value}
            label={c.label}
            selected={complexity === c.value}
            onPress={() =>
              setComplexity(complexity === c.value ? null : c.value)}
          />
        ))}
      </View>

      <ErrorText>{error}</ErrorText>
      <Button
        title={editing ? "Save changes" : "Add assignment"}
        onPress={save}
        loading={saveAssignment.isPending}
      />
      <Text
        style={{ color: colors.textMuted, textAlign: "center" }}
        onPress={() => router.back()}
      >
        Cancel
      </Text>
    </Screen>
  );
}
