import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  TREE_ITEMS,
  TREE_STAGE_EMOJI,
  TREE_STAGE_THRESHOLDS,
  treeStageForPoints,
} from "@mytutor/shared";
import {
  Button,
  Card,
  Chip,
  ErrorText,
  Label,
  Screen,
  Subtitle,
  Title,
} from "@/components/ui";
import {
  usePoints,
  usePurchaseTreeItem,
  useSetEquippedItems,
  useTreeState,
} from "@/api/queries";
import { colors, radius, spacing } from "@/theme";

/** Fixed spots the equipped decorations get scattered onto around the tree. */
const DECOR_SPOTS: { top?: number; bottom?: number; left?: number; right?: number }[] = [
  { top: 24, left: 28 },
  { top: 36, right: 32 },
  { bottom: 96, left: 20 },
  { bottom: 90, right: 24 },
  { top: 96, left: 64 },
  { top: 100, right: 64 },
  { bottom: 140, left: 52 },
  { bottom: 136, right: 56 },
];

const MAX_STAGE = TREE_STAGE_THRESHOLDS.length - 1;

export default function BrainTree() {
  const router = useRouter();
  const pointsQuery = usePoints();
  const treeQuery = useTreeState();
  const purchase = usePurchaseTreeItem();
  const setEquipped = useSetEquippedItems();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const points = pointsQuery.data;
  const tree = treeQuery.data;
  const owned = tree?.owned_items ?? [];
  const equipped = tree?.equipped_items ?? [];

  const lifetime = points?.lifetime ?? 0;
  const balance = points?.balance ?? 0;
  const stage = treeStageForPoints(lifetime);
  const nextThreshold = stage < MAX_STAGE
    ? TREE_STAGE_THRESHOLDS[stage + 1]
    : null;
  const progress = nextThreshold
    ? Math.min(1, Math.max(0, lifetime / nextThreshold))
    : 1;

  const equippedItems = TREE_ITEMS.filter((item) =>
    equipped.includes(item.id)
  );

  const buy = async (itemId: string) => {
    setError(null);
    setPendingId(itemId);
    try {
      await purchase.mutateAsync(itemId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not buy that item");
    } finally {
      setPendingId(null);
    }
  };

  const toggleEquip = async (itemId: string) => {
    setError(null);
    const next = equipped.includes(itemId)
      ? equipped.filter((id) => id !== itemId)
      : [...equipped, itemId];
    try {
      await setEquipped.mutateAsync(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update your tree");
    }
  };

  if (pointsQuery.isLoading || treeQuery.isLoading) {
    return (
      <Screen>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <Text style={styles.backText}>← Home</Text>
        </Pressable>
        <Title>Your brain tree</Title>
        <Subtitle>Watering the roots… 🌱</Subtitle>
      </Screen>
    );
  }

  return (
    <Screen>
      <Pressable onPress={() => router.back()} style={styles.backLink}>
        <Text style={styles.backText}>← Home</Text>
      </Pressable>

      <View style={{ gap: spacing.xs }}>
        <Title>Your brain tree</Title>
        <Subtitle>
          Earn points by studying — minutes, questions answered, and streaks
          all count. Spend them to grow and decorate your tree.
        </Subtitle>
      </View>

      <Card style={styles.hero}>
        {equippedItems.map((item, i) => {
          const spot = DECOR_SPOTS[i % DECOR_SPOTS.length];
          return (
            <Text
              key={item.id}
              style={[styles.decor, spot]}
              accessibilityLabel={item.name}
            >
              {item.emoji}
            </Text>
          );
        })}
        <Text style={styles.treeEmoji}>{TREE_STAGE_EMOJI[stage]}</Text>
        <Text style={styles.stageLine}>
          Stage {stage + 1} of {TREE_STAGE_THRESHOLDS.length}
        </Text>
        {nextThreshold
          ? (
            <View style={styles.progressWrap}>
              <View style={styles.progressTrack}>
                <View
                  style={[styles.progressFill, { width: `${progress * 100}%` }]}
                />
              </View>
              <Text style={styles.progressLabel}>
                {lifetime}/{nextThreshold} lifetime points
              </Text>
            </View>
          )
          : <Text style={styles.stageLine}>Fully grown 👑</Text>}
      </Card>

      <View style={styles.balanceRow}>
        <Text style={styles.balanceText}>🪙 {balance} points to spend</Text>
        <Text style={styles.weekText}>+{points?.week ?? 0} this week</Text>
      </View>

      <Label>Tree shop</Label>
      <ErrorText>{error}</ErrorText>
      <View style={styles.shopGrid}>
        {TREE_ITEMS.map((item) => {
          const isOwned = owned.includes(item.id);
          const isEquipped = equipped.includes(item.id);
          const affordable = balance >= item.cost;
          return (
            <Card key={item.id} style={styles.shopCard}>
              <Text style={styles.shopEmoji}>{item.emoji}</Text>
              <Text style={styles.shopName}>{item.name}</Text>
              <Text style={styles.shopCost}>🪙 {item.cost}</Text>
              {isOwned
                ? (
                  <Chip
                    label={isEquipped ? "Shown" : "Hidden"}
                    selected={isEquipped}
                    onPress={() => toggleEquip(item.id)}
                  />
                )
                : (
                  <Button
                    title={`Buy · ${item.cost}`}
                    onPress={() => buy(item.id)}
                    disabled={!affordable}
                    loading={pendingId === item.id}
                  />
                )}
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  backLink: { alignSelf: "flex-start", paddingVertical: spacing.xs },
  backText: { color: colors.primary, fontSize: 16, fontWeight: "600" },
  hero: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primarySoft,
    minHeight: 300,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.s,
    overflow: "hidden",
  },
  treeEmoji: { fontSize: 96, textAlign: "center" },
  decor: { position: "absolute", fontSize: 28 },
  stageLine: { fontSize: 16, fontWeight: "700", color: colors.text },
  progressWrap: { alignSelf: "stretch", gap: spacing.xs, alignItems: "center" },
  progressTrack: {
    alignSelf: "stretch",
    height: 10,
    borderRadius: radius.s,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.s,
    backgroundColor: colors.primary,
  },
  progressLabel: { color: colors.textMuted, fontSize: 13 },
  balanceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  balanceText: { fontSize: 16, fontWeight: "600", color: colors.text },
  weekText: { color: colors.success, fontWeight: "600" },
  shopGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.s },
  shopCard: { minWidth: "45%", flexGrow: 1, flexBasis: "45%" },
  shopEmoji: { fontSize: 32 },
  shopName: { fontSize: 15, fontWeight: "600", color: colors.text },
  shopCost: { color: colors.textMuted, fontSize: 13 },
});
