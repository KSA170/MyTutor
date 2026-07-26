import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import {
  Button,
  Chip,
  ErrorText,
  Field,
  Label,
  Screen,
  Subtitle,
  Title,
} from "@/components/ui";
import { useCourses, useCreateGrade } from "@/api/queries";
import { extractGradeFromPhoto, uploadToMaterials } from "@/lib/api";
import { colors, spacing } from "@/theme";

const pad = (n: number) => String(n).padStart(2, "0");

function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "YYYY-MM-DD" → ISO string (local noon, avoids timezone day-shift), or null. */
function parseDateOnly(dateStr: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date.toISOString();
}

export default function NewGrade() {
  const router = useRouter();
  const { data: courses } = useCourses();
  const createGrade = useCreateGrade();

  const [courseId, setCourseId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [score, setScore] = useState("");
  const [maxScore, setMaxScore] = useState("");
  const [weight, setWeight] = useState("");
  const [topics, setTopics] = useState("");
  const [feedback, setFeedback] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = async () => {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setScanning(true);
    try {
      const file = {
        uri: asset.uri,
        name: asset.fileName ?? `marked-test-${Date.now()}.jpg`,
        mimeType: asset.mimeType ?? "image/jpeg",
      };
      const path = await uploadToMaterials(file, "grades");
      const extracted = await extractGradeFromPhoto(path, file.mimeType);
      if (extracted.title) setTitle(extracted.title);
      if (extracted.score != null) setScore(String(extracted.score));
      if (extracted.max_score != null) setMaxScore(String(extracted.max_score));
      if (extracted.feedback) setFeedback(extracted.feedback);
      if (extracted.topics.length > 0) setTopics(extracted.topics.join(", "));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not read that photo",
      );
    } finally {
      setScanning(false);
    }
  };

  const save = async () => {
    setError(null);
    const cid = courseId ?? courses?.[0]?.id;
    if (!cid) {
      setError("Add a course first — you can do that from the Home tab.");
      return;
    }
    if (!title.trim()) {
      setError("Give this grade a title.");
      return;
    }
    const scoreNum = Number(score.trim());
    const maxNum = Number(maxScore.trim());
    if (!score.trim() || !Number.isFinite(scoreNum) || scoreNum < 0) {
      setError("Score should be a number.");
      return;
    }
    if (!maxScore.trim() || !Number.isFinite(maxNum) || maxNum <= 0) {
      setError("Max score should be a number above 0.");
      return;
    }
    if (scoreNum > maxNum) {
      setError("Score can't be higher than the max score.");
      return;
    }
    const weightNum = weight.trim() ? Number(weight.trim()) : null;
    if (
      weightNum !== null &&
      (!Number.isFinite(weightNum) || weightNum < 0 || weightNum > 100)
    ) {
      setError("Weight should be a percent between 0 and 100.");
      return;
    }
    const gradedAt = parseDateOnly(date);
    if (!gradedAt) {
      setError("Date should look like 2026-03-14 (YYYY-MM-DD).");
      return;
    }
    const topicList = topics
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      await createGrade.mutateAsync({
        courseId: cid,
        title: title.trim(),
        score: scoreNum,
        maxScore: maxNum,
        weight: weightNum,
        feedback: feedback.trim() || null,
        topics: topicList,
        gradedAt,
      });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the grade");
    }
  };

  return (
    <Screen>
      <View style={{ marginTop: spacing.s, gap: spacing.xs }}>
        <Title>Log a grade</Title>
        <Subtitle>
          Your tutor uses grades to spot weak topics and plan what to review.
        </Subtitle>
      </View>

      <Button
        title="📷 Scan a marked test"
        variant="secondary"
        onPress={() => void scan()}
        loading={scanning}
      />
      {scanning && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.s,
            justifyContent: "center",
          }}
        >
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.textMuted }}>
            Reading the marks off your test…
          </Text>
        </View>
      )}

      <Label>Course</Label>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.s }}>
        {(courses ?? []).map((c) => (
          <Chip
            key={c.id}
            label={c.name}
            selected={(courseId ?? courses?.[0]?.id) === c.id}
            onPress={() => setCourseId(c.id)}
          />
        ))}
      </View>
      {courses && courses.length === 0 && (
        <Subtitle>No courses yet — add one from the Home tab first.</Subtitle>
      )}

      <Label>Title</Label>
      <Field
        placeholder='e.g. "Unit 3 test"'
        value={title}
        onChangeText={setTitle}
      />

      <View style={{ flexDirection: "row", gap: spacing.s }}>
        <View style={{ flex: 1, gap: spacing.s }}>
          <Label>Score</Label>
          <Field
            placeholder="e.g. 42"
            value={score}
            onChangeText={setScore}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={{ flex: 1, gap: spacing.s }}>
          <Label>Out of</Label>
          <Field
            placeholder="e.g. 50"
            value={maxScore}
            onChangeText={setMaxScore}
            keyboardType="decimal-pad"
          />
        </View>
      </View>

      <Label>Weight % (optional)</Label>
      <Field
        placeholder="e.g. 20 — how much this counts toward the course"
        value={weight}
        onChangeText={setWeight}
        keyboardType="decimal-pad"
      />

      <Label>Topics (comma-separated)</Label>
      <Field
        placeholder="e.g. stoichiometry, molar mass"
        value={topics}
        onChangeText={setTopics}
        autoCapitalize="none"
      />

      <Label>Feedback (optional)</Label>
      <Field
        placeholder="Teacher comments, what went wrong, what went well…"
        value={feedback}
        onChangeText={setFeedback}
        multiline
      />

      <Label>Date</Label>
      <Field
        placeholder="YYYY-MM-DD"
        value={date}
        onChangeText={setDate}
        autoCapitalize="none"
      />

      <ErrorText>{error}</ErrorText>
      <Button
        title="Save grade"
        onPress={save}
        loading={createGrade.isPending}
      />
      <Text
        style={{ color: colors.textMuted, textAlign: "center" }}
        onPress={() => router.back()}
      >
        Cancel
      </Text>
    </Screen>
  );
}
