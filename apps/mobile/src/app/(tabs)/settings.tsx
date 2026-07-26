import { useState } from "react";
import { Platform, Text, View } from "react-native";
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
import { downloadVaultZip } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useChatStore } from "@/state/chat";
import { colors, spacing } from "@/theme";

export default function Settings() {
  const { session, profile } = useAuth();
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
    await supabase.auth.signOut();
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
          {session?.user.email}
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

      <Button title="Sign out" variant="danger" onPress={signOut} />
    </Screen>
  );
}
