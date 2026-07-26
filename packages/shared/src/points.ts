/**
 * Study points + brain tree economy.
 *
 * KEEP IN SYNC with the SQL in supabase/migrations/0003_social.sql
 * (award_session_points) — the database is the enforcement point; this
 * module exists so the app can show/estimate the same numbers.
 */

export interface SessionPointsInput {
  durationMinutes: number;
  questionsAnswered: number;
  answersRevealed: number;
  creationsMade: number;
}

/** Points earned for one completed session. */
export function sessionPoints(input: SessionPointsInput): number {
  const minutes = Math.min(Math.max(input.durationMinutes, 0), 120);
  const raw = minutes +
    5 * input.questionsAnswered -
    2 * input.answersRevealed +
    3 * input.creationsMade;
  return Math.max(0, Math.round(raw));
}

/** Lifetime-points thresholds for each tree growth stage. */
export const TREE_STAGE_THRESHOLDS = [0, 50, 150, 400, 800, 1500, 3000];

export function treeStageForPoints(lifetimePoints: number): number {
  let stage = 0;
  for (let i = 0; i < TREE_STAGE_THRESHOLDS.length; i++) {
    if (lifetimePoints >= TREE_STAGE_THRESHOLDS[i]) stage = i;
  }
  return stage;
}

export const TREE_STAGE_EMOJI = ["🌱", "🌿", "🪴", "🌳", "🌳✨", "🌸🌳", "🌳👑"];

export interface TreeItem {
  id: string;
  name: string;
  emoji: string;
  cost: number;
}

/** Decorations purchasable with points (spent via purchase_tree_item RPC). */
export const TREE_ITEMS: TreeItem[] = [
  { id: "birdhouse", name: "Birdhouse", emoji: "🐦", cost: 40 },
  { id: "lanterns", name: "Lanterns", emoji: "🏮", cost: 60 },
  { id: "flowers", name: "Flower bed", emoji: "🌷", cost: 30 },
  { id: "bench", name: "Study bench", emoji: "🪑", cost: 80 },
  { id: "pond", name: "Koi pond", emoji: "🐟", cost: 120 },
  { id: "swing", name: "Tire swing", emoji: "🛞", cost: 100 },
  { id: "owl", name: "Wise owl", emoji: "🦉", cost: 200 },
  { id: "treehouse", name: "Treehouse", emoji: "🏠", cost: 300 },
];
