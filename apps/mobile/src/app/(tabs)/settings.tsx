import { useState } from "react";
import { Alert, Platform, Text, View } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  Button,
  Card,
  ErrorText,
  Label,
  Screen,
  Subtitle,
  Title,
} from "@/components/ui";
import { deleteAccount, downloadVaultZip } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useChatStore } from "@/state/chat";
import { colors, spacing } from "@/theme";

export default function Settings() {
  const auth = useAuth();
  const { session, profile } = auth;
  const resetChat = useChatStore((s) => s.reset);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);

  const exportVault = async () => {
    setExporting(true);
    setError(null);
    setExported(false);
    try {
      const bytes = await downloadVaultZip();
      if (Platform.OS === "web") {
        const blob = new Blob([bytes], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "mytutor-vault.zip";
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const file = new File(Paths.cache, "mytutor-vault.zip");
        if (file.exists) file.delete();
        file.write(new Uint8Array(bytes));
        await Sharing.shareAsync(file.uri, { mimeType: "application/zip" });
      }
      setExported(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const signOut = async () => {
    resetChat();
    await auth.signOut();
  };

  const confirmDeleteAccount = () => {
    const run = async () => {
      try {
        await deleteAccount();
        resetChat();
        await auth.signOut();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Deletion failed");
      }
    };
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (confirm("Delete your account and ALL data permanently?")) void run();
      return;
    }
    Alert.alert(
      "Delete account?",
      "This permanently deletes your account, courses, notes, and all study history. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete everything", style: "destructive", onPress: () => void run() },
      ],
    );
  };

  return (
    <Screen>
      <View style={{ marginTop: spacing.s, gap: spacing.xs }}>
        <Title>Settings</Title>
      </View>

      <Label>Account</Label>
      <Card>
        <Text style={{ fontWeight: "600", color: colors.text }}>
          {profile?.display_name ?? "Student"}
        </Text>
        <Text style={{ color: colors.textMuted }}>
          {session?.email}
        </Text>
        {profile?.grade_level && (
          <Text style={{ color: colors.textMuted }}>
            {profile.grade_level}
            {profile.program ? ` · ${profile.program}` : ""}
          </Text>
        )}
      </Card>

      <Label>Second brain</Label>
      <Card>
        <Text style={{ color: colors.text, lineHeight: 20 }}>
          Export your entire vault as Obsidian-ready markdown — folders, notes,
          wikilinks and all.
        </Text>
        <Button
          title={exported ? "Exported ✓" : "Export vault (.zip)"}
          variant="secondary"
          onPress={exportVault}
          loading={exporting}
        />
      </Card>
      <ErrorText>{error}</ErrorText>

      <Button title="Sign out" variant="secondary" onPress={signOut} />
      <Button
        title="Delete account & all data"
        variant="danger"
        onPress={confirmDeleteAccount}
      />
    </Screen>
  );
}
