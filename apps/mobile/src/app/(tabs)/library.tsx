import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Card, Screen, Subtitle, Title } from "@/components/ui";
import { useNotes } from "@/api/queries";
import { colors, spacing } from "@/theme";

/**
 * The Library — the student's second brain, organized exactly like the
 * vault: Class → Subject → Type (Lessons / Created Materials / Question
 * Summaries). Folders are derived from note paths; no extra state.
 */
export default function Library() {
  const router = useRouter();
  const { data: notes } = useNotes();
  const [cwd, setCwd] = useState<string[]>([]);

  const { folders, files } = useMemo(() => {
    const prefix = cwd.length ? cwd.join("/") + "/" : "";
    const folderSet = new Set<string>();
    const fileList: { id: string; title: string; path: string }[] = [];
    for (const note of notes ?? []) {
      if (!note.path.startsWith(prefix)) continue;
      const rest = note.path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) {
        fileList.push({ id: note.id, title: note.title, path: note.path });
      } else {
        folderSet.add(rest.slice(0, slash));
      }
    }
    return {
      folders: [...folderSet].sort(),
      files: fileList.sort((a, b) => a.title.localeCompare(b.title)),
    };
  }, [notes, cwd]);

  return (
    <Screen>
      <View style={{ marginTop: spacing.s, gap: spacing.xs }}>
        <Title>Library</Title>
        <Subtitle>
          Your second brain — every note is Obsidian-ready markdown.
        </Subtitle>
      </View>

      {/* Breadcrumbs */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
        <Pressable onPress={() => setCwd([])}>
          <Text style={{ color: colors.primary, fontWeight: "600" }}>Vault</Text>
        </Pressable>
        {cwd.map((seg, i) => (
          <Pressable key={i} onPress={() => setCwd(cwd.slice(0, i + 1))}>
            <Text style={{ color: colors.primary }}>
              {" / "}
              <Text style={{ fontWeight: i === cwd.length - 1 ? "700" : "400" }}>
                {seg}
              </Text>
            </Text>
          </Pressable>
        ))}
      </View>

      {folders.map((folder) => (
        <Card key={folder} onPress={() => setCwd([...cwd, folder])}>
          <Text style={{ fontSize: 16, color: colors.text }}>📁 {folder}</Text>
        </Card>
      ))}
      {files.map((file) => (
        <Card key={file.id} onPress={() => router.push(`/note/${file.id}`)}>
          <Text style={{ fontSize: 16, color: colors.text }}>📄 {file.title}</Text>
        </Card>
      ))}
      {folders.length === 0 && files.length === 0 && (
        <Subtitle>
          Nothing here yet. Notes appear automatically as you study — your
          tutor writes them for you.
        </Subtitle>
      )}
    </Screen>
  );
}
