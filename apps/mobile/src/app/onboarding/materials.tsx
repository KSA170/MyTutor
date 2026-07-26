import { useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import {
  Button,
  Card,
  ErrorText,
  Screen,
  Subtitle,
  Title,
} from "@/components/ui";
import { registerMaterial, uploadToMaterials } from "@/lib/api";
import { useMaterials } from "@/api/queries";
import { colors, spacing } from "@/theme";

export const MATERIAL_STATUS_LABELS: Record<string, string> = {
  uploaded: "Queued…",
  processing: "Processing…",
  ready: "Ready",
  failed: "Failed",
};

export default function OnboardingMaterials() {
  const router = useRouter();
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const { data: materials } = useMaterials(courseId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleUpload = async (files: {
    uri: string;
    name: string;
    mimeType: string;
    size?: number;
  }[]) => {
    if (!courseId) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of files) {
        const path = await uploadToMaterials(file, courseId);
        await registerMaterial({
          courseId,
          title: file.name,
          storagePath: path,
          mimeType: file.mimeType,
          sizeBytes: file.size,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const pickDocuments = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "video/*"],
    });
    if (result.canceled) return;
    await handleUpload(
      result.assets.map((a) => ({
        uri: a.uri,
        name: a.name,
        mimeType: a.mimeType ?? "application/octet-stream",
        size: a.size ?? undefined,
      })),
    );
  };

  const pickImages = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.85,
    });
    if (result.canceled) return;
    await handleUpload(
      result.assets.map((a, i) => ({
        uri: a.uri,
        name: a.fileName ?? `photo-${Date.now()}-${i}.jpg`,
        mimeType: a.mimeType ?? "image/jpeg",
        size: a.fileSize ?? undefined,
      })),
    );
  };

  return (
    <Screen>
      <View style={{ marginTop: spacing.l, gap: spacing.s }}>
        <Title>Course materials</Title>
        <Subtitle>
          Step 3 of 4 — upload lecture slides, the textbook, worksheets,
          screenshots of notes. Your tutor reads all of it. You can keep adding
          materials any time, including mid-conversation.
        </Subtitle>
      </View>
      <Button
        title="Upload documents (PDF, DOCX, video)"
        onPress={pickDocuments}
        loading={busy}
      />
      <Button
        title="Upload photos / screenshots"
        variant="secondary"
        onPress={pickImages}
        loading={busy}
      />
      <ErrorText>{error}</ErrorText>
      {(materials ?? []).map((m) => (
        <Card key={m.id}>
          <Text style={{ fontWeight: "600", color: colors.text }}>
            {m.title}
          </Text>
          <Text
            style={{
              color: m.status === "failed" ? colors.danger : colors.textMuted,
            }}
          >
            {MATERIAL_STATUS_LABELS[m.status] ?? m.status}
            {m.status === "failed" && m.error ? ` — ${m.error}` : ""}
          </Text>
        </Card>
      ))}
      <Button
        title={materials?.length ? "Next" : "Skip for now"}
        variant={materials?.length ? "primary" : "secondary"}
        onPress={() => router.push("/onboarding/style")}
      />
    </Screen>
  );
}
