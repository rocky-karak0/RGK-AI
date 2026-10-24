export interface Profile { id: string; username: string; full_name: string; avatar_url?: string | null }
export interface ConvSummary {
  id: string; kind: "direct" | "group"; title: string | null; description: string | null;
  last_body: string | null; last_kind: string | null; last_at: string | null;
  unread: number; other_id: string | null; my_role: string; my_cleared_at?: string | null;
}
export type MsgKind = "text" | "image" | "video" | "audio" | "file" | "voice";
export interface Msg {
  id: string; client_id: string; conversation_id: string; sender_id: string; kind: MsgKind;
  body: string | null; reply_to: string | null; created_at: string; edited_at: string | null; deleted_at: string | null;
  storage_path: string | null; file_name: string | null; file_size: number | null; mime_type: string | null; duration_ms: number | null;
  status?: "pending" | "failed";
}
export interface Reaction { message_id: string; user_id: string; emoji: string }
export interface Settings {
  show_online: boolean; show_last_seen: boolean; send_read_receipts: boolean;
  notify_messages: boolean; notify_groups: boolean; notify_calls: boolean; sound: boolean;
  theme: "dark" | "light" | "system";
}
export const DEFAULT_SETTINGS: Settings = {
  show_online: true, show_last_seen: true, send_read_receipts: true,
  notify_messages: true, notify_groups: true, notify_calls: true, sound: true, theme: "dark",
};
