/* eslint-disable @next/next/no-img-element */
"use client";
import { useEffect, useState } from "react";
import { Check, CheckCheck, Copy, CornerUpLeft, FileText, Flag, Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Msg, Reaction } from "@/types";

const QUICK = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const mmss = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const prettySize = (n: number | null) => (n == null ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function useSignedUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void createClient().storage.from("attachments").createSignedUrl(path, 300).then(({ data }) => { if (!cancelled) setUrl(data?.signedUrl ?? null); });
    return () => { cancelled = true; };
  }, [path]);
  return url;
}

function Attachment({ m }: { m: Msg }) {
  const url = useSignedUrl(m.storage_path);
  if (!m.storage_path) return <span className="text-xs">Uploading…</span>;
  if (!url) return <span className="text-xs opacity-70">Loading…</span>;
  if (m.kind === "image") return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={m.file_name ?? "Image attachment"} className="max-h-64 rounded-lg" /></a>;
  if (m.kind === "video") return <video src={url} controls className="max-h-64 rounded-lg" />;
  if (m.kind === "audio" || m.kind === "voice")
    return <div className="flex flex-col gap-1"><audio src={url} controls className="max-w-full" />{m.duration_ms ? <span className="text-xs opacity-70">Voice · {mmss(m.duration_ms)}</span> : null}</div>;
  return <a href={url} download={m.file_name ?? undefined} className="flex items-center gap-2 underline"><FileText className="h-4 w-4" />{m.file_name} <span className="opacity-70">({prettySize(m.file_size)})</span></a>;
}

interface Props {
  m: Msg; mine: boolean; senderName?: string; replied?: Msg; reactions: Reaction[]; meId: string;
  read: boolean; showTicks: boolean;
  onReact: (e: string) => void; onReply: () => void; onEdit: (b: string) => void; onDelete: () => void; onRetry: () => void; onReport: () => void;
}

export function MessageBubble(p: Props) {
  const { m, mine } = p;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body ?? "");
  const counts = new Map<string, { n: number; mine: boolean }>();
  p.reactions.forEach((r) => { const c = counts.get(r.emoji) ?? { n: 0, mine: false }; counts.set(r.emoji, { n: c.n + 1, mine: c.mine || r.user_id === p.meId }); });

  return (
    <div className={`msg-in flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[80%]">
        {!mine && p.senderName && <div className="mb-0.5 px-1 text-xs text-muted">{p.senderName}</div>}
        <div role="button" tabIndex={0} aria-label="Message options" onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen((o) => !o); }}
          className={`cursor-pointer break-words rounded-2xl px-4 py-2 text-sm ${mine ? "bg-accent text-white" : "bg-surface text-ink"} ${m.status === "pending" ? "opacity-60" : ""}`}>
          {p.replied && <div className="mb-1 truncate border-l-2 border-white/50 pl-2 text-xs opacity-80">{p.replied.body ?? p.replied.file_name ?? "Attachment"}</div>}
          {m.kind !== "text" && <Attachment m={m} />}
          {editing ? (
            <span onClick={(e) => e.stopPropagation()} className="flex gap-1">
              <input aria-label="Edit message" value={draft} onChange={(e) => setDraft(e.target.value)} className="rounded bg-bg2 px-2 py-1 text-ink" />
              <button className="underline" onClick={() => { p.onEdit(draft); setEditing(false); }}>Save</button>
            </span>
          ) : m.body && m.kind === "text" ? <span className="whitespace-pre-wrap">{m.body}</span> : null}
          <span className="ml-2 inline-flex items-center gap-1 align-bottom text-[10px] opacity-70">
            {m.edited_at && "edited · "}{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {mine && p.showTicks && m.status !== "pending" && (p.read ? <CheckCheck className="h-3 w-3 text-ok" aria-label="Read" /> : <Check className="h-3 w-3" aria-label="Sent" />)}
          </span>
          {m.status === "failed" && <button onClick={(e) => { e.stopPropagation(); p.onRetry(); }} className="ml-2 text-xs underline">Failed — retry</button>}
        </div>
        {counts.size > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {[...counts.entries()].map(([emo, c]) => (
              <button key={emo} onClick={() => p.onReact(emo)} aria-label={`${emo} ${c.n}`} className={`rounded-full border px-2 text-xs ${c.mine ? "border-accent bg-accent/20" : "border-border bg-surface"}`}>{emo} {c.n}</button>
            ))}
          </div>
        )}
        {open && !editing && (
          <div className="mt-1 flex flex-wrap items-center gap-1 rounded-xl border border-border bg-bg2 p-1">
            {QUICK.map((e) => <button key={e} aria-label={`React ${e}`} onClick={() => { p.onReact(e); setOpen(false); }} className="rounded-lg px-1.5 py-0.5 hover:bg-surface">{e}</button>)}
            <button aria-label="Reply" onClick={() => { p.onReply(); setOpen(false); }} className="rounded-lg p-1.5 hover:bg-surface"><CornerUpLeft className="h-4 w-4" /></button>
            {m.body && <button aria-label="Copy" onClick={() => { void navigator.clipboard.writeText(m.body ?? ""); setOpen(false); }} className="rounded-lg p-1.5 hover:bg-surface"><Copy className="h-4 w-4" /></button>}
            {mine && m.kind === "text" && <button aria-label="Edit" onClick={() => { setDraft(m.body ?? ""); setEditing(true); }} className="rounded-lg p-1.5 hover:bg-surface"><Pencil className="h-4 w-4" /></button>}
            {mine && <button aria-label="Delete" onClick={() => { p.onDelete(); setOpen(false); }} className="rounded-lg p-1.5 text-err hover:bg-surface"><Trash2 className="h-4 w-4" /></button>}
            {!mine && <button aria-label="Report" onClick={() => { p.onReport(); setOpen(false); }} className="rounded-lg p-1.5 hover:bg-surface"><Flag className="h-4 w-4" /></button>}
          </div>
        )}
      </div>
    </div>
  );
}
