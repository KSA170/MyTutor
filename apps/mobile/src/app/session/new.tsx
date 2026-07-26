import { useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { SessionMode } from "@mytutor/shared";
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
import { useCourses, useCreateSession } from "@/api/queries";
import { colors, spacing } from "@/theme";

const MODES: { mode: SessionMode; label: string; blurb: string }[] = [
  {
    mode: "teaching",
    label: "Teaching",
    blurb: "Progressive hints — earn the answer",
  },
  { mode: "answering", label: "Answering", blurb: "Direct answers, fast" },
  {
    mode: "creation",
    label: "Creation",
    blurb: "Build flashcards, practice tests, study guides",
  },
];

const LENGTHS = [15, 25, 45, 60, 90];

export default function NewSession() {
  const router = useRouter();
  const { data: courses } = useCourses();
  const createSession = useCreateSession();
  const [courseId, setCourseId] = useState<string | null>(null);
  const [mode, setMode] = useState<SessionMode>("teaching");
  const [minutes, setMinutes] = useState<number | null>(45);
  const [subject, setSubject] = useState("");
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    try {
      const session = await createSession.mutateAsync({
        courseId: courseId ?? courses?.[0]?.id ?? null,
        mode,
        plannedMinutes: minutes,
        subject: subject.trim() || null,
      });
      router.replace(`/session/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start session");
    }
  };

  return (
    <Screen>
      <View style={{ marginTop: spacing.s, gap: spacing.xs }}>
        <Title>New session</Title>
        <Subtitle>
          Planning a length lets your tutor suggest breaks at the right time.
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

      <Label>Subject / unit (optional)</Label>
      <Field
        placeholder='e.g. "Geology" — organizes notes for this session'
        value={subject}
        onChangeText={setSubject}
      />

      <Label>Mode</Label>
      <View style={{ gap: spacing.s }}>
        {MODES.map((m) => (
          <Chip
            key={m.mode}
            label={`${m.label} — ${m.blurb}`}
            selected={mode === m.mode}
            onPress={() => setMode(m.mode)}
          />
        ))}
      </View>

      <Label>Planned length</Label>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.s }}>
        {LENGTHS.map((len) => (
          <Chip
            key={len}
            label={`${len} min`}
            selected={minutes === len}
            onPress={() => setMinutes(len)}
          />
        ))}
        <Chip
          label="No plan"
          selected={minutes === null}
          onPress={() => setMinutes(null)}
        />
      </View>

      <ErrorText>{error}</ErrorText>
      <Button
        title="Start studying"
        onPress={start}
        loading={createSession.isPending}
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
