import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import {
  Button,
  ErrorText,
  Field,
  Label,
  Screen,
  Subtitle,
  Title,
} from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { spacing } from "@/theme";

export default function OnboardingProfile() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const [gradeLevel, setGradeLevel] = useState(profile?.grade_level ?? "");
  const [program, setProgram] = useState(profile?.program ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const next = async () => {
    if (!gradeLevel.trim()) {
      setError("Grade level helps your tutor pitch explanations right");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("profiles")
      .update({
        grade_level: gradeLevel.trim(),
        program: program.trim() || null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
      })
      .eq("id", session!.user.id);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.push("/onboarding/course");
  };

  return (
    <Screen>
      <View style={{ marginTop: spacing.l, gap: spacing.s }}>
        <Title>About you</Title>
        <Subtitle>
          Step 1 of 4 — this becomes standing context for your tutor.
        </Subtitle>
      </View>
      <Label>Grade level</Label>
      <Field
        placeholder='e.g. "Grade 10" or "2nd year university"'
        value={gradeLevel}
        onChangeText={setGradeLevel}
      />
      <Label>Program (optional)</Label>
      <Field
        placeholder='e.g. "IB", "AP", "Sciences Po prep"'
        value={program}
        onChangeText={setProgram}
      />
      <ErrorText>{error}</ErrorText>
      <Button title="Next" onPress={next} loading={busy} />
    </Screen>
  );
}
