import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Card, Label, Screen, Subtitle, Title } from "@/components/ui";
import { useCourses, useRecentSessions } from "@/api/queries";
import { useAuth } from "@/lib/auth";
import { colors, spacing } from "@/theme";

const MODE_LABELS: Record<string, string> = {
  teaching: "Teaching",
  answering: "Answering",
  creation: "Creation",
};

export default function Home() {
  const router = useRouter();
  const { profile } = useAuth();
  const { data: courses } = useCourses();
  const { data: sessions } = useRecentSessions(5);

  const active = (sessions ?? []).find((s) => s.status === "active");

  return (
    <Screen>
      <View style={{ marginTop: spacing.s, gap: spacing.xs }}>
        <Title>
          {profile?.display_name ? `Hi ${profile.display_name}` : "MyTutor"}
        </Title>
        <Subtitle>Ready to study?</Subtitle>
      </View>

      {active
        ? (
          <Button
            title="Resume active session"
            onPress={() => router.push(`/session/${active.id}`)}
          />
        )
        : (
          <Button
            title="Start a session"
            onPress={() => router.push("/session/new")}
          />
        )}

      <Label>Courses</Label>
      {(courses ?? []).map((c) => (
        <Card key={c.id}>
          <Text style={{ fontWeight: "600", fontSize: 16, color: colors.text }}>
            {c.name}
          </Text>
          {c.subject
            ? <Text style={{ color: colors.textMuted }}>{c.subject}</Text>
            : null}
        </Card>
      ))}
      {(courses ?? []).length === 0 && (
        <Subtitle>No courses yet — add one below.</Subtitle>
      )}
      <Button
        title="Add a course"
        variant="secondary"
        onPress={() => router.push("/onboarding/course")}
      />

      <Label>Recent sessions</Label>
      {(sessions ?? []).filter((s) => s.status !== "active").map((s) => (
        <Card key={s.id} onPress={() => router.push(`/session/${s.id}/summary`)}>
          <Text style={{ fontWeight: "600", color: colors.text }}>
            {new Date(s.started_at).toLocaleDateString()} —{" "}
            {MODE_LABELS[s.mode] ?? s.mode} mode
          </Text>
          <Text style={{ color: colors.textMuted }} numberOfLines={2}>
            {s.summary ?? `${s.questions_answered} questions, ${s.hints_given} hints`}
          </Text>
        </Card>
      ))}
    </Screen>
  );
}
