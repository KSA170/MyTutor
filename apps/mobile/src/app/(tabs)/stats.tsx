import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import Markdown from "react-native-markdown-display";
import type { DailyStudyStats } from "@mytutor/shared";
import {
  Button,
  Card,
  ErrorText,
  Label,
  Screen,
  Subtitle,
  Title,
} from "@/components/ui";
import {
  useDailyStats,
  useGrades,
  useLatestRecap,
  usePoints,
} from "@/api/queries";
import { requestWeeklyRecap } from "@/lib/api";
import { colors, spacing } from "@/theme";

const MAX_BAR_HEIGHT = 120;
const MIN_BAR_HEIGHT = 4;
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface DayPoint {
  key: string;
  date: Date;
  minutes: number;
  questions: number;
  correct: number;
}

export default function Stats() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: stats } = useDailyStats(14);
  const { data: grades } = useGrades();
  const { data: recap } = useLatestRecap();
  const { data: points } = usePoints();

  const [refreshingRecap, setRefreshingRecap] = useState(false);
  const [recapError, setRecapError] = useState<string | null>(null);

  // Normalize into exactly 14 calendar days ending today, oldest first.
  const days = useMemo<DayPoint[]>(() => {
    const byDay = new Map<string, DailyStudyStats>();
    for (const row of stats ?? []) byDay.set(row.day.slice(0, 10), row);
    const out: DayPoint[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = dayKey(d);
      const row = byDay.get(key);
      out.push({
        key,
        date: d,
        minutes: row?.minutes ?? 0,
        questions: row?.questions ?? 0,
        correct: row?.correct ?? 0,
      });
    }
    return out;
  }, [stats]);

  const week = days.slice(7);
  const weekMinutes = week.reduce((sum, d) => sum + d.minutes, 0);
  const weekQuestions = week.reduce((sum, d) => sum + d.questions, 0);
  const weekCorrect = week.reduce((sum, d) => sum + d.correct, 0);
  const correctPct = weekQuestions > 0
    ? Math.round((weekCorrect / weekQuestions) * 100)
    : null;

  // Consecutive days with study time ending today — or ending yesterday if
  // today has no minutes logged yet.
  const streak = useMemo(() => {
    let idx = days.length - 1;
    if (idx >= 0 && days[idx].minutes === 0) idx--;
    let count = 0;
    while (idx >= 0 && days[idx].minutes > 0) {
      count++;
      idx--;
    }
    return count;
  }, [days]);

  const maxMinutes = Math.max(1, ...days.map((d) => d.minutes));
  const totalMinutes = days.reduce((sum, d) => sum + d.minutes, 0);

  const weakTopics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of grades ?? []) {
      if (g.max_score > 0 && g.score / g.max_score < 0.7) {
        for (const topic of g.topics ?? []) {
          counts.set(topic, (counts.get(topic) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [grades]);

  const refreshRecap = async () => {
    setRecapError(null);
    setRefreshingRecap(true);
    try {
      await requestWeeklyRecap();
      await queryClient.invalidateQueries({ queryKey: ["latest-recap"] });
    } catch (err) {
      setRecapError(
        err instanceof Error ? err.message : "Could not refresh recap",
      );
    } finally {
      setRefreshingRecap(false);
    }
  };

  return (
    <Screen>
      <View style={{ marginTop: spacing.s, gap: spacing.xs }}>
        <Title>Stats</Title>
        <Subtitle>Your study habits, at a glance.</Subtitle>
      </View>

      <View style={styles.grid}>
        <Card style={styles.statCard}>
          <Text style={styles.statEmoji}>⏱️</Text>
          <Text style={styles.statValue}>
            {stats ? weekMinutes : "—"}
          </Text>
          <Text style={styles.statLabel}>minutes this week</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statEmoji}>❓</Text>
          <Text style={styles.statValue}>
            {stats ? weekQuestions : "—"}
          </Text>
          <Text style={styles.statLabel}>
            questions answered
            {correctPct !== null ? `\n${correctPct}% correct` : ""}
          </Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statEmoji}>🔥</Text>
          <Text style={styles.statValue}>{stats ? streak : "—"}</Text>
          <Text style={styles.statLabel}>
            day streak{streak > 0 ? " — keep it up!" : ""}
          </Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statEmoji}>⭐</Text>
          <Text style={styles.statValue}>{points ? points.week : "—"}</Text>
          <Text style={styles.statLabel}>points this week</Text>
        </Card>
      </View>

      <Label>Last 14 days</Label>
      <Card>
        {stats === undefined
          ? <Subtitle>Crunching your numbers…</Subtitle>
          : (
            <>
              <View style={styles.chartRow}>
                {days.map((d) => {
                  const height = d.minutes === 0 ? 0 : Math.max(
                    MIN_BAR_HEIGHT,
                    Math.round((d.minutes / maxMinutes) * MAX_BAR_HEIGHT),
                  );
                  return (
                    <View key={d.key} style={styles.barColumn}>
                      <View style={styles.barTrack}>
                        <View style={[styles.bar, { height }]} />
                      </View>
                      <Text style={styles.barLabel}>
                        {WEEKDAY_LETTERS[d.date.getDay()]}
                      </Text>
                    </View>
                  );
                })}
              </View>
              <Text style={styles.chartCaption}>minutes studied per day</Text>
              {totalMinutes === 0 && (
                <Subtitle>
                  Nothing logged yet — start a session and watch the bars grow!
                  🌱
                </Subtitle>
              )}
            </>
          )}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>🎯 Weak topics</Text>
        {grades === undefined
          ? <Subtitle>Checking your grades…</Subtitle>
          : weakTopics.length === 0
          ? <Subtitle>No weak topics detected — nice!</Subtitle>
          : (
            <>
              <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                Topics from grades below 70% — worth a review session.
              </Text>
              <View style={styles.chipRow}>
                {weakTopics.map(([topic, count]) => (
                  <View key={topic} style={styles.weakChip}>
                    <Text style={styles.weakChipText}>
                      {topic} ×{count}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>📬 Weekly recap</Text>
        {recap === undefined
          ? <Subtitle>Loading your recap…</Subtitle>
          : recap === null
          ? (
            <Subtitle>
              No recap yet — tap refresh and your tutor will write one. ✍️
            </Subtitle>
          )
          : (
            <>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {new Date(recap.updated_at).toLocaleDateString()}
              </Text>
              <Markdown style={{ body: { color: colors.text, fontSize: 14 } }}>
                {recap.content}
              </Markdown>
            </>
          )}
        <ErrorText>{recapError}</ErrorText>
        <Button
          title="Refresh recap"
          variant="secondary"
          onPress={refreshRecap}
          loading={refreshingRecap}
        />
      </Card>

      <Card onPress={() => router.push("/friends")}>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.m }}
        >
          <Text style={{ fontSize: 32 }}>🏆</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Friends & leaderboard</Text>
            <Text style={{ color: colors.textMuted }}>
              Compare study streaks with friends →
            </Text>
          </View>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s,
  },
  statCard: {
    flexBasis: "47%",
    flexGrow: 1,
    alignItems: "center",
    gap: 2,
  },
  statEmoji: { fontSize: 20 },
  statValue: { fontSize: 26, fontWeight: "700", color: colors.text },
  statLabel: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 16,
  },
  chartRow: {
    flexDirection: "row",
    gap: 3,
  },
  barColumn: {
    flex: 1,
    gap: spacing.xs,
  },
  barTrack: {
    height: MAX_BAR_HEIGHT,
    justifyContent: "flex-end",
  },
  bar: {
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  barLabel: {
    textAlign: "center",
    fontSize: 10,
    color: colors.textMuted,
  },
  chartCaption: {
    textAlign: "center",
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  cardTitle: { fontWeight: "600", fontSize: 16, color: colors.text },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s,
    marginTop: spacing.xs,
  },
  weakChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.card,
  },
  weakChipText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: "500",
  },
});
