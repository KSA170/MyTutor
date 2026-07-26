import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Markdown from "react-native-markdown-display";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import type { ChatAttachment, SessionMode } from "@mytutor/shared";
import { useSession } from "@/api/queries";
import { finishSession, uploadToMaterials } from "@/lib/api";
import { useChatStore, type ChatItem } from "@/state/chat";
import { Chip } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

const MODES: SessionMode[] = ["teaching", "answering", "creation"];

export default function SessionChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: session } = useSession(id ?? null);
  const { items, sending, hintCount, loadSession, send } = useChatStore();

  const [input, setInput] = useState("");
  const [pendingMode, setPendingMode] = useState<SessionMode | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [addToCourse, setAddToCourse] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ending, setEnding] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (id) loadSession(id);
  }, [id, loadSession]);

  const currentMode: SessionMode = pendingMode ?? (session?.mode as SessionMode) ??
    "teaching";

  const onSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    const toSend = attachments.map((a) => ({ ...a, addToCourse }));
    setAttachments([]);
    const modeArg = pendingMode ?? undefined;
    setPendingMode(null);
    await send(text, { attachments: toSend, mode: modeArg });
  };

  const attach = async (source: "photos" | "files") => {
    if (!id) return;
    setUploading(true);
    try {
      let files: { uri: string; name: string; mimeType: string }[] = [];
      if (source === "photos") {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsMultipleSelection: true,
          quality: 0.85,
        });
        if (!result.canceled) {
          files = result.assets.map((a, i) => ({
            uri: a.uri,
            name: a.fileName ?? `photo-${Date.now()}-${i}.jpg`,
            mimeType: a.mimeType ?? "image/jpeg",
          }));
        }
      } else {
        const result = await DocumentPicker.getDocumentAsync({
          multiple: true,
          copyToCacheDirectory: true,
          type: ["application/pdf", "image/*"],
        });
        if (!result.canceled) {
          files = result.assets.map((a) => ({
            uri: a.uri,
            name: a.name,
            mimeType: a.mimeType ?? "application/pdf",
          }));
        }
      }
      for (const file of files) {
        const path = await uploadToMaterials(file, `chat/${id}`);
        setAttachments((prev) => [
          ...prev,
          { storagePath: path, mimeType: file.mimeType },
        ]);
      }
    } finally {
      setUploading(false);
    }
  };

  const endSession = async () => {
    if (!id || ending) return;
    setEnding(true);
    try {
      const result = await finishSession({ sessionId: id });
      router.replace({
        pathname: "/session/[id]/summary",
        params: { id, result: JSON.stringify(result) },
      });
    } catch {
      setEnding(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: "row", gap: spacing.s, flex: 1 }}>
          {MODES.map((m) => (
            <Chip
              key={m}
              label={m}
              selected={currentMode === m}
              onPress={() => setPendingMode(m)}
            />
          ))}
        </View>
        {currentMode === "teaching" && hintCount > 0 && (
          <Text style={styles.hintCounter}>💡 {hintCount}</Text>
        )}
        <Pressable onPress={endSession} disabled={ending}>
          <Text style={styles.endButton}>{ending ? "…" : "End"}</Text>
        </Pressable>
      </View>
      {pendingMode && pendingMode !== session?.mode && (
        <Text style={styles.modeNotice}>
          Switching to {pendingMode} with your next message
        </Text>
      )}

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.m, gap: spacing.m }}
        onContentSizeChange={() =>
          scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {items.length === 0 && (
          <Text style={styles.emptyHint}>
            {currentMode === "creation"
              ? "Ask for flashcards, a practice test, or a study guide on any topic from your course."
              : "Ask about anything from your course — or attach a photo of a problem you're stuck on."}
          </Text>
        )}
        {items.map((item) => <Bubble key={item.id} item={item} />)}
      </ScrollView>

      {/* Composer */}
      <View style={[styles.composerWrap, { paddingBottom: insets.bottom + spacing.s }]}>
        {attachments.length > 0 && (
          <Pressable
            onPress={() => setAddToCourse((v) => !v)}
            style={styles.attachmentBar}
          >
            <Text style={{ color: colors.textMuted }}>
              📎 {attachments.length} attachment{attachments.length > 1 ? "s" : ""}
              {"  ·  "}
              <Text style={{ color: addToCourse ? colors.primary : colors.textMuted }}>
                {addToCourse ? "✓ " : ""}add to course materials
              </Text>
            </Text>
          </Pressable>
        )}
        <View style={styles.composer}>
          <Pressable
            onPress={() => attach("photos")}
            disabled={uploading}
            style={styles.iconButton}
          >
            {uploading
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Text style={{ fontSize: 20 }}>📷</Text>}
          </Pressable>
          <Pressable
            onPress={() => attach("files")}
            disabled={uploading}
            style={styles.iconButton}
          >
            <Text style={{ fontSize: 20 }}>📎</Text>
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder="Ask your tutor…"
            placeholderTextColor={colors.textMuted}
            value={input}
            onChangeText={setInput}
            multiline
            editable={!sending}
            onSubmitEditing={onSend}
          />
          <Pressable
            onPress={onSend}
            disabled={sending || !input.trim()}
            style={[
              styles.sendButton,
              (sending || !input.trim()) && { opacity: 0.4 },
            ]}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>↑</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ item }: { item: ChatItem }) {
  const isUser = item.role === "user";
  return (
    <View
      style={[
        styles.bubble,
        isUser ? styles.userBubble : styles.assistantBubble,
      ]}
    >
      {item.attachmentCount
        ? (
          <Text style={{ color: "#E6F0EA", fontSize: 12 }}>
            📎 {item.attachmentCount} attachment{item.attachmentCount > 1 ? "s" : ""}
          </Text>
        )
        : null}
      {isUser
        ? <Text style={styles.userText}>{item.text}</Text>
        : item.text
        ? (
          <Markdown style={markdownStyles}>
            {item.text}
          </Markdown>
        )
        : null}
      {item.thinking && (
        <Text style={styles.statusLine}>Thinking…</Text>
      )}
      {item.toolLabel && (
        <Text style={styles.statusLine}>⚙︎ {item.toolLabel}</Text>
      )}
      {item.streaming && !item.text && !item.thinking && !item.toolLabel && (
        <ActivityIndicator size="small" color={colors.primary} />
      )}
      {item.notes.map((n) => (
        <View key={n.path} style={styles.inlineCard}>
          <Text style={styles.inlineCardTitle}>📝 Note saved</Text>
          <Text style={styles.inlineCardBody}>{n.path}</Text>
        </View>
      ))}
      {item.creations.map((c, i) => (
        <View key={`${c.title}-${i}`} style={styles.inlineCard}>
          <Text style={styles.inlineCardTitle}>
            ✨ {c.kind.replace("_", " ")} created
          </Text>
          <Text style={styles.inlineCardBody}>{c.title} — find it in Library</Text>
        </View>
      ))}
      {item.error && <Text style={{ color: colors.danger }}>{item.error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  hintCounter: { fontSize: 14, color: colors.text },
  endButton: { color: colors.danger, fontWeight: "600", fontSize: 15 },
  modeNotice: {
    textAlign: "center",
    color: colors.accent,
    fontSize: 12,
    paddingTop: 4,
  },
  emptyHint: {
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.xl,
    lineHeight: 20,
  },
  bubble: {
    maxWidth: "88%",
    borderRadius: radius.l,
    padding: spacing.m,
    gap: spacing.xs,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: colors.userBubble,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.assistantBubble,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  userText: { color: "#fff", fontSize: 16, lineHeight: 22 },
  statusLine: { color: colors.textMuted, fontStyle: "italic", fontSize: 13 },
  inlineCard: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.s,
    padding: spacing.s,
    marginTop: spacing.xs,
  },
  inlineCardTitle: { fontWeight: "600", color: colors.primary, fontSize: 13 },
  inlineCardBody: { color: colors.text, fontSize: 13 },
  composerWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.s,
    paddingTop: spacing.s,
  },
  attachmentBar: { paddingHorizontal: spacing.s, paddingBottom: spacing.s },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.s },
  iconButton: { padding: spacing.s },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.m,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 120,
    color: colors.text,
  },
  sendButton: {
    backgroundColor: colors.primary,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
});

const markdownStyles = {
  body: { color: colors.text, fontSize: 16, lineHeight: 23 },
  code_inline: {
    backgroundColor: colors.bg,
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  code_block: { backgroundColor: colors.bg, borderRadius: 8, padding: 10 },
  fence: { backgroundColor: colors.bg, borderRadius: 8, padding: 10 },
  heading1: { fontSize: 22, fontWeight: "700" as const },
  heading2: { fontSize: 19, fontWeight: "700" as const },
  heading3: { fontSize: 17, fontWeight: "600" as const },
};
