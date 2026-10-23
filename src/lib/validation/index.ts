import type { MsgKind } from "@/types";

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
// Keep in sync with the allowed_mime_types of the "attachments" bucket in migration 0002.
export const ALLOWED_MIME = [
  "image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm",
  "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "application/pdf", "text/plain", "application/zip",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export function validateUsername(v: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = v.trim().toLowerCase();
  return USERNAME_RE.test(value) ? { ok: true, value } : { ok: false, error: "Username: 3-24 chars, a-z, 0-9, underscore." };
}

export const baseMime = (t: string) => t.split(";")[0].trim().toLowerCase();

export function validateFile(f: { size: number; type: string }): { ok: true } | { ok: false; error: string } {
  if (f.size <= 0) return { ok: false, error: "File is empty." };
  if (f.size > MAX_FILE_BYTES) return { ok: false, error: "File is larger than 25 MB." };
  if (!ALLOWED_MIME.includes(baseMime(f.type))) return { ok: false, error: "This file type is not allowed." };
  return { ok: true };
}

export function kindFromMime(mime: string): MsgKind {
  const m = baseMime(mime);
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "file";
}

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-80);
  return cleaned || "file";
}
