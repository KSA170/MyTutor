import { create } from "zustand";
import type {
  ChatAttachment,
  CreationKind,
  SessionMode,
  SseEvent,
} from "@mytutor/shared";
import { streamTutorChat } from "../lib/api";
import { supabase } from "../lib/supabase";

export interface ChatItem {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  thinking?: boolean;
  toolLabel?: string | null;
  notes: { path: string; title: string }[];
  creations: { kind: CreationKind; title: string }[];
  attachmentCount?: number;
  error?: string;
}

interface ChatState {
  sessionId: string | null;
  items: ChatItem[];
  sending: boolean;
  hintCount: number;
  loadSession: (sessionId: string) => Promise<void>;
  send: (
    text: string,
    opts?: { attachments?: ChatAttachment[]; mode?: SessionMode },
  ) => Promise<void>;
  reset: () => void;
}

let itemCounter = 0;
const nextId = () => `local-${++itemCounter}`;

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: null,
  items: [],
  sending: false,
  hintCount: 0,

  reset: () => set({ sessionId: null, items: [], sending: false, hintCount: 0 }),

  loadSession: async (sessionId: string) => {
    if (get().sessionId === sessionId) return;
    set({ sessionId, items: [], sending: false, hintCount: 0 });
    const [{ data: rows }, { data: session }] = await Promise.all([
      supabase
        .from("messages")
        .select("id, role, display_text")
        .eq("session_id", sessionId)
        .neq("role", "system")
        .not("display_text", "is", null)
        .order("seq", { ascending: true }),
      supabase
        .from("sessions")
        .select("hints_given")
        .eq("id", sessionId)
        .single(),
    ]);
    // Guard against a session switch while we were loading.
    if (get().sessionId !== sessionId) return;
    set({
      items: (rows ?? [])
        .filter((r) => r.display_text)
        .map((r) => ({
          id: r.id,
          role: r.role as "user" | "assistant",
          text: r.display_text as string,
          notes: [],
          creations: [],
        })),
      hintCount: session?.hints_given ?? 0,
    });
  },

  send: async (text, opts = {}) => {
    const sessionId = get().sessionId;
    if (!sessionId || get().sending) return;

    const userItem: ChatItem = {
      id: nextId(),
      role: "user",
      text,
      notes: [],
      creations: [],
      attachmentCount: opts.attachments?.length,
    };
    const assistantItem: ChatItem = {
      id: nextId(),
      role: "assistant",
      text: "",
      streaming: true,
      notes: [],
      creations: [],
    };
    set((s) => ({ sending: true, items: [...s.items, userItem, assistantItem] }));

    const patchAssistant = (patch: Partial<ChatItem>) =>
      set((s) => ({
        items: s.items.map((it) =>
          it.id === assistantItem.id ? { ...it, ...patch } : it
        ),
      }));
    const appendText = (delta: string) =>
      set((s) => ({
        items: s.items.map((it) =>
          it.id === assistantItem.id
            ? { ...it, text: it.text + delta, toolLabel: null }
            : it
        ),
      }));

    const onEvent = (event: SseEvent) => {
      switch (event.type) {
        case "delta":
          appendText(event.text);
          break;
        case "thinking":
          patchAssistant({ thinking: event.active });
          break;
        case "tool":
          patchAssistant({ toolLabel: event.label });
          break;
        case "note":
          set((s) => ({
            items: s.items.map((it) =>
              it.id === assistantItem.id
                ? {
                  ...it,
                  notes: [...it.notes, {
                    path: event.path,
                    title: event.title,
                  }],
                }
                : it
            ),
          }));
          break;
        case "creation":
          set((s) => ({
            items: s.items.map((it) =>
              it.id === assistantItem.id
                ? {
                  ...it,
                  creations: [...it.creations, {
                    kind: event.kind,
                    title: event.title,
                  }],
                }
                : it
            ),
          }));
          break;
        case "hint":
          set({ hintCount: get().hintCount + 1 });
          break;
        case "done":
          patchAssistant({ streaming: false, thinking: false, toolLabel: null });
          break;
        case "error":
          patchAssistant({
            streaming: false,
            thinking: false,
            toolLabel: null,
            error: event.message,
          });
          break;
      }
    };

    try {
      await streamTutorChat(
        { sessionId, message: text, attachments: opts.attachments, mode: opts.mode },
        onEvent,
      );
    } catch (err) {
      patchAssistant({
        streaming: false,
        error: err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      patchAssistant({ streaming: false });
      set({ sending: false });
    }
  },
}));
