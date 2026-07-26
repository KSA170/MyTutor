import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Label,
  Screen,
  Subtitle,
  Title,
} from "@/components/ui";
import {
  useFriendRequests,
  useLeaderboard,
  useRequestFriend,
  useRespondFriend,
  useSetHandle,
} from "@/api/queries";
import { useAuth } from "@/lib/auth";
import { colors, spacing } from "@/theme";

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const MEDALS = ["🥇", "🥈", "🥉"];

export default function Friends() {
  const router = useRouter();
  const { session, profile, refreshProfile } = useAuth();
  const setHandle = useSetHandle();
  const requestFriend = useRequestFriend();
  const respondFriend = useRespondFriend();
  const requestsQuery = useFriendRequests();
  const leaderboardQuery = useLeaderboard();

  const [handleDraft, setHandleDraft] = useState("");
  const [handleError, setHandleError] = useState<string | null>(null);
  const [friendHandle, setFriendHandle] = useState("");
  const [friendError, setFriendError] = useState<string | null>(null);
  const [respondError, setRespondError] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const myId = session?.userId;
  const requests = requestsQuery.data;
  const leaderboard = leaderboardQuery.data;
  const incoming = (requests ?? []).filter((r) => r.direction === "incoming");
  const outgoing = (requests ?? []).filter((r) => r.direction === "outgoing");

  const saveHandle = async () => {
    setHandleError(null);
    const candidate = handleDraft.trim().toLowerCase();
    if (!HANDLE_RE.test(candidate)) {
      setHandleError(
        "Handles are lowercase letters, numbers, and underscores — 3 to 20 characters.",
      );
      return;
    }
    try {
      await setHandle.mutateAsync(candidate);
      await refreshProfile();
    } catch (err) {
      setHandleError(
        err instanceof Error ? err.message : "Could not save that handle",
      );
    }
  };

  const sendRequest = async () => {
    setFriendError(null);
    try {
      await requestFriend.mutateAsync(friendHandle);
      setFriendHandle("");
    } catch (err) {
      setFriendError(
        err instanceof Error ? err.message : "Could not send that request",
      );
    }
  };

  const respond = async (friendshipId: string, accept: boolean) => {
    setRespondError(null);
    setRespondingId(friendshipId);
    try {
      await respondFriend.mutateAsync({ friendshipId, accept });
    } catch (err) {
      setRespondError(
        err instanceof Error ? err.message : "Could not update that request",
      );
    } finally {
      setRespondingId(null);
    }
  };

  return (
    <Screen>
      <Pressable onPress={() => router.back()} style={styles.backLink}>
        <Text style={styles.backText}>← Back</Text>
      </Pressable>

      <View style={{ gap: spacing.xs }}>
        <Title>Friends 🤝</Title>
        <Subtitle>
          The leaderboard compares study points and minutes from the last 7
          days — a fresh race every week.
        </Subtitle>
      </View>

      {profile?.handle
        ? (
          <>
            <Text style={styles.handleLine}>
              You are <Text style={styles.handleValue}>@{profile.handle}</Text>
            </Text>

            <Card>
              <Text style={styles.cardTitle}>Add a friend</Text>
              <Field
                placeholder="their_handle"
                autoCapitalize="none"
                autoCorrect={false}
                value={friendHandle}
                onChangeText={setFriendHandle}
              />
              <ErrorText>{friendError}</ErrorText>
              <Button
                title="Send request"
                onPress={sendRequest}
                loading={requestFriend.isPending}
                disabled={!friendHandle.trim()}
              />
            </Card>
          </>
        )
        : (
          <Card>
            <Text style={styles.cardTitle}>👋 First, pick a handle</Text>
            <Subtitle>
              Pick a handle so friends can find you — lowercase letters,
              numbers, underscores, 3-20 chars.
            </Subtitle>
            <Field
              placeholder="e.g. study_sam"
              autoCapitalize="none"
              autoCorrect={false}
              value={handleDraft}
              onChangeText={setHandleDraft}
            />
            <ErrorText>{handleError}</ErrorText>
            <Button
              title="Save"
              onPress={saveHandle}
              loading={setHandle.isPending}
            />
          </Card>
        )}

      <Label>Requests</Label>
      <ErrorText>{respondError}</ErrorText>
      {requests === undefined
        ? <Subtitle>Checking for requests…</Subtitle>
        : incoming.length === 0 && outgoing.length === 0
        ? <Subtitle>No friend requests right now.</Subtitle>
        : (
          <>
            {incoming.map((r) => (
              <Card key={r.friendship_id}>
                <Text style={styles.rowName}>
                  {r.display_name}
                  {r.handle
                    ? <Text style={styles.rowHandle}> @{r.handle}</Text>
                    : null}
                </Text>
                <Text style={styles.rowMeta}>
                  Wants to be friends ·{" "}
                  {new Date(r.created_at).toLocaleDateString()}
                </Text>
                <View style={styles.buttonRow}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Accept"
                      onPress={() => respond(r.friendship_id, true)}
                      loading={respondingId === r.friendship_id &&
                        respondFriend.isPending}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Decline"
                      variant="secondary"
                      onPress={() => respond(r.friendship_id, false)}
                      disabled={respondingId === r.friendship_id &&
                        respondFriend.isPending}
                    />
                  </View>
                </View>
              </Card>
            ))}
            {outgoing.map((r) => (
              <Card key={r.friendship_id}>
                <Text style={styles.rowName}>
                  Pending · {r.handle ? `@${r.handle}` : r.display_name}
                </Text>
                <Text style={styles.rowMeta}>
                  Sent {new Date(r.created_at).toLocaleDateString()} — waiting
                  on them ⏳
                </Text>
              </Card>
            ))}
          </>
        )}

      <Label>Leaderboard</Label>
      {leaderboard === undefined
        ? <Subtitle>Tallying this week's points…</Subtitle>
        : (
          <>
            {leaderboard.map((row, i) => {
              const isMe = row.user_id === myId;
              return (
                <Card
                  key={row.user_id}
                  style={isMe
                    ? {
                      backgroundColor: colors.primarySoft,
                      borderColor: colors.primarySoft,
                    }
                    : undefined}
                >
                  <View style={styles.lbRow}>
                    <Text style={styles.rank}>
                      {i + 1}.{i < 3 ? ` ${MEDALS[i]}` : ""}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>
                        {row.display_name}
                        {isMe ? " (you)" : ""}
                        {row.handle
                          ? <Text style={styles.rowHandle}> @{row.handle}</Text>
                          : null}
                      </Text>
                      <Text style={styles.rowMeta}>
                        {row.points_week} points this week ·{" "}
                        {row.minutes_week} min studied
                      </Text>
                    </View>
                  </View>
                </Card>
              );
            })}
            {leaderboard.length <= 1 && (
              <Subtitle>
                Just you so far — add friends to compare streaks.
              </Subtitle>
            )}
          </>
        )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  backLink: { alignSelf: "flex-start", paddingVertical: spacing.xs },
  backText: { color: colors.primary, fontSize: 16, fontWeight: "600" },
  handleLine: { fontSize: 16, color: colors.text },
  handleValue: { fontWeight: "700", color: colors.primary },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  rowName: { fontSize: 15, fontWeight: "600", color: colors.text },
  rowHandle: { color: colors.textMuted, fontWeight: "400" },
  rowMeta: { color: colors.textMuted, fontSize: 13 },
  buttonRow: { flexDirection: "row", gap: spacing.s, marginTop: spacing.xs },
  lbRow: { flexDirection: "row", alignItems: "center", gap: spacing.m },
  rank: { fontSize: 16, fontWeight: "700", color: colors.text, minWidth: 44 },
});
