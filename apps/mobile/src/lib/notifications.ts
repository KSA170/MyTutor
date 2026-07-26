import { Platform } from "react-native";
import type { Assignment } from "@mytutor/shared";

/**
 * Local due-date reminders (on-device; no push infra needed).
 * No-op on web. Reminder fires the day before at 17:00 local, plus the
 * morning of the due date at 08:00.
 */
export async function scheduleAssignmentReminders(
  assignment: Assignment,
): Promise<void> {
  if (Platform.OS === "web" || !assignment.due_at) return;
  try {
    const Notifications = await import("expo-notifications");
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;

    const due = new Date(assignment.due_at);
    const dayBefore = new Date(due);
    dayBefore.setDate(due.getDate() - 1);
    dayBefore.setHours(17, 0, 0, 0);
    const morningOf = new Date(due);
    morningOf.setHours(8, 0, 0, 0);

    for (const [when, body] of [
      [dayBefore, `"${assignment.title}" is due tomorrow.`],
      [morningOf, `"${assignment.title}" is due today.`],
    ] as const) {
      if (when.getTime() <= Date.now()) continue;
      await Notifications.scheduleNotificationAsync({
        content: { title: "MyTutor", body },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: when,
        },
      });
    }
  } catch (err) {
    console.warn("notification scheduling failed:", err);
  }
}
