import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import {
  Button,
  ErrorText,
  Field,
  Label,
  Screen,
  Subtitle,
  Title,
} from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { spacing } from "@/theme";

export default function OnboardingCourse() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [instructor, setInstructor] = useState("");
  const [term, setTerm] = useState("");
  const [curriculum, setCurriculum] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const next = async () => {
    if (!name.trim()) {
      setError("Course name is required");
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("courses")
      .insert({
        user_id: session!.user.id,
        name: name.trim(),
        subject: subject.trim() || null,
        instructor: instructor.trim() || null,
        term: term.trim() || null,
        curriculum: curriculum.trim() || null,
        grade_level: profile?.grade_level ?? null,
      })
      .select("id")
      .single();
    setBusy(false);
    if (err || !data) {
      setError(err?.message ?? "Could not create course");
      return;
    }
    router.push({
      pathname: "/onboarding/materials",
      params: { courseId: data.id },
    });
  };

  return (
    <Screen>
      <View style={{ marginTop: spacing.l, gap: spacing.s }}>
        <Title>Your first course</Title>
        <Subtitle>
          Step 2 of 4 — you can add more courses later from Home.
        </Subtitle>
      </View>
      <Label>Course name</Label>
      <Field
        placeholder='e.g. "Science 10"'
        value={name}
        onChangeText={setName}
      />
      <Label>Subject</Label>
      <Field
        placeholder='e.g. "Science"'
        value={subject}
        onChangeText={setSubject}
      />
      <Label>Teacher / instructor (optional)</Label>
      <Field value={instructor} onChangeText={setInstructor} />
      <Label>Term (optional)</Label>
      <Field
        placeholder='e.g. "Fall 2026"'
        value={term}
        onChangeText={setTerm}
      />
      <Label>Curriculum / syllabus (optional but powerful)</Label>
      <Field
        placeholder="Paste the course outline, units, or syllabus here — your tutor will know exactly what your class covers."
        multiline
        value={curriculum}
        onChangeText={setCurriculum}
      />
      <ErrorText>{error}</ErrorText>
      <Button title="Next" onPress={next} loading={busy} />
    </Screen>
  );
}
