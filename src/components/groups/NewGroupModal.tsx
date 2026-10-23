"use client";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { useUserSearch } from "@/hooks/useUserSearch";
import type { Profile } from "@/types";

export function NewGroupModal({ meId, onClose, onCreated }: { meId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const { q, setQ, results } = useUserSearch(meId);
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<Profile[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!title.trim()) return setErr("Give the group a name.");
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("create_group", { p_title: title, p_members: picked.map((p) => p.id) });
    setBusy(false);
    if (error) return setErr("Could not create the group.");
    onCreated(data as string);
  }
  return (
    <Modal title="New group" onClose={onClose}>
      <input aria-label="Group name" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="Group name" className="w-full rounded-xl border border-border bg-bg2 px-4 py-3" />
      <div className="mt-3 flex flex-wrap gap-2">
        {picked.map((p) => <button key={p.id} onClick={() => setPicked((c) => c.filter((x) => x.id !== p.id))} className="rounded-full bg-accent/20 px-3 py-1 text-xs" aria-label={`Remove ${p.username}`}>@{p.username} ✕</button>)}
      </div>
      <input aria-label="Search people to add" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people to add" className="mt-3 w-full rounded-xl border border-border bg-bg2 px-4 py-3" />
      <ul className="mt-2 max-h-48 overflow-y-auto">
        {results.filter((r) => !picked.some((p) => p.id === r.id)).map((r) => (
          <li key={r.id}><button onClick={() => { setPicked((c) => [...c, r]); setQ(""); }} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-bg2"><Avatar p={r} size={32} />{r.full_name || r.username} <span className="text-xs text-muted">@{r.username}</span></button></li>
        ))}
      </ul>
      {err && <p role="alert" className="mt-2 text-sm text-err">{err}</p>}
      <button onClick={create} disabled={busy} className="btn-primary mt-4 w-full disabled:opacity-60">{busy ? "Creating…" : "Create group"}</button>
    </Modal>
  );
}
