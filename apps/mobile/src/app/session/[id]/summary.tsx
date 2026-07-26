import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { FinishSessionResponse } from "@mytutor/shared";
import { Button, Card, Screen, Subtitle, Title } from "@/components/ui";
import { useSession } from "@/api/queries";
import { useChatStore } from "@/state/chat";
import { colors, spacing } from "@/theme";

export default function SessionSummary() {
  const router = useRouter();
  const { id, result } = useLocalSearchParams<{ id: string; result?: string }>();
  const { data: session } = useSession(id ?? null);
  const resetChat = useChatStore((s) => s.reset);

  let parsed: FinishSessionResponse | null = null;
  if (result) {
    try {
      parsed = JSON.parse(result) as FinishSessionResponse;
    } catch {
      parsed = null;
    }
  }

  const stats = [
    {
      label: "Time studied",
      value: parsed
        ? `${parsed.durationMinutes} min`
        : session?.ended_at
        ? `${
          Math.round(
            (new Date(session.ended_at).getTime() -
              new Date(session.started_at).getTime()) / 60000,
          )
        } min`
        : "—",
    },
    {
      label: "Questions answered",
      value: String(parsed?.questionsAnswered ?? session?.questions_answered ?? 0),
    },
    {
      label: "Hints used",
      value: String(parsed?.hintsGiven ?? session?.hints_given ?? 0),
    },
    {
      label: "Answers revealed",
      value: String(parsed?.answersRevealed ?? session?.answers_revealed ?? 0),
    },
    {
      label: "Notes created",
      value: String(parsed?.notesCreated ?? "—"),
    },
    {
      label: "Points earned",
      value: `+${parsed?.pointsAwarded ?? session?.points_awarded ?? 0}`,
    },
  ];

  return (
    <Screen>
      <View style={{ marginTop: spacing.l, gap: spacing.xs }}>
        <Title>Session complete 🎉</Title>
        {session && (
          <Subtitle>
            {new Date(session.started_at).toLocaleString()} · {session.mode} mode
          </Subtitle>
        )}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.s }}>
        {stats.map((s) => (
          <Card key={s.label} style={{ minWidth: "45%", flex: 1 }}>
            <Text style={{ fontSize: 24, fontWeight: "700", color: colors.primary }}>
              {s.value}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>
              {s.label}
            </Text>
          </Card>
        ))}
      </View>

      {(parsed?.summary ?? session?.summary) && (
        <Card>
          <Text style={{ fontWeight: "600", color: colors.text }}>
            What you covered
          </Text>
          <Text style={{ color: colors.text, lineHeight: 21 }}>
            {parsed?.summary ?? session?.summary}
          </Text>
        </Card>
      )}

      <Button
        title="Done"
        onPress={() => {
          resetChat();
          router.replace("/(tabs)");
        }}
      />
    </Screen>
  );
}
