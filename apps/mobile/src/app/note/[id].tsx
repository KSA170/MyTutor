import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Markdown from "react-native-markdown-display";
import { Screen, Subtitle, Title } from "@/components/ui";
import { useNotes } from "@/api/queries";
import { colors, spacing } from "@/theme";

/**
 * Note viewer. [[Wikilinks]] are rewritten to tappable links that resolve to
 * the target note by title (or stay inert if the note doesn't exist yet).
 */
export default function NoteViewer() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: notes } = useNotes();

  const note = notes?.find((n) => n.id === id);

  const byTitle = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notes ?? []) map.set(n.title.toLowerCase(), n.id);
    return map;
  }, [notes]);

  const rendered = useMemo(() => {
    if (!note) return "";
    // [[Target]] or [[Target|Alias]] → markdown link to mytutor-note://id
    return note.content.replace(
      /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
      (_all, target: string, alias?: string) => {
        const targetId = byTitle.get(target.trim().toLowerCase());
        const label = (alias ?? target).trim();
        return targetId ? `[${label}](mytutor-note://${targetId})` : `*${label}*`;
      },
    );
  }, [note, byTitle]);

  if (!note) {
    return (
      <Screen>
        <Subtitle>Note not found.</Subtitle>
      </Screen>
    );
  }

  const backlinks = (notes ?? []).filter(
    (n) => n.id !== note.id && n.links.includes(note.title),
  );

  return (
    <Screen>
      <View style={{ marginTop: spacing.s, gap: spacing.xs }}>
        <Title>{note.title}</Title>
        <Subtitle>{note.path}</Subtitle>
        {note.tags.length > 0 && (
          <Text style={{ color: colors.accent }}>
            {note.tags.map((t) => `#${t}`).join("  ")}
          </Text>
        )}
      </View>
      <Markdown
        style={{
          body: { color: colors.text, fontSize: 16, lineHeight: 24 },
          link: { color: colors.primary },
          heading1: { fontSize: 24, fontWeight: "700" },
          heading2: { fontSize: 20, fontWeight: "700" },
          heading3: { fontSize: 17, fontWeight: "600" },
          code_block: { backgroundColor: colors.card, borderRadius: 8, padding: 10 },
          fence: { backgroundColor: colors.card, borderRadius: 8, padding: 10 },
        }}
        onLinkPress={(url) => {
          if (url.startsWith("mytutor-note://")) {
            router.push(`/note/${url.slice("mytutor-note://".length)}`);
            return false;
          }
          return true;
        }}
      >
        {rendered}
      </Markdown>

      {backlinks.length > 0 && (
        <View style={{ gap: spacing.s, marginTop: spacing.l }}>
          <Text style={{ fontWeight: "700", color: colors.textMuted }}>
            Linked from
          </Text>
          {backlinks.map((b) => (
            <Pressable key={b.id} onPress={() => router.push(`/note/${b.id}`)}>
              <Text style={{ color: colors.primary }}>← {b.title}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
