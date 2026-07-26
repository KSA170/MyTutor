import { useState } from "react";
import { View } from "react-native";
import { Link } from "expo-router";
import {
  Button,
  ErrorText,
  Field,
  Screen,
  Subtitle,
  Title,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";

export default function SignIn() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.signIn(email.trim(), password);
      // Redirect happens in the root layout once the session lands.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ marginTop: spacing.xl, gap: spacing.s }}>
        <Title>MyTutor</Title>
        <Subtitle>
          Your personal AI tutor — it knows your courses, tracks your studying,
          and builds your second brain.
        </Subtitle>
      </View>
      <Field
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
      />
      <Field
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <ErrorText>{error}</ErrorText>
      <Button title="Sign in" onPress={signIn} loading={busy} />
      <Link href="/(auth)/sign-up" style={{ alignSelf: "center" }}>
        <ThemedText style={{ color: colors.primary }}>
          New here? Create an account
        </ThemedText>
      </Link>
    </Screen>
  );
}
