import { useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { LearningStylePreferences } from "@mytutor/shared";
import { DEFAULT_LEARNING_STYLE } from "@mytutor/shared";
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
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { colors, spacing } from "@/theme";

const TOGGLES: { key: keyof LearningStylePreferences; label: string }[] = [
  { key: "analogies", label: "Explain with analogies" },
  { key: "real_world_examples", label: "Real-world examples" },
  { key: "step_by_step", label: "Step-by-step breakdowns" },
  { key: "visual", label: "Diagrams & visual descriptions" },
  { key: "socratic", label: "Ask me questions (Socratic)" },
];

export default function OnboardingStyle() {
  const router = useRouter();
  const { session, refreshProfile } = useAuth();
  const [prefs, setPrefs] = useState<LearningStylePreferences>(
    DEFAULT_LEARNING_STYLE,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (key: keyof LearningStylePreferences) =>
    setPrefs((p) => ({ ...p, [key]: !p[key] }));

  const finish = async () => {
    setBusy(true);
    setError(null);
    const userId = session!.user.id;
    const { error: styleErr } = await supabase
      .from("learning_style_profiles")
      .update({ preferences: prefs })
      .eq("user_id", userId);
    const { error: profileErr } = await supabase
      .from("profiles")
      .update({ onboarding_completed: true })
      .eq("id", userId);
    setBusy(false);
    if (styleErr || profileErr) {
      setError((styleErr ?? profileErr)!.message);
      return;
    }
    await refreshProfile();
    router.replace("/(tabs)");
  };

  return (
    <Screen>
      <View style={{ marginTop: spacing.l, gap: spacing.s }}>
        <Title>How do you learn best?</Title>
        <Subtitle>
          Step 4 of 4 — your tutor starts from this and keeps adapting as it
          gets to know you.
        </Subtitle>
      </View>
      {TOGGLES.map((t) => (
        <Card key={t.key} onPress={() => toggle(t.key)}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 16, color: colors.text }}>{t.label}</Text>
            <Text
              style={{
                fontSize: 16,
                color: prefs[t.key] ? colors.primary : colors.textMuted,
                fontWeight: "700",
              }}
            >
              {prefs[t.key] ? "On" : "Off"}
            </Text>
          </View>
        </Card>
      ))}
      <Label>Pace</Label>
      <View style={{ flexDirection: "row", gap: spacing.s }}>
        {(["slow", "moderate", "fast"] as const).map((pace) => (
          <Chip
            key={pace}
            label={pace}
            selected={prefs.pace === pace}
            onPress={() => setPrefs((p) => ({ ...p, pace }))}
          />
        ))}
      </View>
      <ErrorText>{error}</ErrorText>
      <Button title="Finish setup" onPress={finish} loading={busy} />
    </Screen>
  );
}
