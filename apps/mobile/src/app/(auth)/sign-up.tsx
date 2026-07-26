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

export default function SignUp() {
  const auth = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signUp = async () => {
    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await auth.signUp(email.trim(), password, name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ marginTop: spacing.xl, gap: spacing.s }}>
        <Title>Create your account</Title>
        <Subtitle>A minute of setup, then your tutor is ready.</Subtitle>
      </View>
      <Field placeholder="Your name" value={name} onChangeText={setName} />
      <Field
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Field
        placeholder="Password (8+ characters)"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <ErrorText>{error}</ErrorText>
      <Button title="Create account" onPress={signUp} loading={busy} />
      <Link href="/(auth)/sign-in" style={{ alignSelf: "center" }}>
        <ThemedText style={{ color: colors.primary }}>
          Already have an account? Sign in
        </ThemedText>
      </Link>
    </Screen>
  );
}
